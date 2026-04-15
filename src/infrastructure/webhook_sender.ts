/**
 * UCP Order Webhook Sender.
 *
 * Sends signed order event webhooks to platforms per UCP specification.
 *
 * @module
 */

import { canonicalize } from "@std/json/unstable-canonicalize";
import type { JsonValue } from "@std/json/types";
import type { CheckoutSession, TotalEntry } from "../types/ucp/checkout.ts";
import { createContentDigestHeader } from "./content_digest.ts";
import { signMessage } from "../libs/std_candidates/message_signatures.ts";
import { getSigningKeyId, getSigningPrivateKey } from "./signing_keys.ts";
import { getCapability, getUCPVersion } from "./ucp_profile.ts";
import { serializeUCPAgent, UCP_HEADERS } from "./ucp_headers.ts";

/** Public origin of this merchant; platform uses UCP-Agent profile URL to fetch signing keys. */
function businessOrigin(): string {
  return Deno.env.get("UCP_BUSINESS_ORIGIN") ?? "http://localhost:8081";
}

function businessProfileUrl(): string {
  const base = businessOrigin().replace(/\/$/, "");
  return `${base}/.well-known/ucp`;
}

/**
 * Send a signed webhook to a platform's webhook URL.
 *
 * @param webhookUrl - The platform's webhook URL (from capability negotiation)
 * @param payload - The order event payload
 * @returns The response from the platform
 */
export async function sendOrderWebhook(
  webhookUrl: string,
  payload: JsonValue,
): Promise<Response> {
  const body = canonicalize(payload);
  const contentDigest = await createContentDigestHeader(body);

  const origin = businessOrigin();
  const ucpAgent = serializeUCPAgent({
    profile: businessProfileUrl(),
    name: "vipps-ucp-demo-merchant",
    version: 1,
  });

  console.log(
    `Sending order event to ${webhookUrl} origin=${origin} kid=${getSigningKeyId()} UCP-Agent profile=${businessProfileUrl()}`,
  );

  const unsigned = new Request(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Digest": contentDigest,
      "Origin": origin,
      [UCP_HEADERS.AGENT]: ucpAgent,
      [UCP_HEADERS.API_VERSION]: getUCPVersion(),
    },
    body,
  });

  const signed = await signMessage({
    message: unsigned,
    params: {
      components: [
        "@method",
        "@authority",
        "@path",
        "content-digest",
        "content-type",
      ],
      keyId: getSigningKeyId(),
      algorithm: "ecdsa-p256-sha256",
      created: Math.floor(Date.now() / 1000),
    },
    key: getSigningPrivateKey(),
  });

  const response = await fetch(signed);

  console.log(`Response status: ${response.status}`);

  return response;
}

/**
 * `ucp` block for [Order Event webhook](https://ucp.dev/latest/specification/order/#order-event-webhook) payloads.
 */
function orderEventUcpMetadata(): JsonValue {
  const version = getUCPVersion();
  const orderCap = getCapability("dev.ucp.shopping.order");
  const orderVersion = orderCap?.version ?? version;
  return {
    version,
    capabilities: {
      "dev.ucp.shopping.order": [{ version: orderVersion }],
    },
  };
}

/** Map checkout totals to Order capability [Total](https://ucp.dev/latest/specification/order/#total) entries. */
function mapOrderTotals(totals: TotalEntry[]): JsonValue[] {
  return totals.map((t) => {
    if (t.type === "shipping") {
      return {
        type: "fulfillment",
        display_text: t.description ?? "Shipping",
        amount: t.amount,
      };
    }
    const row: Record<string, JsonValue> = { type: t.type, amount: t.amount };
    if (t.description) row.display_text = t.description;
    return row;
  });
}

function mapLineItemTotals(totals: TotalEntry[]): JsonValue[] {
  return totals.map((t) => {
    const row: Record<string, JsonValue> = { type: t.type, amount: t.amount };
    if (t.description) row.display_text = t.description;
    return row;
  });
}

function lineRefs(
  session: CheckoutSession,
): { id: string; quantity: number }[] {
  return session.line_items.map((li) => ({ id: li.id, quantity: li.quantity }));
}

function fulfilledCount(
  lineQty: number,
  status: "shipped" | "in_transit" | "delivered",
): number {
  if (status === "delivered") return lineQty;
  return 0;
}

function lineItemOrderStatus(
  total: number,
  fulfilled: number,
): "processing" | "partial" | "fulfilled" {
  if (fulfilled >= total) return "fulfilled";
  if (fulfilled > 0) return "partial";
  return "processing";
}

