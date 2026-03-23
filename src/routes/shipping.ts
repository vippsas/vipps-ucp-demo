import {
  getSessionById,
  loadSessions,
  saveSessions,
} from "../infrastructure/sessions.ts";
import {
  createShippedOrderEvent,
  sendOrderWebhook,
} from "../infrastructure/webhook_sender.ts";

/**
 * Simulates a shipping provider (PostNord/Bring/etc) notifying the merchant,
 * then POSTs a UCP [Order Event](https://ucp.dev/latest/specification/order/#order-event-webhook)
 * to the platform `webhook_url` from `dev.ucp.shopping.order` (UCP-Agent profile).
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

  const trackingNumber = body.tracking_number ??
    `PKG${Temporal.Now.instant().epochMilliseconds}`;
  const trackingUrl = body.tracking_url ??
    `https://tracking.postnord.com/${trackingNumber}`;
  const carrier = body.carrier ?? "PostNord";
  const status = body.status ?? "delivered";

  console.log(
    `Shipping callback: orderId=${orderId} checkoutId=${checkoutId} carrier=${carrier} status=${status} tracking=${trackingNumber}`,
  );

  const orderEvent = createShippedOrderEvent(
    session,
    orderId,
    trackingNumber,
    trackingUrl,
    carrier,
    status,
  );

  console.log(`Sending order webhook to platform: ${platformWebhookUrl}`);

  const response = await sendOrderWebhook(platformWebhookUrl, orderEvent);
  const responseText = await response.text();

  console.log(`Platform response: ${response.status}`);

  if (response.ok) {
    const notifiedAt = Temporal.Now.instant().toString();
    const sessions = loadSessions();
    const idx = sessions.findIndex((s) => s.id === checkoutId);
    if (idx >= 0) {
      const s = sessions[idx]!;
      sessions[idx] = {
        ...s,
        updated_at: notifiedAt,
        demo: {
          ...s.demo,
          last_order_event_webhook: {
            notified_at: notifiedAt,
            event_id: orderEvent.event_id,
            http_status: response.status,
            fulfillment_event_type: status,
            tracking_number: trackingNumber,
            tracking_url: trackingUrl,
            carrier,
          },
        },
      };
      saveSessions(sessions);
    }
  }

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
