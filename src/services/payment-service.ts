/**
 * Payment Service
 *
 * Dispatches validate, create, and callback to the registered payment handler
 * for the given handler_id. No provider-specific logic here.
 */

import type { CheckoutSession, UCPMessage } from "../types/ucp/checkout.ts";
import type { WalletPaymentInstrument } from "../types/ucp/payment.ts";
import type {
  CallbackResult,
  ProcessPaymentResult,
  SessionAccess,
} from "../infrastructure/payment_handlers/types.ts";
import {
  getHandler,
  getRegisteredHandlerIds,
} from "../infrastructure/payment_handlers/types.ts";

/**
 * Validates the payment instrument using the handler for instrument.handler_id.
 * Returns null if valid, or a UCP error message if invalid or unknown handler.
 */
export function validatePaymentInstrument(
  instrument: WalletPaymentInstrument,
): UCPMessage | null {
  const handler = getHandler(instrument.handler_id);
  if (!handler) {
    const supported = getRegisteredHandlerIds().join(", ") || "none";
    return {
      type: "error",
      code: "unknown_handler",
      severity: "recoverable",
      content:
        `Unknown payment handler '${instrument.handler_id}'. This merchant supports: ${supported}`,
      path: "$.payment.instruments[0].handler_id",
    };
  }
  return handler.validate(instrument);
}

/**
 * Creates a payment via the handler for the instrument's handler_id.
 */
export function createPayment(
  session: CheckoutSession,
  instrument: WalletPaymentInstrument,
  sessionAccess: SessionAccess,
): Promise<ProcessPaymentResult> {
  const handler = getHandler(instrument.handler_id);
  if (!handler) {
    const supported = getRegisteredHandlerIds().join(", ") || "none";
    console.warn(
      `createPayment: unknown handler '${instrument.handler_id}' (supported: ${supported})`,
    );
    return Promise.resolve({
      success: false,
      session,
      httpStatus: 400,
    });
  }
  return handler.create({ session, instrument, sessionAccess });
}

/**
 * Handles a provider webhook (e.g. Vipps callback) by handler id.
 */
export function handlePaymentCallback(
  handlerId: string,
  payload: unknown,
): Promise<CallbackResult> {
  const handler = getHandler(handlerId);
  if (!handler?.handleCallback) {
    return Promise.resolve({ status: "unknown_handler", httpStatus: 404 });
  }
  return handler.handleCallback(payload);
}

export { getRegisteredHandlerIds };