function expectationDestination(session: CheckoutSession): JsonValue {
  const a = session.shipping_address;
  if (!a) {
    return {
      street_address: "Unknown",
      postal_code: "0000",
      address_locality: "Unknown",
      address_country: session.currency === "NOK" ? "NO" : "XX",
    };
  }
  const parts = a.name.trim().split(/\s+/);
  const dest: Record<string, string> = {
    street_address: a.line_two ? `${a.line_one}, ${a.line_two}` : a.line_one,
    address_locality: a.city,
    address_region: a.state,
    address_country: a.country,
    postal_code: a.postal_code,
  };
  if (parts.length > 0) dest.first_name = parts[0]!;
  if (parts.length > 1) dest.last_name = parts.slice(1).join(" ");
  return dest;
}

/**
 * Build a full [Order Event](https://ucp.dev/latest/specification/order/#order-event-webhook) body
 * from the checkout session (immutable line items + totals) plus a new fulfillment snapshot.
 *
 * @see https://ucp.dev/latest/specification/order/#fulfillment-event — `occurred_at`, `line_items[].id`
 */
/** Minimal shape exposed to callers; the full payload is a {@link JsonValue}. */
export interface OrderEvent {
  event_id: string;
  [key: string]: JsonValue | undefined;
}

export function createShippedOrderEvent(
  session: CheckoutSession,
  orderId: string,
  trackingNumber: string,
  trackingUrl: string,
  carrier: string = "PostNord",
  status: "shipped" | "in_transit" | "delivered" = "delivered",
): OrderEvent {
  const now = Temporal.Now.instant();
  const nowStr = now.toString();
  const eventId = `evt-${crypto.randomUUID()}`;
  const refs = lineRefs(session);

  const fulfillmentEvents: JsonValue[] = [];
  const t0 = now.subtract(Temporal.Duration.from({ hours: 48 })).toString();
  fulfillmentEvents.push({
    id: `fe-proc-${crypto.randomUUID().slice(0, 8)}`,
    occurred_at: t0,
    type: "processing",
    line_items: refs.map((r) => ({ id: r.id, quantity: r.quantity })),
    description: "Order prepared for shipment",
  });

  const withTracking = (
    type: string,
    at: string,
    idPrefix: string,
    extra?: Record<string, JsonValue>,
  ): Record<string, JsonValue> => ({
    id: `${idPrefix}-${crypto.randomUUID().slice(0, 8)}`,
    occurred_at: at,
    type,
    line_items: refs.map((r) => ({ id: r.id, quantity: r.quantity })),
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    carrier,
    ...extra,
  });

  const tShip = now.subtract(Temporal.Duration.from({ hours: 24 })).toString();
  if (
    status === "shipped" || status === "in_transit" || status === "delivered"
  ) {
    fulfillmentEvents.push(withTracking("shipped", tShip, "fe-ship"));
  }
  if (status === "in_transit" || status === "delivered") {
    fulfillmentEvents.push(
      withTracking(
        "in_transit",
        now.subtract(Temporal.Duration.from({ hours: 12 })).toString(),
        "fe-tr",
      ),
    );
  }
  if (status === "delivered") {
    fulfillmentEvents.push(
      withTracking("delivered", nowStr, "fe-del", { description: "Delivered" }),
    );
  }

  const expectationDescription = status === "delivered"
    ? "Delivered"
    : status === "in_transit"
    ? `In transit with ${carrier}`
    : `Shipped via ${carrier}`;

  const orderLineItems = session.line_items.map((li) => {
    const fulfilled = fulfilledCount(li.quantity, status);
    return {
      id: li.id,
      item: {
        id: li.item.id,
        title: li.item.title,
        price: li.item.price,
        ...(li.item.image_url ? { image_url: li.item.image_url } : {}),
      },
      quantity: { total: li.quantity, fulfilled },
      totals: mapLineItemTotals(li.totals),
      status: lineItemOrderStatus(li.quantity, fulfilled),
    };
  });

  return {
    ucp: orderEventUcpMetadata(),
    id: orderId,
    checkout_id: session.id,
    permalink_url: `${businessOrigin()}/orders/${orderId}`,
    event_id: eventId,
    created_time: nowStr,
    line_items: orderLineItems,
    fulfillment: {
      expectations: [
        {
          id: `exp-${session.id.slice(-8)}`,
          line_items: refs.map((r) => ({ id: r.id, quantity: r.quantity })),
          method_type: "shipping",
          destination: expectationDestination(session),
          description: expectationDescription,
          fulfillable_on: "now",
        },
      ],
      events: fulfillmentEvents,
    },
    totals: mapOrderTotals(session.totals),
  };
}
