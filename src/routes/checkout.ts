/**
 * Checkout Route Handlers
 *
 * HTTP handlers for checkout session endpoints.
 * Business logic is delegated to services.
 */

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
import { mapUCPToVippsCheckoutRequest } from "../infrastructure/vipps-checkout-mapper.ts";
import {
  buildTotals,
  calculateSubtotal,
  calculateTax,
  generateSessionId,
  getSessionExpiryTime,
  loadSessions,
  saveSessions,
  SERVICE_CAPABILITIES,
  UCP_CAPABILITIES,
  UCP_VERSION,
} from "../services/checkout-service.ts";
import {
  prefetchAccessToken,
  processPayment,
  processVippsCallback,
  startPaymentPolling,
  validateWalletInstrument,
  type VippsPaymentCallback,
} from "../services/payment-service.ts";
import type {
  CheckoutSession,
  CompleteCheckoutRequest,
  CreateCheckoutSessionRequest,
  CreateVippsCheckoutSessionRequest,
  CreateVippsCheckoutSessionResponse,
  ErrorResponse,
  Item,
  LineItemResponse,
  Link,
  TotalEntry,
  UpdateCheckoutSessionRequest,
  VippsCheckoutError,
} from "../types.ts";
import { getProductBySku } from "./products.ts";

// ============================================
// Configuration
// ============================================

/** Default links for checkout responses (required per UCP spec) */
const DEFAULT_LINKS: Link[] = [
  { type: "terms_of_service", url: "https://example.com/terms" },
  { type: "privacy_policy", url: "https://example.com/privacy" },
];

// Vipps API Configuration
const VIPPS_API_BASE_URL = Deno.env.get("VIPPS_API_BASE_URL") ??
  "https://apitest.vipps.no";
const VIPPS_CHECKOUT_URL = `${VIPPS_API_BASE_URL}/checkout/v3/session`;
const VIPPS_CLIENT_ID = Deno.env.get("VIPPS_CLIENT_ID") ?? "";
const VIPPS_CLIENT_SECRET = Deno.env.get("VIPPS_CLIENT_SECRET") ?? "";
const VIPPS_SUBSCRIPTION_KEY = Deno.env.get("VIPPS_SUBSCRIPTION_KEY") ?? "";
const VIPPS_MSN = Deno.env.get("VIPPS_MERCHANT_SERIAL_NUMBER") ?? "";
const VIPPS_SYSTEM_NAME = Deno.env.get("VIPPS_SYSTEM_NAME") ?? "UCP-POC";
const VIPPS_SYSTEM_VERSION = Deno.env.get("VIPPS_SYSTEM_VERSION") ?? "1.0.0";
const VIPPS_PLUGIN_NAME = Deno.env.get("VIPPS_PLUGIN_NAME") ?? "ucp-checkout";
const VIPPS_PLUGIN_VERSION = Deno.env.get("VIPPS_PLUGIN_VERSION") ?? "1.0.0";
const VIPPS_EMBEDDED_CHECKOUT =
  Deno.env.get("VIPPS_EMBEDDED_CHECKOUT") === "true";

// ============================================
// Response Helpers
// ============================================

function buildResponseHeaders(
  ucpHeaders: ReturnType<typeof parseUCPHeaders>,
  sessionId?: string,
): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });

  headers.set(
    UCP_HEADERS.CAPABILITIES,
    serializeUCPCapabilities(SERVICE_CAPABILITIES),
  );
  headers.set(UCP_HEADERS.API_VERSION, UCP_VERSION);

  if (ucpHeaders.requestContext) {
    headers.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext({
        requestId: ucpHeaders.requestContext.requestId,
        correlationId: ucpHeaders.requestContext.correlationId,
        sessionId,
        timestamp: new Date(),
      }),
    );
  }

  return headers;
}

function errorResponse(
  error: ErrorResponse,
  status: number,
): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================
// Route Handlers
// ============================================

/**
 * POST /checkout_sessions
 * Creates a new checkout session.
 */
