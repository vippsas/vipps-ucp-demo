/**
 * Payment handler registry (runtime).
 * Handlers register by handler_id; the payment service looks them up here.
 */

import type { PaymentHandlerImpl } from "../../types/ucp/payment_handler.ts";

const registry = new Map<string, PaymentHandlerImpl>();

export function registerHandler(handler: PaymentHandlerImpl): void {
  if (registry.has(handler.id)) {
    console.warn(
      `Payment handler '${handler.id}' already registered, overwriting`,
    );
  }
  registry.set(handler.id, handler);
}

export function getHandler(handlerId: string): PaymentHandlerImpl | undefined {
  return registry.get(handlerId);
}

export function getRegisteredHandlerIds(): string[] {
  return Array.from(registry.keys());
}
