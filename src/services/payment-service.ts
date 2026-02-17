/**
 * Payment Service
 *
 * Handles payment processing, Vipps callbacks, and background polling.
 * Implements the payment flow for the Vipps MobilePay wallet handler.
 */

import {
  clearAccessToken,
  createPayment,
  getPaymentStatus,
  prefetchAccessToken,
} from "../infrastructure/vipps_epayment_client.ts";
import type { CheckoutSession, PaymentState, UCPMessage } from "../types.ts";
import type {
  VippsEPaymentAmount,
  VippsEPaymentMSISDNCustomer,
  VippsEPaymentTokenCustomer,
} from "../types/vipps/epayment.ts";
import type { WalletPaymentInstrument } from "../types/ucp/payment.ts";
import { updateStock } from "../routes/products.ts";
import { loadSessions, saveSessions, TAX_RATE } from "./checkout-service.ts";

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
 * Matches the payment handler: com.vippsmobilepay.pay.payment_handler
 * @see https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler
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
  customer: VippsEPaymentTokenCustomer | VippsEPaymentMSISDNCustomer,
): Promise<ProcessPaymentResult> {
  const currency = session.currency
    .toUpperCase() as VippsEPaymentAmount["currency"];

  const totalEntry = session.totals.find((t) => t.type === "total");
  const paymentResult = await createPayment(
    session.id,
    customer,
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

  const now = new Date();
  const paymentExpiresAt = new Date(now.getTime() + PAYMENT_TIMEOUT_MS);

  if (paymentResult.data.state === "AUTHORIZED") {
    // Rare case: immediate authorization
    await updateStockForSession(session);

    session.status = "completed";
    session.order = {
      id: `order-${session.id}`,
      reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
      created_at: now.toISOString(),
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
      expires_at: paymentExpiresAt.toISOString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_pending_user_approval",
      content:
        "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment to complete your order.",
    }];
  }

  session.updated_at = now.toISOString();
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
      console.error(`[Payment] Stock update failed for ${item.item.id}`);
    }
  }
}

// ============================================
// Background Payment Polling
// ============================================

/**
 * Starts background polling for payment status.
 * This is a backup mechanism to callbacks.
 * @see https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 */
export async function startPaymentPolling(
  sessionId: string,
  vippsReference: string,
): Promise<void> {
  console.log(`[VippsPolling] Starting background polling for ${sessionId}`);

  // Wait initial delay per Vipps guidelines
  await new Promise((resolve) =>
    setTimeout(resolve, VIPPS_POLL_INITIAL_DELAY_MS)
  );

  for (let attempt = 0; attempt < VIPPS_POLL_MAX_ATTEMPTS; attempt++) {
    const sessions = await loadSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      console.log(`[VippsPolling] Session ${sessionId} not found, stopping`);
      return;
    }

    // If already processed (by callback), stop polling
    if (session.status !== "complete_in_progress") {
      console.log(
        `[VippsPolling] Session ${sessionId} already processed (${session.status}), stopping`,
      );
      return;
    }

    // Poll Vipps for payment status
    const result = await getPaymentStatus(sessionId, vippsReference);

    if (!result.success) {
      console.warn(
        `[VippsPolling] Failed to get status for ${sessionId}: ${result.error}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, VIPPS_POLL_INTERVAL_MS)
      );
      continue;
    }

    const { state, pspReference } = result.data;
    console.log(`[VippsPolling] Payment ${vippsReference} state: ${state}`);

    // Process terminal states
    if (state === "AUTHORIZED") {
      console.log(`[VippsPolling] Payment AUTHORIZED for ${sessionId}`);
      await processPaymentAuthorized(sessionId, vippsReference, pspReference);
      return;
    }

    if (state === "ABORTED") {
      console.log(`[VippsPolling] Payment ABORTED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "rejected",
        "payment_rejected",
        "Payment was declined. Please try again or choose a different payment method.",
      );
      return;
    }

    if (state === "EXPIRED") {
      console.log(`[VippsPolling] Payment EXPIRED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "expired",
        "payment_expired",
        "Payment request expired. Please try again.",
      );
      return;
    }

    if (state === "TERMINATED") {
      console.log(`[VippsPolling] Payment TERMINATED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "cancelled",
        "payment_cancelled",
        "Payment was cancelled. Please try again.",
      );
      return;
    }

    // Still CREATED - wait and poll again
    await new Promise((resolve) => setTimeout(resolve, VIPPS_POLL_INTERVAL_MS));
  }

  // Max attempts reached
  console.log(`[VippsPolling] Max attempts reached for ${sessionId}`);
  await processPaymentFailed(
    sessionId,
    "expired",
    "payment_expired",
    "Payment request timed out. Please try again.",
  );
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

  const now = new Date();

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
    reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
    created_at: now.toISOString(),
  };
  session.messages = [{
    type: "info",
    code: "payment_approved",
    content: "Payment approved. Your order has been placed.",
  }];
  session.updated_at = now.toISOString();

  await saveSessions(sessions);
  clearAccessToken(sessionId);
}

