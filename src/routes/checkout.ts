import {
  buildAvailableMethods,
  buildFulfillmentMethods,
  getSelectedFulfillmentCost,
} from "../infrastructure/fulfillment.ts";
import {
  parseUCPHeaders,
  serializeUCPCapabilities,
  serializeUCPRequestContext,
  UCP_HEADERS,
} from "../infrastructure/ucp_headers.ts";
import { discoverPlatformWebhookUrl } from "../infrastructure/platform_profile.ts";
import {
  getUCPResponseMetadata,
  getUCPVersion,
} from "../infrastructure/ucp_profile.ts";
import {
  initializeAncillaries,
  updateAncillaries,
} from "../services/ancillaries-service.ts";
import {
  createPayment,
  handlePaymentCallback,
  validatePaymentInstrument,
} from "../services/payment-service.ts";
import {
  prefetchAccessToken,
  VIPPS_WALLET_HANDLER_ID,
} from "../infrastructure/payment_handlers/vipps/2026-01-23/payment_handler.ts";
import type {
  CheckoutSession,
  CreateCheckoutSessionRequest,
  Item,
  LineItemResponse,
  Link,
  TotalEntry,
  UCPMessage,
  UpdateCheckoutSessionRequest,
} from "../types/ucp/checkout.ts";
import type { CompleteCheckoutRequest } from "../types/ucp/payment.ts";
import {
  generateSessionId,
  loadSessions,
  saveSessions,
} from "../infrastructure/sessions.ts";
import { mapPaymentHandlers } from "../infrastructure/ucp_profile.ts";
const SESSION_EXPIRY_HOURS = 24;

// Default links for checkout responses (required per UCP spec)
const DEFAULT_LINKS: Link[] = [
  {
    type: "terms_of_service",
    url: "https://example.com/terms",
  },
  {
    type: "privacy_policy",
    url: "https://example.com/privacy",
  },
];

function jsonError(
  status: number,
  type: string,
  code: string,
  message: string,
  param?: string,
): Response {
  return Response.json(
    { error: { type, code, message, ...(param !== undefined && { param }) } },
    { status },
  );
}

