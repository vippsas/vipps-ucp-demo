/** Mirrors `PlacedOrderSummary` from the demo API (browser-safe). */
export type LastOrderEventWebhook = {
  notified_at: string;
  event_id: string;
  http_status: number;
  fulfillment_event_type: string;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
};

export type PlacedOrderSummary = {
  checkout_id: string;
  session_status: string;
  currency: string;
  order: { id: string; reference: string; created_at: string };
  line_items: Array<{
    id: string;
    item: { title?: string; price?: number };
    quantity: number;
  }>;
  totals: Array<{ type: string; amount: number }>;
  buyer?: { name?: string };
  shipping_address?: {
    name?: string;
    line_one?: string;
    postal_code?: string;
    city?: string;
  };
  platform_webhook_configured: boolean;
  last_order_event_webhook: LastOrderEventWebhook | null;
};

export type OrdersListResponse = { orders: PlacedOrderSummary[] };