/**
 * Processes a failed payment (rejected, expired, cancelled).
 */
export async function processPaymentFailed(
  sessionId: string,
  paymentState: PaymentState,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session || session.status !== "complete_in_progress") {
    return; // Already processed
  }

  session.status = "incomplete";
  session.payment = {
    ...session.payment,
    state: paymentState,
  };
  session.messages = [{
    type: "error",
    code: errorCode,
    severity: "requires_buyer_input",
    content: errorMessage,
  }];
  session.updated_at = new Date().toISOString();

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
  console.log(
    `[VippsCallback] Received callback for ${callback.reference}: ${callback.state}`,
  );

  const sessions = await loadSessions();
  const session = sessions.find(
    (s) =>
      s.metadata?.vipps_reference === callback.reference ||
      s.id === callback.reference,
  );

  if (!session) {
    console.warn(
      `[VippsCallback] Session not found for reference: ${callback.reference}`,
    );
    return { status: "session_not_found", httpStatus: 200 };
  }

  if (session.status !== "complete_in_progress") {
    console.log(
      `[VippsCallback] Session ${session.id} not in complete_in_progress, skipping`,
    );
    return { status: "already_processed", httpStatus: 200 };
  }

  const now = new Date();

  switch (callback.state) {
    case "AUTHORIZED": {
      console.log(`[VippsCallback] Payment AUTHORIZED for ${session.id}`);
      await updateStockForSession(session);

      session.status = "completed";
      session.payment = {
        state: "approved",
        vipps_reference: callback.reference,
        psp_reference: callback.pspReference,
      };
      session.order = {
        id: `order-${session.id}`,
        reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
        created_at: now.toISOString(),
      };
      session.messages = [{
        type: "info",
        code: "payment_approved",
        content: "Payment approved. Your order has been placed.",
      }];
      break;
    }

    case "ABORTED": {
      console.log(`[VippsCallback] Payment ABORTED for ${session.id}`);
      session.status = "incomplete";
      session.payment = { ...session.payment, state: "rejected" };
      session.messages = [{
        type: "error",
        code: "payment_rejected",
        severity: "requires_buyer_input",
        content:
          "Payment was declined. Please try again or choose a different payment method.",
      }];
      break;
    }

    case "EXPIRED": {
      console.log(`[VippsCallback] Payment EXPIRED for ${session.id}`);
      session.status = "incomplete";
      session.payment = { ...session.payment, state: "expired" };
      session.messages = [{
        type: "error",
        code: "payment_expired",
        severity: "requires_buyer_input",
        content: "Payment request expired. Please try again.",
      }];
      break;
    }

    case "TERMINATED": {
      console.log(`[VippsCallback] Payment TERMINATED for ${session.id}`);
      session.status = "incomplete";
      session.payment = { ...session.payment, state: "cancelled" };
      session.messages = [{
        type: "error",
        code: "payment_cancelled",
        severity: "requires_buyer_input",
        content: "Payment was cancelled. Please try again.",
      }];
      break;
    }

    default:
      console.log(
        `[VippsCallback] Unhandled state ${callback.state} for ${session.id}`,
      );
  }

  session.updated_at = now.toISOString();
  await saveSessions(sessions);
  clearAccessToken(session.id);

  return { status: "ok", httpStatus: 200 };
}

// Re-export for convenience
export { prefetchAccessToken };