export async function handleCreateCheckoutSession(
  req: Request,
): Promise<Response> {
  // TODO: Needs to be refactored and aligned with the UCP spec

  // Parse UCP headers from the request
  const ucpHeaders = parseUCPHeaders(req);

  // Log agent information if present
  let platformWebhookUrl: string | undefined;
  let platformProfileUrl: string | undefined;

  if (ucpHeaders.agent) {
    console.log(
      `Checkout request from agent: ${
        ucpHeaders.agent.name ?? "unknown"
      } (${ucpHeaders.agent.profile})`,
    );

    // Discover platform's order webhook URL from their profile
    platformProfileUrl = ucpHeaders.agent.profile;
    platformWebhookUrl = await discoverPlatformWebhookUrl(platformProfileUrl);

    if (platformWebhookUrl) {
      console.log(`Platform order webhook URL: ${platformWebhookUrl}`);
    } else {
      console.warn("No order webhook URL found in platform profile");
    }
  }

  // Parse and validate request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(
      400,
      "invalid_request",
      "invalid_json",
      "Request body must be valid JSON",
    );
  }

  const body = rawBody as CreateCheckoutSessionRequest;

  // Basic validation - line_items required
  if (!body.line_items?.length) {
    return jsonError(
      400,
      "invalid_request",
      "missing_line_items",
      "At least one line item is required",
    );
  }

  // Build line items from request data (UCP spec format)
  let lineItems: LineItemResponse[] = [];
  const currency = body.currency ?? "NOK";

  for (let idx = 0; idx < body.line_items.length; idx++) {
    const reqItem = body.line_items[idx];

    if (!reqItem.title || reqItem.price == null) {
      return jsonError(
        400,
        "invalid_request",
        "missing_product_details",
        `Line item at index ${idx} must include 'title' and 'price'`,
        `$.line_items[${idx}]`,
      );
    }

    const itemSubtotal = reqItem.price * reqItem.quantity;
    const item: Item = {
      id: reqItem.sku,
      title: reqItem.title,
      price: reqItem.price,
      image_url: reqItem.image_url,
    };

    lineItems.push({
      id: `li_${idx + 1}`,
      item,
      quantity: reqItem.quantity,
      totals: [
        { type: "subtotal", amount: itemSubtotal },
        { type: "total", amount: itemSubtotal },
      ],
    });
  }

  // Initialize ancillaries (applies required ancillaries automatically)
  const { updatedLineItems, ancillaries } = await initializeAncillaries(
    lineItems,
  );
  lineItems = updatedLineItems;

  // Build fulfillment options
  const lineItemIds = lineItems.map((li) => li.id);
  const fulfillmentMethods = await buildFulfillmentMethods(lineItemIds);
  const availableMethods = await buildAvailableMethods(lineItemIds);

  // Calculate totals (including default fulfillment selection)
  const subtotal = lineItems.reduce((sum, li) => {
    const subtotalEntry = li.totals.find((t) => t.type === "subtotal");
    return sum + (subtotalEntry?.amount ?? 0);
  }, 0);
  const tax = Math.round(subtotal * 0.25); // 25% Norwegian MVA
  const fulfillmentCost = getSelectedFulfillmentCost(fulfillmentMethods);
  const total = subtotal + tax + fulfillmentCost;

  // Build totals array (UCP spec format)
  const totals: TotalEntry[] = [
    { type: "subtotal", amount: subtotal },
    { type: "tax", amount: tax },
  ];
  if (fulfillmentCost > 0) {
    totals.push({ type: "shipping", amount: fulfillmentCost });
  }
  totals.push({ type: "total", amount: total });

  const now = Temporal.Now.instant();
  const expiresAt = now.add(
    Temporal.Duration.from({ hours: SESSION_EXPIRY_HOURS }),
  );

  const paymentHandlers = mapPaymentHandlers();
  // Create the UCP session object (spec-compliant format)
  const session: CheckoutSession = {
    ucp: getUCPResponseMetadata(),
    id: generateSessionId(),
    status: "incomplete",
    currency,
    line_items: lineItems,
    totals,
    links: DEFAULT_LINKS,
    buyer: body.buyer,
    shipping_address: body.shipping_address,
    billing_address: body.billing_address,
    fulfillment: {
      methods: fulfillmentMethods,
      available_methods: availableMethods,
    },
    payment: paymentHandlers ? { handlers: paymentHandlers } : undefined,
    created_at: now.toString(),
    updated_at: now.toString(),
    expires_at: expiresAt.toString(),
    metadata: body.metadata,
    // Store platform webhook URL from UCP-Agent profile for order events
    platform_webhook_url: platformWebhookUrl,
    platform_profile_url: platformProfileUrl,
    ancillaries: Object.keys(ancillaries).length > 0 ? ancillaries : undefined,
  };

  // Save session
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);

  // Pre-fetch Vipps access token in background for CompleteCheckout
  prefetchAccessToken(session.id);

  // Build response headers with UCP structured fields
  const responseHeaders = new Headers({ "Content-Type": "application/json" });

  // Add UCP-Capabilities header
  responseHeaders.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
  );

  // Add UCP-API-Version header
  responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

  // Echo back request context with response timestamp
  if (ucpHeaders.requestContext) {
    responseHeaders.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        correlationId: ucpHeaders.requestContext.correlationId,
        sessionId: session.id,
        timestamp: now,
      }),
    );
  }

  return new Response(
    JSON.stringify(session),
    {
      status: 201,
      headers: responseHeaders,
    },
  );
}

export function handleGetCheckoutSession(
  req: Request,
  sessionId: string,
): Response {
  const ucpHeaders = parseUCPHeaders(req);
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session) {
    return jsonError(
      404,
      "not_found",
      "session_not_found",
      `Checkout session '${sessionId}' not found`,
      "id",
    );
  }

  // Check if session expired
  if (
    session.expires_at &&
    Temporal.Instant.compare(
        Temporal.Instant.from(session.expires_at),
        Temporal.Now.instant(),
      ) < 0 &&
    session.status === "incomplete"
  ) {
    session.status = "canceled";
    session.messages = [{
      type: "error",
      code: "session_expired",
      severity: "recoverable",
      content: "This checkout session has expired.",
    }];
    saveSessions(sessions);
  }

  // Check if payment expired (for complete_in_progress sessions) → terminal state
  if (
    session.status === "complete_in_progress" &&
    session.payment?.expires_at &&
    Temporal.Instant.compare(
        Temporal.Instant.from(session.payment.expires_at),
        Temporal.Now.instant(),
      ) < 0
  ) {
    session.status = "canceled";
    session.payment.state = "expired";
    session.messages = [];
    saveSessions(sessions);
  }

  // Build response headers
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  responseHeaders.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
  );
  responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

  if (ucpHeaders.requestContext) {
    responseHeaders.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        sessionId: session.id,
        timestamp: Temporal.Now.instant(),
      }),
    );
  }

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * Handle PUT /checkout_sessions/:id
 * Updates checkout with selected fulfillment options, recalculates totals
 */
