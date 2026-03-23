/**
 * Payment handlers: re-export contract from central types and registry from this module.
 * Import from here for convenience, or from types/ucp/payment_handler.ts and registry.ts directly.
 */

export type {
  CallbackResult,
  CreatePaymentContext,
  PaymentHandlerImpl,
  ProcessPaymentResult,
  SessionAccess,
} from "../../types/ucp/payment_handler.ts";

export {
  getHandler,
  getRegisteredHandlerIds,
  registerHandler,
} from "./registry.ts";
