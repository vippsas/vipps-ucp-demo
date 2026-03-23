/**
 * Vipps MobilePay wallet payment handler (UCP 2026-01-23).
 * Registers the handler with the central payment handler registry.
 * @see https://ucp.vippsmobilepay.com/ucp/2026-01-23/schemas/wallet_payment_handler.json
 */

import type { PaymentHandlerImpl } from "../../types.ts";
import type { SessionAccess } from "../../types.ts";
import { registerHandler } from "../../types.ts";
import { VIPPS_WALLET_HANDLER_ID } from "./validate.ts";
import { validateInstrument } from "./validate.ts";
import { createVippsPayment } from "./create.ts";
import { handleVippsCallback } from "./callback.ts";

/**
 * Register the Vipps wallet payment handler.
 * Call once at startup with the app's session access (in-memory load/save).
 */
export function registerVippsPaymentHandler(
  sessionAccess: SessionAccess,
): void {
  const impl: PaymentHandlerImpl = {
    id: VIPPS_WALLET_HANDLER_ID,
    validate: validateInstrument,
    create: (ctx) => createVippsPayment(ctx),
    handleCallback: (payload) =>
      Promise.resolve(handleVippsCallback(payload, sessionAccess)),
  };
  registerHandler(impl);
}

export { VIPPS_WALLET_HANDLER_ID } from "./validate.ts";
export { prefetchAccessToken } from "./epayment_client.ts";