export async function handleCreateCheckoutSession(
  req: Request,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  if (ucpHeaders.agent) {
    console.log(
      `📱 Checkout request from agent: ${
        ucpHeaders.agent.name ?? "unknown"
      } (${ucpHeaders.agent.profile})`,
    );
  }

  // Parse request body
  let body: CreateCheckoutSessionRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "invalid_json",
        message: "Request body must be valid JSON",
      },
    }, 400);
  }

  // Validate line items
  if (!body.line_items?.length) {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "missing_line_items",
        message: "At least one line item is required",
      },
    }, 400);
  }

  // Build line items with product details
  const lineItems: LineItemResponse[] = [];
  let currency = body.currency ?? "NOK";

  for (let idx = 0; idx < body.line_items.length; idx++) {
    const reqItem = body.line_items[idx];
    const product = await getProductBySku(reqItem.sku);

    if (!product) {
      return errorResponse({
        error: {
          type: "invalid_request",
          code: "product_not_found",
          message: `Product with SKU '${reqItem.sku}' not found`,
          param: `$.line_items[].sku`,
        },
      }, 400);
    }

    if (product.stock < reqItem.quantity) {
      return errorResponse({
        error: {
          type: "invalid_request",
          code: "insufficient_stock",
          message:
            `Insufficient stock for '${product.name}'. Available: ${product.stock}, Requested: ${reqItem.quantity}`,
          param: `$.line_items[].quantity`,
        },
      }, 400);
    }

    currency = product.currency.toUpperCase();
    const itemSubtotal = product.price * reqItem.quantity;

    const item: Item = {
      id: product.sku,
      title: product.name,
      price: product.price,
      description: product.description,
      image_url: product.image_url,
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

  // Build fulfillment options
  const lineItemIds = lineItems.map((li) => li.id);
  const fulfillmentMethods = await buildFulfillmentMethods(lineItemIds);
  const availableMethods = await buildAvailableMethods(lineItemIds);

  // Calculate totals
  const subtotal = calculateSubtotal(lineItems);
  const tax = calculateTax(subtotal);
  const fulfillmentCost = getSelectedFulfillmentCost(fulfillmentMethods);
  const totals = buildTotals(subtotal, tax, fulfillmentCost);

  const now = new Date();

  // Create the session
  const session: CheckoutSession = {
    ucp: UCP_CAPABILITIES,
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
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: getSessionExpiryTime(),
    metadata: body.metadata,
  };

  // Create Vipps Checkout session if embedded checkout is enabled
  let continueUrl: string | undefined;
  if (VIPPS_EMBEDDED_CHECKOUT) {
    const vippsRequest = mapUCPToVippsCheckoutRequest(session);
    const vippsResult = await createVippsCheckoutSession(vippsRequest);

    if (!vippsResult.success) {
      return errorResponse({
        error: {
          type: "processing_error",
          code: "vipps_checkout_error",
          message: vippsResult.error.message,
        },
      }, vippsResult.status >= 400 && vippsResult.status < 500 ? 400 : 502);
    }

    continueUrl =
      `${vippsResult.data.checkoutFrontendUrl}?token=${vippsResult.data.token}&ec_version=${UCP_VERSION}`;
  }

  // Save session
  const sessions = await loadSessions();
  sessions.push(session);
  await saveSessions(sessions);

  // Pre-fetch Vipps access token for CompleteCheckout
  prefetchAccessToken(session.id);

  const responseHeaders = buildResponseHeaders(ucpHeaders, session.id);
  const response = continueUrl ? { ...session, continue_url: continueUrl } : session;

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: responseHeaders,
  });
}

/**
 * GET /checkout_sessions/:id
 * Retrieves a checkout session.
 */
export async function handleGetCheckoutSession(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);
  const sessions = await loadSessions();
  let session = sessions.find((s) => s.id === sessionId);

  if (!session) {
    return errorResponse({
      error: {
        type: "not_found",
        code: "session_not_found",
        message: `Checkout session '${sessionId}' not found`,
        param: "id",
      },
    }, 404);
  }

  // Check and update expiry status
  if (
    session.expires_at &&
    new Date(session.expires_at) < new Date() &&
    session.status === "incomplete"
  ) {
    session.status = "canceled";
    session.messages = [{
      type: "error",
      code: "session_expired",
      severity: "recoverable",
      content: "This checkout session has expired.",
    }];
    await saveSessions(sessions);
  }

  // Check payment expiry
  if (
    session.status === "complete_in_progress" &&
    session.payment?.expires_at &&
    new Date(session.payment.expires_at) < new Date()
  ) {
    session.status = "incomplete";
    session.payment.state = "expired";
    session.messages = [{
      type: "error",
      code: "payment_expired",
      severity: "requires_buyer_input",
      content: "Payment request expired. Please try again.",
    }];
    await saveSessions(sessions);
  }

  const responseHeaders = buildResponseHeaders(ucpHeaders, session.id);
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * PUT /checkout_sessions/:id
 * Updates a checkout session (fulfillment selection, buyer info, etc.).
 */