export async function handleUpdateCheckoutSession(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  // Parse request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(
      400,
      "invalid_request",
      "invalid_json",
      "Request body must be valid JSON",
    );
  }

  const body = rawBody as UpdateCheckoutSessionRequest;

  const sessions = loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return jsonError(
      404,
      "not_found",
      "session_not_found",
      `Checkout session '${sessionId}' not found`,
      "id",
    );
  }

  const session = sessions[sessionIndex];

  // Check if session can be updated
  if (session.status === "completed" || session.status === "canceled") {
    return jsonError(
      400,
      "invalid_request",
      "session_not_updatable",
      `Cannot update session with status '${session.status}'`,
    );
  }

  // Update buyer info if provided
  if (body.buyer) {
    session.buyer = { ...session.buyer, ...body.buyer };
  }

  // Update addresses if provided
  if (body.shipping_address) {
    session.shipping_address = body.shipping_address;
  }
  if (body.billing_address) {
    session.billing_address = body.billing_address;
  }

  // Update fulfillment selections
  if (body.fulfillment?.methods && session.fulfillment?.methods) {
    for (const updateMethod of body.fulfillment.methods) {
      const existingMethod = session.fulfillment.methods.find(
        (m) => m.id === updateMethod.id,
      );
      if (!existingMethod) continue;

      // Update destination selection
      if (updateMethod.selected_destination_id !== undefined) {
        existingMethod.selected_destination_id =
          updateMethod.selected_destination_id;
      }

      // Update group option selections
      if (updateMethod.groups && existingMethod.groups) {
        for (const updateGroup of updateMethod.groups) {
          const existingGroup = existingMethod.groups.find(
            (g) => g.id === updateGroup.id,
          );
          if (existingGroup && updateGroup.selected_option_id !== undefined) {
            existingGroup.selected_option_id = updateGroup.selected_option_id;
          }
        }
      }
    }
  }

  // Handle ancillary updates
  if (body.ancillaries !== undefined) {
    const ancillaryResult = await updateAncillaries(
      session,
      body.ancillaries.items,
    );

    // Update line items (adds ancillary line items)
    session.line_items = ancillaryResult.updatedLineItems;

    // Update ancillaries object
    session.ancillaries = Object.keys(ancillaryResult.ancillaries).length > 0
      ? ancillaryResult.ancillaries
      : undefined;

    // Add any ancillary processing errors as warning messages
    if (ancillaryResult.errors.length > 0) {
      const warningMessages: UCPMessage[] = ancillaryResult.errors.map(
        (error) => ({
          type: "warning" as const,
          code: "ancillary_processing_warning",
          content: error,
        }),
      );
      session.messages = [...(session.messages ?? []), ...warningMessages];
      console.warn(
        `Ancillary processing warnings: ${ancillaryResult.errors.join(", ")}`,
      );
    }
  }

  // Recalculate totals with new fulfillment selection
  const subtotal = session.line_items.reduce((sum, li) => {
    const subtotalEntry = li.totals.find((t) => t.type === "subtotal");
    return sum + (subtotalEntry?.amount ?? 0);
  }, 0);
  const tax = Math.round(subtotal * 0.25); // 25% Norwegian MVA
  const fulfillmentCost = session.fulfillment?.methods
    ? getSelectedFulfillmentCost(session.fulfillment.methods)
    : 0;
  const total = subtotal + fulfillmentCost;

  console.log(
    `Recalculated: subtotal=${subtotal}, tax=${tax}, fulfillment=${fulfillmentCost}, total=${total}`,
  );

  // Build totals array (UCP spec format)
  const newTotals: TotalEntry[] = [
    { type: "subtotal", amount: subtotal },
    { type: "tax", amount: tax },
  ];
  if (fulfillmentCost > 0) {
    newTotals.push({ type: "shipping", amount: fulfillmentCost });
  }
  newTotals.push({ type: "total", amount: total });

  session.totals = newTotals;
  session.updated_at = Temporal.Now.instant().toString();

  // Update status to ready_for_complete if fulfillment is selected
  if (fulfillmentCost >= 0 && session.status === "incomplete") {
    session.status = "ready_for_complete";
  }

  saveSessions(sessions);

  // Build response headers
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  responseHeaders.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
  );
  responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

  if (ucpHeaders.requestContext) {
    responseHeaders.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        sessionId: session.id,
        timestamp: Temporal.Now.instant(),
      }),
    );
  }

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * Handle POST /checkout_sessions/:id/cancel
 * Cancels a checkout session and any pending Vipps payment
 */
