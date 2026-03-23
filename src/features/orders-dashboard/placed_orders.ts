import { loadSessions } from "../../infrastructure/sessions.ts";
import type { CheckoutSession } from "../../types/ucp/checkout.ts";

function orderSummary(s: CheckoutSession) {
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
    merchant_fulfillment: s.merchant_fulfillment ?? null,
  };
}

/**
 * JSON list of checkout sessions that have a placed order (payment completed).
 */
export function handleListPlacedOrders(): Response {
  const orders = loadSessions()
    .filter((s) => s.order != null)
    .sort((a, b) => {
      const ta = a.order?.created_at ?? "";
      const tb = b.order?.created_at ?? "";
      return tb.localeCompare(ta);
    })
    .map(orderSummary);
  return Response.json({ orders });
}