export async function handleUpdateCheckoutSession(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  let body: UpdateCheckoutSessionRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "invalid_json",
        message: "Request body must be valid JSON",
      },
    }, 400);
  }

  const sessions = await loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return errorResponse({
      error: {
        type: "not_found",
        code: "session_not_found",
        message: `Checkout session '${sessionId}' not found`,
        param: "id",
      },
    }, 404);
  }

  const session = sessions[sessionIndex];

  // Check if session can be updated
  if (session.status === "completed" || session.status === "canceled") {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "session_not_updatable",
        message: `Cannot update session with status '${session.status}'`,
      },
    }, 400);
  }

  // Update buyer info
  if (body.buyer) {
    session.buyer = { ...session.buyer, ...body.buyer };
  }

  // Update addresses
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

      if (updateMethod.selected_destination_id !== undefined) {
        existingMethod.selected_destination_id =
          updateMethod.selected_destination_id;
      }

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

  // Recalculate totals
  const subtotal = calculateSubtotal(session.line_items);
  const tax = calculateTax(subtotal);
  const fulfillmentCost = session.fulfillment?.methods
    ? getSelectedFulfillmentCost(session.fulfillment.methods)
    : 0;

  console.log(
    `[UpdateCheckout] Recalculated: subtotal=${subtotal}, tax=${tax}, fulfillment=${fulfillmentCost}`,
  );

  session.totals = buildTotals(subtotal, tax, fulfillmentCost);
  session.updated_at = new Date().toISOString();

  // Update status if ready
  if (fulfillmentCost >= 0 && session.status === "incomplete") {
    session.status = "ready_for_complete";
  }

  await saveSessions(sessions);

  const responseHeaders = buildResponseHeaders(ucpHeaders, session.id);
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * POST /checkout_sessions/:id/complete
 * Completes a checkout with payment.
 */
export async function handleCompleteCheckout(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  if (ucpHeaders.agent) {
    console.log(
      `📱 Complete checkout from agent: ${ucpHeaders.agent.name ?? "unknown"}`,
    );
  }

  let body: CompleteCheckoutRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "invalid_json",
        message: "Request body must be valid JSON",
      },
    }, 400);
  }

  // Validate payment instruments
  if (!body.payment?.instruments?.length) {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "missing_payment",
        message: "Payment with at least one instrument is required",
      },
    }, 400);
  }

  const instrument = body.payment.instruments[0];
  const validationError = validateWalletInstrument(instrument);
  if (validationError) {
    return new Response(
      JSON.stringify({ status: "incomplete", messages: [validationError] }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const sessions = await loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return errorResponse({
      error: {
        type: "not_found",
        code: "session_not_found",
        message: `Checkout session '${sessionId}' not found`,
        param: "id",
      },
    }, 404);
  }

  const session = sessions[sessionIndex];

  // Validate session status
  if (session.status === "completed") {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "session_already_completed",
        message: "This checkout session has already been completed",
      },
    }, 400);
  }

  if (
    session.status === "canceled" ||
    (session.expires_at && new Date(session.expires_at) < new Date())
  ) {
    if (session.status !== "canceled") {
      session.status = "canceled";
      await saveSessions(sessions);
    }
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "session_expired",
        message: "This checkout session has expired",
      },
    }, 400);
  }

  // Process payment
  const msisdn = instrument.credential.value;
  const result = await processPayment(session, msisdn);

  // Update session in store
  sessions[sessionIndex] = result.session;
  await saveSessions(sessions);

  // Start background polling if payment is pending
  if (
    result.session.status === "complete_in_progress" &&
    result.session.payment?.vipps_reference
  ) {
    startPaymentPolling(
      result.session.id,
      result.session.payment.vipps_reference,
    ).catch((err) => {
      console.error(
        `[Checkout] Background polling failed for ${result.session.id}:`,
        err,
      );
    });
  }

  const responseHeaders = buildResponseHeaders(ucpHeaders, session.id);
  return new Response(JSON.stringify(result.session), {
    status: result.success ? 200 : (result.httpStatus ?? 400),
    headers: responseHeaders,
  });
}

/**
 * POST /checkout_sessions/:id/cancel
 * Cancels a checkout session.
 */
