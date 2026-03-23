/**
 * Vipps payment creation: call ePayment API, update session, start polling.
 */

import type { TotalEntry } from "../../../../types/ucp/checkout.ts";
import type { VippsEPaymentAmount } from "../../../../types/vipps/epayment.ts";
import type {
  CreatePaymentContext,
  ProcessPaymentResult,
} from "../../types.ts";
import { createPayment } from "./epayment_client.ts";
import { PAYMENT_TIMEOUT_MS, TAX_RATE } from "./constants.ts";
import { startPaymentPolling } from "./polling.ts";

export async function createVippsPayment(
  ctx: CreatePaymentContext,
): Promise<ProcessPaymentResult> {
  const { session, instrument, sessionAccess } = ctx;
  const currency = session.currency
    .toUpperCase() as VippsEPaymentAmount["currency"];
  const totalEntry = session.totals.find((t: TotalEntry) => t.type === "total");

  const customer = instrument.credential.type === "MSISDN"
    ? { phoneNumber: instrument.credential.value }
    : { customerToken: instrument.credential.value };

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
    const sessions = sessionAccess.loadSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    sessionAccess.saveSessions(sessions);
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
    session.status = "completed";
    session.order = {
      id: `order-${session.id}`,
      reference: `ORD-${now.toZonedDateTimeISO("UTC").year}-${
        session.id.slice(-6)
      }`,
      created_at: now.toString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_approved",
      content: "Payment approved. Your order has been placed.",
    }];
  } else {
    session.status = "complete_in_progress";
    session.payment = {
      ...session.payment,
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

  const sessions = sessionAccess.loadSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  sessionAccess.saveSessions(sessions);

  // Demo: terminal state is detected via polling only (see README — production should add Vipps Webhooks API).
  if (
    session.status === "complete_in_progress" &&
    session.payment?.vipps_reference
  ) {
    startPaymentPolling(
      session.id,
      session.payment.vipps_reference,
      sessionAccess,
    ).catch((err) => {
      console.error(`Background polling failed for ${session.id}:`, err);
    });
  }

  return { success: true, session };
}
