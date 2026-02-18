import { getSessionById } from "../infrastructure/sessions.ts";
import {
  createShippedOrderEvent,
  sendOrderWebhook,
} from "../infrastructure/webhook_sender.ts";

/**
 * Simulates a shipping provider (PostNord/Bring/etc) notifying the merchant
 * that an order has been fulfilled, which then forwards the event to the
 * platform via the webhook URL discovered from the UCP-Agent profile.
 */
export async function handleShippingCallback(
  req: Request,
): Promise<Response> {
  const body = await req.json();

  const orderId = body.order_id;
  const checkoutId = body.checkout_id;

  if (!orderId || !checkoutId) {
    return Response.json(
      { error: "Missing required fields: order_id and checkout_id" },
      { status: 400 },
    );
  }

  const session = await getSessionById(checkoutId);

  if (!session) {
    return Response.json(
      { error: `Checkout session ${checkoutId} not found` },
      { status: 404 },
    );
  }

  const platformWebhookUrl = session.platform_webhook_url;

  if (!platformWebhookUrl) {
    return Response.json(
      {
        error: `No platform webhook URL stored for checkout ${checkoutId}. ` +
          `Platform must advertise dev.ucp.shopping.order capability with webhook_url in their profile.`,
        hint:
          "Ensure UCP-Agent header profile includes order capability with config.webhook_url",
      },
      { status: 400 },
    );
  }

  const trackingNumber = body.tracking_number ?? `PKG${Date.now()}`;
  const trackingUrl = body.tracking_url ??
    `https://tracking.postnord.com/${trackingNumber}`;
  const carrier = body.carrier ?? "PostNord";
  const status = body.status ?? "delivered";

  console.log("\n" + "=".repeat(60));
  console.log("📬 SHIPPING PROVIDER CALLBACK RECEIVED");
  console.log("=".repeat(60));
  console.log(`Order ID:        ${orderId}`);
  console.log(`Checkout ID:     ${checkoutId}`);
  console.log(`Carrier:         ${carrier}`);
  console.log(`Status:          ${status}`);
  console.log(`Tracking #:      ${trackingNumber}`);
  console.log(
    `Platform URL:    ${platformWebhookUrl} (from UCP-Agent profile)`,
  );
  console.log("=".repeat(60));

  const orderEvent = createShippedOrderEvent(
    orderId,
    checkoutId,
    trackingNumber,
    trackingUrl,
    carrier,
    status,
  );

  console.log(
    `\n🔔 Sending order webhook to platform: ${platformWebhookUrl}`,
  );

  const response = await sendOrderWebhook(platformWebhookUrl, orderEvent);
  const responseText = await response.text();

  console.log(`📨 Platform response: ${response.status}`);
  console.log("=".repeat(60) + "\n");

  return Response.json({
    success: response.ok,
    message: `Order ${orderId} fulfillment processed`,
    shipping: {
      carrier,
      status,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
    },
    webhook: {
      url: platformWebhookUrl,
      source: "UCP-Agent profile (dev.ucp.shopping.order capability)",
      status: response.status,
      event_id: orderEvent.event_id,
    },
    platform_response: responseText,
  });
}