export async function handleCancelCheckout(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);

  if (ucpHeaders.agent) {
    console.log(
      `📱 Cancel checkout from agent: ${ucpHeaders.agent.name ?? "unknown"}`,
    );
  }

  const sessions = await loadSessions();
  const sessionIndex = sessions.findIndex((s) => s.id === sessionId);

  if (sessionIndex === -1) {
    return errorResponse({
      error: {
        type: "not_found",
        code: "session_not_found",
        message: `Checkout session '${sessionId}' not found`,
        param: "id",
      },
    }, 404);
  }

  const session = sessions[sessionIndex];

  if (session.status === "completed") {
    return errorResponse({
      error: {
        type: "invalid_request",
        code: "session_already_completed",
        message: "Cannot cancel a completed checkout session",
      },
    }, 400);
  }

  if (session.status !== "canceled") {
    session.status = "canceled";
    session.updated_at = new Date().toISOString();
    session.messages = [{
      type: "info",
      code: "session_canceled",
      content: "This checkout session has been canceled.",
    }];
    await saveSessions(sessions);
  }

  console.log(`[CancelCheckout] Session ${sessionId} canceled`);

  const responseHeaders = buildResponseHeaders(ucpHeaders, session.id);
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * POST /api/vipps/callback
 * Handles Vipps ePayment webhook callbacks.
 */
export async function handleVippsCallback(req: Request): Promise<Response> {
  let callback: VippsPaymentCallback;
  try {
    callback = await req.json();
  } catch {
    console.error("[VippsCallback] Invalid JSON in callback");
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await processVippsCallback(callback);
  return new Response(JSON.stringify({ status: result.status }), {
    status: result.httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================
// Vipps Checkout API (Embedded Flow)
// ============================================

type VippsCheckoutResult =
  | { success: true; data: CreateVippsCheckoutSessionResponse }
  | { success: false; error: VippsCheckoutError; status: number };

/**
 * Creates a Vipps Checkout session for embedded checkout.
 */
async function createVippsCheckoutSession(
  vippsCheckoutRequest: CreateVippsCheckoutSessionRequest,
  idempotencyKey?: string,
): Promise<VippsCheckoutResult> {
  if (
    !VIPPS_CLIENT_ID || !VIPPS_CLIENT_SECRET || !VIPPS_SUBSCRIPTION_KEY ||
    !VIPPS_MSN
  ) {
    console.error("Vipps API credentials not configured");
    return {
      success: false,
      status: 500,
      error: {
        type: "configuration_error",
        code: "missing_credentials",
        message:
          "Vipps API credentials are not configured. Set VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, and VIPPS_MERCHANT_SERIAL_NUMBER environment variables.",
      },
    };
  }

  const requestIdempotencyKey = idempotencyKey ?? crypto.randomUUID();

  try {
    const response = await fetch(VIPPS_CHECKOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Vipps-System-Name": VIPPS_SYSTEM_NAME,
        "Vipps-System-Version": VIPPS_SYSTEM_VERSION,
        "Vipps-System-Plugin-Name": VIPPS_PLUGIN_NAME,
        "Vipps-System-Plugin-Version": VIPPS_PLUGIN_VERSION,
        "client_id": VIPPS_CLIENT_ID,
        "client_secret": VIPPS_CLIENT_SECRET,
        "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
        "Merchant-Serial-Number": VIPPS_MSN,
        "Idempotency-Key": requestIdempotencyKey,
      },
      body: JSON.stringify(vippsCheckoutRequest),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(
        () => ({}),
      ) as VippsCheckoutError;
      console.error(`Vipps API error: ${response.status}`, errorBody);

      return {
        success: false,
        status: response.status,
        error: {
          type: errorBody.type ?? "api_error",
          code: errorBody.code ?? `http_${response.status}`,
          message: errorBody.message ??
            `Vipps API returned status ${response.status}`,
          contextId: errorBody.contextId,
          extraDetails: errorBody.extraDetails,
        },
      };
    }

    const data = await response.json() as CreateVippsCheckoutSessionResponse;
    return { success: true, data };
  } catch (error) {
    console.error("Error calling Vipps Checkout API:", error);
    return {
      success: false,
      status: 500,
      error: {
        type: "network_error",
        code: "request_failed",
        message: error instanceof Error
          ? error.message
          : "Failed to connect to Vipps API",
      },
    };
  }
}