export function handleCancelCheckout(
  req: Request,
  sessionId: string,
): Response {
  const ucpHeaders = parseUCPHeaders(req);

  if (ucpHeaders.agent) {
    console.log(
      `Cancel checkout from agent: ${ucpHeaders.agent.name ?? "unknown"}`,
    );
  }

  const sessions = loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return jsonError(
      404,
      "not_found",
      "session_not_found",
      `Checkout session '${sessionId}' not found`,
      "id",
    );
  }

  const session = sessions[sessionIndex];

  // Check if session can be canceled
  if (session.status === "completed") {
    return jsonError(
      400,
      "invalid_request",
      "session_already_completed",
      "Cannot cancel a completed checkout session",
    );
  }

  if (session.status === "canceled") {
    // Already canceled, return success
    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    responseHeaders.set(
      UCP_HEADERS.CAPABILITIES,
      serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
    );
    responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

    return new Response(JSON.stringify(session), {
      status: 200,
      headers: responseHeaders,
    });
  }

  // TODO: If there's a pending Vipps payment, cancel it via Vipps API
  // For now, we just update the session status

  session.status = "canceled";
  session.updated_at = Temporal.Now.instant().toString();
  session.messages = [{
    type: "info",
    code: "session_canceled",
    content: "This checkout session has been canceled.",
  }];

  saveSessions(sessions);

  // Build response headers
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  responseHeaders.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
  );
  responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

  if (ucpHeaders.requestContext) {
    responseHeaders.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        sessionId: session.id,
        timestamp: Temporal.Now.instant(),
      }),
    );
  }

  console.log(`Session ${sessionId} canceled`);

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

export async function handleCompleteCheckout(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  if (ucpHeaders.agent) {
    console.log(
      `Complete checkout from agent: ${ucpHeaders.agent.name ?? "unknown"}`,
    );
  }

  // Parse request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(
      400,
      "invalid_request",
      "invalid_json",
      "Request body must be valid JSON",
    );
  }

  const body = rawBody as CompleteCheckoutRequest;

  // Basic validation - payment instruments required
  if (!body.payment?.instruments?.length) {
    return jsonError(
      400,
      "invalid_request",
      "missing_payment",
      "Payment with at least one instrument is required",
    );
  }

  // Get the first wallet instrument
  const instrument = body.payment.instruments[0];

  const validationError = validatePaymentInstrument(instrument);
  if (validationError) {
    return new Response(
      JSON.stringify({
        status: "incomplete",
        messages: [validationError],
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const sessions = loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return jsonError(
      404,
      "not_found",
      "session_not_found",
      `Checkout session '${sessionId}' not found`,
      "id",
    );
  }

  const session = sessions[sessionIndex];

  if (session.status === "completed") {
    return jsonError(
      400,
      "invalid_request",
      "session_already_completed",
      "This checkout session has already been completed",
    );
  }

  if (
    session.status === "canceled" ||
    (session.expires_at &&
      Temporal.Instant.compare(
          Temporal.Instant.from(session.expires_at),
          Temporal.Now.instant(),
        ) < 0)
  ) {
    if (session.status !== "canceled") {
      session.status = "canceled";
      saveSessions(sessions);
    }
    return jsonError(
      400,
      "invalid_request",
      "session_expired",
      "This checkout session has expired",
    );
  }

  const sessionAccess = { loadSessions, saveSessions };
  const result = await createPayment(session, instrument, sessionAccess);

  if (!result.success) {
    return new Response(
      JSON.stringify(result.session),
      {
        status: result.httpStatus ?? 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  responseHeaders.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(getUCPResponseMetadata().capabilities),
  );
  responseHeaders.set(UCP_HEADERS.API_VERSION, getUCPVersion());

  if (ucpHeaders.requestContext) {
    responseHeaders.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        sessionId: result.session.id,
        timestamp: Temporal.Now.instant(),
      }),
    );
  }

  return new Response(JSON.stringify(result.session), {
    status: 200,
    headers: responseHeaders,
  });
}

// ============================================
// Vipps Callback Handler (dispatches to payment service)
// ============================================

/**
 * Handles POST /api/payment/vipps/callback — delegates to Vipps payment handler.
 */
export async function handleVippsCallback(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    console.error("Invalid JSON in callback");
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await handlePaymentCallback(VIPPS_WALLET_HANDLER_ID, payload);
  return new Response(JSON.stringify({ status: result.status }), {
    status: result.httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}
