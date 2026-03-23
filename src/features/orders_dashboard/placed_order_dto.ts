import type {
  CheckoutSession,
  InternalOrderEventWebhookReceipt,
} from "../../types/ucp/checkout.ts";

/** JSON shape returned by `GET /api/demo/orders` (one row per placed order). */
export type PlacedOrderSummary = {
  checkout_id: string;
  session_status: CheckoutSession["status"];
  currency: string;
  order: NonNullable<CheckoutSession["order"]>;
  line_items: CheckoutSession["line_items"];
  totals: CheckoutSession["totals"];
  buyer: CheckoutSession["buyer"];
  shipping_address: CheckoutSession["shipping_address"];
  platform_webhook_configured: boolean;
  last_order_event_webhook: InternalOrderEventWebhookReceipt | null;
};

export function toPlacedOrderSummary(
  s: CheckoutSession,
): PlacedOrderSummary | null {
  if (s.order == null) return null;
  return {
    checkout_id: s.id,
    session_status: s.status,
    currency: s.currency,
    order: s.order,
    line_items: s.line_items,
    totals: s.totals,
    buyer: s.buyer,
    shipping_address: s.shipping_address,
    platform_webhook_configured: Boolean(s.platform_webhook_url),
    last_order_event_webhook: s.demo?.last_order_event_webhook ?? null,
  };
}
