/**
 * Payment Service
 *
 * Handles payment processing, Vipps callbacks, and background polling.
 * Implements the payment flow for the Vipps MobilePay wallet handler.
 */

import { delay } from "@std/async/delay";
import { poll } from "@std/async/unstable-poll";
import {
  clearAccessToken,
  createPayment,
  getPaymentStatus,
  prefetchAccessToken,
} from "../infrastructure/vipps_epayment_client.ts";
import type {
  CheckoutSession,
  PaymentState,
  UCPMessage,
} from "../types/ucp/checkout.ts";
import { WalletPaymentInstrument } from "../types/ucp/payment.ts";
import { VippsEPaymentAmount } from "../types/vipps/epayment.ts";
import { updateStock } from "../routes/products.ts";
import { loadSessions, saveSessions, TAX_RATE } from "./checkout-service.ts";
import { TotalEntry } from "../types/ucp/checkout.ts";

// ============================================
// Configuration
// ============================================

/** Payment timeout for async PUSH_MESSAGE flow (5 minutes) */
const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Vipps polling configuration (per Vipps guidelines)
 * @see https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 */
const VIPPS_POLL_INITIAL_DELAY_MS = 5000;
const VIPPS_POLL_INTERVAL_MS = 2000;
const VIPPS_POLL_MAX_ATTEMPTS = 150;

/**
 * Handler ID declared in /.well-known/ucp profile.
 * Matches the payment handler: com.vippsmobilepay.ucp.payment_handler
 * @see https://ucp.vippsmobilepay.com/ucp/2026-01-23/payment_handlers/vipps_mp_payment_handler.md
 */
export const VIPPS_WALLET_HANDLER_ID = "vippsmobilepay_wallet_handler";

// ============================================
// Instrument Validation
// ============================================

/**
 * Validates the wallet payment instrument from the request.
 * Returns null if valid, or a UCPMessage error if invalid.
 */
export function validateWalletInstrument(
  instrument: WalletPaymentInstrument,
): UCPMessage | null {
  // Validate handler_id matches our declared handler
  if (!instrument.handler_id) {
    return {
      type: "error",
      code: "missing_handler_id",
      severity: "recoverable",
      content: "Payment instrument must specify a handler_id.",
      path: "$.payment.instruments[0].handler_id",
    };
  }

  if (instrument.handler_id !== VIPPS_WALLET_HANDLER_ID) {
    return {
      type: "error",
      code: "unknown_handler",
      severity: "recoverable",
      content:
        `Unknown payment handler '${instrument.handler_id}'. This merchant supports: ${VIPPS_WALLET_HANDLER_ID}`,
      path: "$.payment.instruments[0].handler_id",
    };
  }

  // Validate type
  if (instrument.type !== "WALLET") {
    return {
      type: "error",
      code: "invalid_instrument_type",
      severity: "recoverable",
      content:
        `Invalid instrument type '${instrument.type}'. Expected 'WALLET'.`,
      path: "$.payment.instruments[0].type",
    };
  }

  // Validate credential exists
  if (!instrument.credential) {
    return {
      type: "error",
      code: "missing_credential",
      severity: "recoverable",
      content: "Payment credential is required.",
      path: "$.payment.instruments[0].credential",
    };
  }

  // Validate credential type
  if (instrument.credential.type !== "MSISDN") {
    return {
      type: "error",
      code: "invalid_credential_type",
      severity: "recoverable",
      content:
        `Invalid credential type '${instrument.credential.type}'. Expected 'MSISDN'.`,
      path: "$.payment.instruments[0].credential.type",
    };
  }

  // Validate MSISDN value
  const msisdn = instrument.credential.value;
  if (!msisdn) {
    return {
      type: "error",
      code: "missing_msisdn",
      severity: "recoverable",
      content: "Phone number (MSISDN) is required.",
      path: "$.payment.instruments[0].credential.value",
    };
  }

  // Validate MSISDN format (digits only, 7-15 chars, starts with non-zero)
  const msisdnPattern = /^[1-9]\d{6,14}$/;
  if (!msisdnPattern.test(msisdn)) {
    return {
      type: "error",
      code: "invalid_msisdn_format",
      severity: "recoverable",
      content:
        "Invalid phone number format. Expected MSISDN format: digits only with country code (e.g., 4712345678).",
      path: "$.payment.instruments[0].credential.value",
    };
  }

  return null; // Valid
}

// ============================================
// Payment Creation
// ============================================

export interface ProcessPaymentResult {
  success: boolean;
  session: CheckoutSession;
  httpStatus?: number;
}

/**
 * Processes a payment for a checkout session.
 * Creates a Vipps ePayment and updates the session accordingly.
 */
