/**
 * Background polling for Vipps payment status (backup to callbacks).
 * @see https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 */

import { delay } from "@std/async/delay";
import { poll } from "@std/async/unstable-poll";
import type { SessionAccess } from "../../types.ts";
import { clearAccessToken } from "./epayment_client.ts";
import { getPaymentStatus } from "./epayment_client.ts";
import {
  VIPPS_POLL_INITIAL_DELAY_MS,
  VIPPS_POLL_INTERVAL_MS,
  VIPPS_POLL_MAX_ATTEMPTS,
} from "./constants.ts";

type PaymentPollResult =
  | { done: true; reason: "session_gone" }
  | { done: true; reason: "already_processed" }
  | { done: true; reason: "terminal"; state: string; pspReference?: string }
  | { done: false };

export function startPaymentPolling(
  sessionId: string,
  vippsReference: string,
  sessionAccess: SessionAccess,
): Promise<void> {
  async function run(): Promise<void> {
    await delay(VIPPS_POLL_INITIAL_DELAY_MS);

    const pollTimeoutMs = VIPPS_POLL_MAX_ATTEMPTS * VIPPS_POLL_INTERVAL_MS;

    async function runOnePoll(): Promise<PaymentPollResult> {
      const sessions = sessionAccess.loadSessions();
      const session = sessions.find((s) => s.id === sessionId);

      if (!session) return { done: true, reason: "session_gone" };
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

      if (!result.done) return;

      if (result.reason === "session_gone") {
        console.log(`Session ${sessionId} not found, stopping`);
        return;
      }
      if (result.reason === "already_processed") {
        console.log(`Session ${sessionId} already processed, stopping`);
        return;
      }
      if (result.reason === "terminal") {
        switch (result.state) {
          case "AUTHORIZED":
            await applyAuthorized(
              sessionId,
              vippsReference,
              result.pspReference,
              sessionAccess,
            );
            return;
          case "ABORTED":
            await applyFailed(sessionId, "rejected", sessionAccess);
            return;
          case "EXPIRED":
            await applyFailed(sessionId, "expired", sessionAccess);
            return;
          case "TERMINATED":
            await applyFailed(sessionId, "cancelled", sessionAccess);
            return;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.log(`Max attempts reached for ${sessionId}`);
        await applyFailed(sessionId, "expired", sessionAccess);
        return;
      }
      throw err;
    }
  }

  return run();
}

function applyAuthorized(
  sessionId: string,
  vippsReference: string,
  pspReference: string | undefined,
  sessionAccess: SessionAccess,
): void {
  const sessions = sessionAccess.loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== "complete_in_progress") return;

  const now = Temporal.Now.instant();
  session.status = "completed";
  session.payment = {
    state: "approved",
    vipps_reference: vippsReference,
    psp_reference: pspReference,
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
  session.updated_at = now.toString();

  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) sessions[idx] = session;
  sessionAccess.saveSessions(sessions);
  clearAccessToken(sessionId);
}

function applyFailed(
  sessionId: string,
  paymentState: "rejected" | "expired" | "cancelled",
  sessionAccess: SessionAccess,
): void {
  const sessions = sessionAccess.loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== "complete_in_progress") return;

  session.status = "canceled";
  session.payment = { ...session.payment, state: paymentState };
  session.messages = [];
  session.updated_at = Temporal.Now.instant().toString();

  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) sessions[idx] = session;
  sessionAccess.saveSessions(sessions);
  clearAccessToken(sessionId);
}
