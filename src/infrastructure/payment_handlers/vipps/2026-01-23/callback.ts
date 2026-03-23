/**
 * Applies a payment status update from a JSON payload (same transitions as polling).
 *
 * **Not the Vipps Webhooks API:** Production integrations must register URLs via
 * `POST /webhooks/v1/webhooks` and verify HMAC per Vipps docs. This handler is
 * only used by `POST /api/payment/vipps/callback` for manual testing or local
 * simulation. The demo’s real path is **polling** in `polling.ts`.
 *
 * @see https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/api-guide/
 */

import type { CallbackResult } from "../../types.ts";
import type { SessionAccess } from "../../types.ts";
import { clearAccessToken } from "./epayment_client.ts";

export interface VippsPaymentCallback {
  reference: string;
  pspReference?: string;
  name?: string;
  amount?: { currency: string; value: number };
  state?: string;
  paymentMethod?: { type: string };
  timestamp?: string;
}

export function handleVippsCallback(
  payload: unknown,
  sessionAccess: SessionAccess,
): CallbackResult {
  const callback = payload as VippsPaymentCallback;
  console.log(`Received callback for ${callback.reference}: ${callback.state}`);

  const sessions = sessionAccess.loadSessions();
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
      session.status = "completed";
      session.payment = {
        state: "approved",
        vipps_reference: callback.reference,
        psp_reference: callback.pspReference,
      };
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
      break;
    }
    case "ABORTED": {
      console.log(`Payment ABORTED for ${session.id}`);
      session.status = "canceled";
      session.payment = { ...session.payment, state: "rejected" };
      session.messages = [];
      break;
    }
    case "EXPIRED": {
      console.log(`Payment EXPIRED for ${session.id}`);
      session.status = "canceled";
      session.payment = { ...session.payment, state: "expired" };
      session.messages = [];
      break;
    }
    case "TERMINATED": {
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
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  sessionAccess.saveSessions(sessions);
  clearAccessToken(session.id);

  return { status: "ok", httpStatus: 200 };
}