export async function processPayment(
  session: CheckoutSession,
  msisdn: string,
): Promise<ProcessPaymentResult> {
  const currency = session.currency
    .toUpperCase() as VippsEPaymentAmount["currency"];

  const totalEntry = session.totals.find((t: TotalEntry) => t.type === "total");
  const paymentResult = await createPayment(
    session.id,
    { phoneNumber: msisdn },
    totalEntry?.amount ?? 0,
    currency,
    `Order ${session.id}`,
    session.line_items,
    session.totals,
    TAX_RATE,
  );

  if (!paymentResult.success) {
    const requiresEscalation = paymentResult.messages.some(
      (msg) =>
        msg.type === "error" &&
        (msg.severity === "requires_buyer_input" ||
          msg.severity === "requires_buyer_review"),
    );

    session.status = requiresEscalation ? "requires_escalation" : "incomplete";
    session.messages = paymentResult.messages;

    return {
      success: false,
      session,
      httpStatus: paymentResult.httpStatus >= 500 ? 502 : 400,
    };
  }

  const now = Temporal.Now.instant();
  const paymentExpiresAt = now.add(
    Temporal.Duration.from({ milliseconds: PAYMENT_TIMEOUT_MS }),
  );

  if (paymentResult.data.state === "AUTHORIZED") {
    // Rare case: immediate authorization
    await updateStockForSession(session);

    session.status = "completed";
    session.order = {
      id: `order-${session.id}`,
      reference: `ORD-${now.toZonedDateTimeISO("UTC").year}-${session.id.slice(-6)
        }`,
      created_at: now.toString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_approved",
      content: "Payment approved. Your order has been placed.",
    }];
  } else {
    // Normal case: PUSH_MESSAGE flow - awaiting user approval
    session.status = "complete_in_progress";
    session.payment = {
      state: "pending_approval",
      vipps_reference: paymentResult.data.reference,
      expires_at: paymentExpiresAt.toString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_pending_user_approval",
      content:
        "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment to complete your order.",
    }];
  }

  session.updated_at = now.toString();
  session.metadata = {
    ...session.metadata,
    vipps_reference: paymentResult.data.reference,
    vipps_state: paymentResult.data.state,
    vipps_psp_reference: paymentResult.data.pspReference ?? "",
  };

  return { success: true, session };
}

/**
 * Updates stock for all items in a session.
 */
async function updateStockForSession(session: CheckoutSession): Promise<void> {
  for (const item of session.line_items) {
    const success = await updateStock(item.item.id, -item.quantity);
    if (!success) {
      console.error(`Stock update failed for ${item.item.id}`);
    }
  }
}

// ============================================
// Background Payment Polling
// ============================================

/** Result from one poll attempt; poll stops when done is true. */
type PaymentPollResult =
  | { done: true; reason: "session_gone" }
  | { done: true; reason: "already_processed" }
  | {
    done: true;
    reason: "terminal";
    state: string;
    pspReference?: string;
  }
  | { done: false };

/**
 * Starts background polling for payment status using @std/async poll.
 * This is a backup mechanism to callbacks.
 * @see https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 */
