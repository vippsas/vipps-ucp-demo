/**
 * UCP Order Webhook Sender.
 *
 * Sends signed order event webhooks to platforms per UCP specification.
 *
 * @module
 */

import { createDetachedSignature, getSigningKeyId } from "./signing_keys.ts";

const BUSINESS_ORIGIN = "http://localhost:8080";

/**
 * Send a signed webhook to a platform's webhook URL.
 *
 * @param webhookUrl - The platform's webhook URL (from capability negotiation)
 * @param payload - The order event payload
 * @returns The response from the platform
 */
export async function sendOrderWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const body = JSON.stringify(payload);

  // Create the detached signature
  const signature = await createDetachedSignature(body);

  console.log(`[WEBHOOK] Sending order event to ${webhookUrl}`);
  console.log(`[WEBHOOK] Origin: ${BUSINESS_ORIGIN}`);
  console.log(`[WEBHOOK] Signature kid: ${getSigningKeyId()}`);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": BUSINESS_ORIGIN,
      "Request-Signature": signature,
    },
    body,
  });

  console.log(`[WEBHOOK] Response status: ${response.status}`);

  return response;
}

/**
 * Create a fulfilled/shipped order event.
 *
 * @param orderId - The order ID
 * @param checkoutId - The checkout session ID this order originated from
 * @param trackingNumber - Shipping tracking number
 * @param trackingUrl - URL to track the shipment
 * @param carrier - Shipping carrier (e.g., "PostNord", "Bring")
 * @param status - Fulfillment status: "shipped", "in_transit", or "delivered"
 */
export function createShippedOrderEvent(
  orderId: string,
  checkoutId: string,
  trackingNumber: string,
  trackingUrl: string,
  carrier: string = "PostNord",
  status: "shipped" | "in_transit" | "delivered" = "delivered",
): Record<string, unknown> & { event_id: string } {
  const now = new Date().toISOString();
  const eventId = `evt-${crypto.randomUUID()}`;

  // Build fulfillment events based on status
  const fulfillmentEvents = [
    {
      id: "fe-1",
      type: "processing",
      line_items: [{ line_item_id: "li-1", quantity: 1 }],
      created_time: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
    },
    {
      id: "fe-2",
      type: "shipped",
      line_items: [{ line_item_id: "li-1", quantity: 1 }],
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      carrier,
      created_time: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
  ];

  // Add in_transit event if status is in_transit or delivered
  if (status === "in_transit" || status === "delivered") {
    fulfillmentEvents.push({
      id: "fe-3",
      type: "in_transit",
      line_items: [{ line_item_id: "li-1", quantity: 1 }],
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      carrier,
      created_time: new Date(Date.now() - 43200000).toISOString(), // 12 hours ago
    });
  }

  // Add delivered event if status is delivered
  if (status === "delivered") {
    fulfillmentEvents.push({
      id: "fe-4",
      type: "delivered",
      line_items: [{ line_item_id: "li-1", quantity: 1 }],
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      carrier,
      created_time: now,
    });
  }

  // Determine line item status based on fulfillment status
  const lineItemStatus = status === "delivered" ? "fulfilled" : "partial";
  const quantityFulfilled = status === "delivered" ? 1 : 0;

  // Update expectation description based on status
  const expectationDescription = status === "delivered"
    ? "✅ Delivered!"
    : status === "in_transit"
    ? `📦 In transit with ${carrier}`
    : `🚚 Shipped via ${carrier}`;

  return {
    ucp: {
      version: "2026-01-11",
    },
    id: orderId,
    checkout_id: checkoutId,
    permalink_url: `http://localhost:8080/orders/${orderId}`,
    event_id: eventId,
    created_time: now,
    line_items: [
      {
        id: "li-1",
        item: {
          id: "PROD-001",
          title: "Test Product",
          price: 9900,
        },
        quantity: {
          total: 1,
          fulfilled: quantityFulfilled,
        },
        totals: [
          { type: "subtotal", amount: 9900 },
          { type: "tax", amount: 2475 },
          { type: "total", amount: 12375 },
        ],
        status: lineItemStatus,
      },
    ],
    fulfillment: {
      expectations: [
        {
          id: "exp-1",
          line_items: [{ line_item_id: "li-1", quantity: 1 }],
          method_type: "shipping",
          destination: {
            street_address: "Test Street 1",
            postal_code: "0150",
            address_locality: "Oslo",
            address_country: "NO",
          },
          description: expectationDescription,
        },
      ],
      events: fulfillmentEvents,
    },
    totals: [
      { type: "subtotal", amount: 9900 },
      { type: "tax", amount: 2475 },
      { type: "fulfillment", display_text: "Shipping", amount: 0 },
      { type: "total", amount: 12375 },
    ],
  };
}
