/**
 * Payment handler contract and DTOs.
 *
 * Defines the shape of a UCP payment handler (validate, create, callback)
 * and the result types used by the payment service. No runtime state —
 * the registry lives in infrastructure.
 */

import type { CheckoutSession, UCPMessage } from "./checkout.ts";
import type { WalletPaymentInstrument } from "./payment.ts";

/** Result of processing a payment (create or async completion). */
export interface ProcessPaymentResult {
  success: boolean;
  session: CheckoutSession;
  httpStatus?: number;
}

/** Result of handling a provider webhook (e.g. Vipps callback). */
export interface CallbackResult {
  status: string;
  httpStatus: number;
}

/** Session access for handlers (in-memory: sync load/save). */
export interface SessionAccess {
  loadSessions: () => CheckoutSession[];
  saveSessions: (sessions: CheckoutSession[]) => void;
}

/** Context passed to createPayment. */
export interface CreatePaymentContext {
  session: CheckoutSession;
  instrument: WalletPaymentInstrument;
  sessionAccess: SessionAccess;
}

/** Contract implemented by each versioned payment handler. */
export interface PaymentHandlerImpl {
  readonly id: string;

  /** Validate instrument; returns null if valid, else UCP error message. */
  validate(instrument: WalletPaymentInstrument): UCPMessage | null;

  /** Create payment and optionally start async polling. Returns result with updated session. */
  create(ctx: CreatePaymentContext): Promise<ProcessPaymentResult>;

  /** Handle provider webhook (e.g. Vipps callback). Optional. */
  handleCallback?(payload: unknown): Promise<CallbackResult>;
}