export async function startPaymentPolling(
  sessionId: string,
  vippsReference: string,
): Promise<void> {
  await delay(VIPPS_POLL_INITIAL_DELAY_MS);

  const pollTimeoutMs = VIPPS_POLL_MAX_ATTEMPTS * VIPPS_POLL_INTERVAL_MS;

  async function runOnePoll(): Promise<PaymentPollResult> {
    const sessions = await loadSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      return { done: true, reason: "session_gone" };
    }
    if (session.status !== "complete_in_progress") {
      return { done: true, reason: "already_processed" };
    }

    const statusResult = await getPaymentStatus(sessionId, vippsReference);
    if (!statusResult.success) {
      console.error(
        `Failed to get status for ${sessionId}: ${statusResult.error}`,
      );
      return { done: false };
    }

    const { state, pspReference } = statusResult.data;
    console.log(`Payment ${vippsReference} state: ${state}`);

    if (
      state === "AUTHORIZED" ||
      state === "ABORTED" ||
      state === "EXPIRED" ||
      state === "TERMINATED"
    ) {
      return { done: true, reason: "terminal", state, pspReference };
    }
    return { done: false };
  }

  try {
    const result = await poll(
      () => runOnePoll(),
      (r) => r.done === true,
      {
        interval: VIPPS_POLL_INTERVAL_MS,
        signal: AbortSignal.timeout(pollTimeoutMs),
      },
    );

    if (!result.done) {
      throw new Error("Unexpected: poll returned with done=false");
    }

    if (result.reason === "session_gone") {
      console.log(`Session ${sessionId} not found, stopping`);
      return;
    }
    if (result.reason === "already_processed") {
      console.log(
        `Session ${sessionId} already processed, stopping`,
      );
      return;
    }
    if (result.reason === "terminal") {
      switch (result.state) {
        case "AUTHORIZED":
          console.log(`Payment AUTHORIZED for ${sessionId}`);
          await processPaymentAuthorized(
            sessionId,
            vippsReference,
            result.pspReference,
          );
          return;
        case "ABORTED":
          console.log(`Payment ABORTED for ${sessionId}`);
          await processPaymentFailed(
            sessionId,
            "rejected",
            "payment_rejected",
            "Payment was declined. Please try again or choose a different payment method.",
          );
          return;
        case "EXPIRED":
          console.log(`Payment EXPIRED for ${sessionId}`);
          await processPaymentFailed(
            sessionId,
            "expired",
            "payment_expired",
            "Payment request expired. Please try again.",
          );
          return;
        case "TERMINATED":
          console.log(`Payment TERMINATED for ${sessionId}`);
          await processPaymentFailed(
            sessionId,
            "cancelled",
            "payment_cancelled",
            "Payment was cancelled. Please try again.",
          );
          return;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.log(`Max attempts reached for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "expired",
        "payment_expired",
        "Payment request timed out. Please try again.",
      );
      return;
    }
    throw err;
  }
}

/**
 * Processes a successful payment authorization.
 */
export async function processPaymentAuthorized(
  sessionId: string,
  vippsReference: string,
  pspReference?: string,
): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session || session.status !== "complete_in_progress") {
    return; // Already processed
  }

  const now = Temporal.Now.instant();

  // Update stock
  await updateStockForSession(session);

  session.status = "completed";
  session.payment = {
    state: "approved",
    vipps_reference: vippsReference,
    psp_reference: pspReference,
  };
  session.order = {
    id: `order-${session.id}`,
    reference: `ORD-${now.toZonedDateTimeISO("UTC").year}-${session.id.slice(-6)
      }`,
    created_at: now.toString(),
  };
  session.messages = [{
    type: "info",
    code: "payment_approved",
    content: "Payment approved. Your order has been placed.",
  }];
  session.updated_at = now.toString();

  await saveSessions(sessions);
  clearAccessToken(sessionId);
}

/**
 * Processes a failed payment (rejected, expired, cancelled).
 */
export async function processPaymentFailed(
  sessionId: string,
  paymentState: PaymentState,
  _errorCode: string,
  _errorMessage: string,
): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session || session.status !== "complete_in_progress") {
    return; // Already processed
  }

  // ABORTED, EXPIRED, TERMINATED are terminal states → checkout session canceled, no error message
  session.status = "canceled";
  session.payment = {
    ...session.payment,
    state: paymentState,
  };
  session.messages = [];
  session.updated_at = Temporal.Now.instant().toString();

  await saveSessions(sessions);
  clearAccessToken(sessionId);
}

// ============================================
// Vipps Callback Processing
// ============================================

/**
 * Vipps ePayment callback payload
 * @see https://developer.vippsmobilepay.com/api/epayment/#tag/Webhooks
 */
export interface VippsPaymentCallback {
  reference: string;
  pspReference?: string;
  name?: string;
  amount?: { currency: string; value: number };
  state?: string;
  paymentMethod?: { type: string };
  timestamp?: string;
}

/**
 * Processes a Vipps payment callback.
 * Returns the response to send back to Vipps.
 */
export async function processVippsCallback(
  callback: VippsPaymentCallback,
): Promise<{ status: string; httpStatus: number }> {
  console.log(`Received callback for ${callback.reference}: ${callback.state}`);

  const sessions = await loadSessions();
  const session = sessions.find(
    (s) =>
      s.metadata?.vipps_reference === callback.reference ||
      s.id === callback.reference,
  );

  if (!session) {
    console.error(`Session not found for reference: ${callback.reference}`);
    return { status: "session_not_found", httpStatus: 200 };
  }

  if (session.status !== "complete_in_progress") {
    console.log(`Session ${session.id} not in complete_in_progress, skipping`);
    return { status: "already_processed", httpStatus: 200 };
  }

  const now = Temporal.Now.instant();

  switch (callback.state) {
    case "AUTHORIZED": {
      console.log(`Payment AUTHORIZED for ${session.id}`);
      await updateStockForSession(session);

      session.status = "completed";
      session.payment = {
        state: "approved",
        vipps_reference: callback.reference,
        psp_reference: callback.pspReference,
      };
      session.order = {
        id: `order-${session.id}`,
        reference: `ORD-${now.toZonedDateTimeISO("UTC").year}-${session.id.slice(-6)
          }`,
        created_at: now.toString(),
      };
      session.messages = [{
        type: "info",
        code: "payment_approved",
        content: "Payment approved. Your order has been placed.",
      }];
      break;
    }

    case "ABORTED": {
      // Terminal state: payment rejected
      console.log(`Payment ABORTED for ${session.id}`);
      session.status = "canceled";
      session.payment = { ...session.payment, state: "rejected" };
      session.messages = [];
      break;
    }

    case "EXPIRED": {
      // Terminal state: payment expired
      console.log(`Payment EXPIRED for ${session.id}`);
      session.status = "canceled";
      session.payment = { ...session.payment, state: "expired" };
      session.messages = [];
      break;
    }

    case "TERMINATED": {
      // Terminal state: payment cancelled
      console.log(`Payment TERMINATED for ${session.id}`);
      session.status = "canceled";
      session.payment = { ...session.payment, state: "cancelled" };
      session.messages = [];
      break;
    }

    default:
      console.warn(`Unhandled state ${callback.state} for ${session.id}`);
  }

  session.updated_at = now.toString();
  await saveSessions(sessions);
  clearAccessToken(session.id);

  return { status: "ok", httpStatus: 200 };
}

// Re-export for convenience
export { prefetchAccessToken };
