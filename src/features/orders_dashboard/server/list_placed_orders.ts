import { loadSessions } from "../../../infrastructure/sessions.ts";
import { toPlacedOrderSummary } from "../placed_order_dto.ts";

/**
 * JSON list of checkout sessions that have a placed order (payment completed).
 */
export function handleListPlacedOrders(): Response {
  const orders = loadSessions()
    .map(toPlacedOrderSummary)
    .filter((o): o is NonNullable<typeof o> => o != null)
    .sort((a, b) => {
      const ta = a.order.created_at;
      const tb = b.order.created_at;
      return tb.localeCompare(ta);
    });
  return Response.json({ orders });
}
