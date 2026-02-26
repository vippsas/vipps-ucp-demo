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
  clearAccessToken,
  createPayment,
  getPaymentStatus,
  prefetchAccessToken,
} from "../infrastructure/vipps_epayment_client.ts";
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
import type {
  CompleteCheckoutRequest,
  WalletPaymentInstrument,
} from "../types/ucp/payment.ts";
import {
  generateSessionId,
  loadSessions,
  saveSessions,
} from "../infrastructure/sessions.ts";
import type { VippsEPaymentAmount } from "../types/vipps/epayment.ts";
import { ucpProfile } from "../data/ucp-profile.ts";

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

// Payment timeout for async PUSH_MESSAGE flow (5 minutes)
const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000;

// Vipps polling configuration (per Vipps guidelines)
// See: https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
const VIPPS_POLL_INITIAL_DELAY_MS = 5000; // Start after 5 seconds
const VIPPS_POLL_INTERVAL_MS = 2000; // Check every 2 seconds
const VIPPS_POLL_MAX_ATTEMPTS = 150; // Max ~5 minutes of polling

const TAX_RATE = 25; // Norwegian VAT 25%

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

  const platformUcpProfile = ucpProfile;

  // Log agent information if present
  let platformWebhookUrl: string | undefined;
  let platformProfileUrl: string | undefined;

  if (ucpHeaders.agent) {
    console.log(
      `📱 Checkout request from agent: ${ucpHeaders.agent.name ?? "unknown"
      } (${ucpHeaders.agent.profile})`,
    );

    // Discover platform's order webhook URL from their profile
    platformProfileUrl = ucpHeaders.agent.profile;
    platformWebhookUrl = await discoverPlatformWebhookUrl(platformProfileUrl);

    if (platformWebhookUrl) {
      console.log(`📬 Platform order webhook URL: ${platformWebhookUrl}`);
    } else {
      console.log(`⚠️ No order webhook URL found in platform profile`);
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

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  // Map payment handlers to UCP spec format: { handler_name: [versions] }
  const mapPaymentHandlers = (
    handlers: Record<string, Array<{ version: string }>> | undefined,
  ): Record<string, string[]> | undefined => {
    if (!handlers) return undefined;
    const mapped: Record<string, string[]> = {};
    for (const [name, versions] of Object.entries(handlers)) {
      mapped[name] = versions.map((v) => v.version);
    }
    return mapped;
  };

  const paymentHandlers = mapPaymentHandlers(
    platformUcpProfile?.ucp.payment_handlers,
  );

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
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    metadata: body.metadata,
    // Store platform webhook URL from UCP-Agent profile for order events
    platform_webhook_url: platformWebhookUrl,
    platform_profile_url: platformProfileUrl,
    ancillaries: Object.keys(ancillaries).length > 0 ? ancillaries : undefined,
  };

  // Save session
  const sessions = await loadSessions();
  sessions.push(session);
  await saveSessions(sessions);

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
        timestamp: new Date(),
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

export async function handleGetCheckoutSession(
  req: Request,
  sessionId: string,
): Promise<Response> {
  const ucpHeaders = parseUCPHeaders(req);
  const sessions = await loadSessions();
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

  // Check if payment expired (for complete_in_progress sessions)
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
        timestamp: new Date(),
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

  const sessions = await loadSessions();
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
      console.log(
        `[UpdateCheckout] Ancillary processing warnings: ${ancillaryResult.errors.join(", ")
        }`,
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
  const total = subtotal + tax + fulfillmentCost;

  console.log(
    `[UpdateCheckout] Recalculated: subtotal=${subtotal}, tax=${tax}, fulfillment=${fulfillmentCost}, total=${total}`,
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
  session.updated_at = new Date().toISOString();

  // Update status to ready_for_complete if fulfillment is selected
  if (fulfillmentCost >= 0 && session.status === "incomplete") {
    session.status = "ready_for_complete";
  }

  await saveSessions(sessions);

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
        timestamp: new Date(),
      }),
    );
  }

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * Handler ID declared in /.well-known/ucp profile.
 * Matches the payment handler: com.vippsmobilepay.pay.payment_handler
 * See: https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler
 */
const VIPPS_WALLET_HANDLER_ID = "vippsmobilepay_wallet_handler";

/**
 * Validates the wallet payment instrument from the request.
 */
function validateWalletInstrument(
  instrument: WalletPaymentInstrument,
): UCPMessage | null {
  // Validate handler_id matches our declared handler
  if (!instrument.handler_id) {
    return {
      type: "error",
      code: "missing_handler_id",
      severity: "recoverable",
      content: "Payment instrument must specify a handler_id.",
      path: "$.payment.instruments[0].handler_id",
    };
  }

  if (instrument.handler_id !== VIPPS_WALLET_HANDLER_ID) {
    return {
      type: "error",
      code: "unknown_handler",
      severity: "recoverable",
      content:
        `Unknown payment handler '${instrument.handler_id}'. This merchant supports: ${VIPPS_WALLET_HANDLER_ID}`,
      path: "$.payment.instruments[0].handler_id",
    };
  }

  // For now, this example only supports the wallet payment option. For card examples, please reach out to us.
  if (instrument.type !== "WALLET") {
    return {
      type: "error",
      code: "invalid_instrument_type",
      severity: "recoverable",
      content:
        `Invalid instrument type '${instrument.type}'. Expected 'WALLET'.`,
      path: "$.payment.instruments[0].type",
    };
  }

  // Validate credential exists
  if (!instrument.credential) {
    return {
      type: "error",
      code: "missing_credential",
      severity: "recoverable",
      content: "Payment credential is required.",
      path: "$.payment.instruments[0].credential",
    };
  }

  // Validate credential type
  const credentialType = instrument.credential.type;
  if (credentialType !== "MSISDN" && credentialType !== "TOKEN") {
    return {
      type: "error",
      code: "invalid_credential_type",
      severity: "recoverable",
      content:
        `Invalid credential type '${credentialType}'. Expected 'MSISDN' or 'TOKEN'.`,
      path: "$.payment.instruments[0].credential.type",
    };
  }

  // Validate based on credential type
  if (credentialType === "MSISDN") {
    // Validate MSISDN value
    const msisdn = instrument.credential.value;
    if (!msisdn) {
      return {
        type: "error",
        code: "missing_msisdn",
        severity: "recoverable",
        content: "Phone number (MSISDN) is required.",
        path: "$.payment.instruments[0].credential.value",
      };
    }

    // Validate MSISDN format (digits only, 7-15 chars, starts with non-zero)
    const msisdnPattern = /^[1-9]\d{6,14}$/;
    if (!msisdnPattern.test(msisdn)) {
      return {
        type: "error",
        code: "invalid_msisdn_format",
        severity: "recoverable",
        content:
          "Invalid phone number format. Expected MSISDN format: digits only with country code (e.g., 4712345678).",
        path: "$.payment.instruments[0].credential.value",
      };
    }
  } else if (credentialType === "TOKEN") {
    // Validate token value
    const token = instrument.credential.value;
    if (!token || typeof token !== "string" || token.trim() === "") {
      return {
        type: "error",
        code: "missing_token",
        severity: "recoverable",
        content: "Token value is required.",
        path: "$.payment.instruments[0].credential.value",
      };
    }
  }

  return null; // Valid
}

/**
 * Handle POST /checkout_sessions/:id/cancel
 * Cancels a checkout session and any pending Vipps payment
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
  session.updated_at = new Date().toISOString();
  session.messages = [{
    type: "info",
    code: "session_canceled",
    content: "This checkout session has been canceled.",
  }];

  await saveSessions(sessions);

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
        timestamp: new Date(),
      }),
    );
  }

  console.log(`[CancelCheckout] Session ${sessionId} canceled`);

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
      `📱 Complete checkout from agent: ${ucpHeaders.agent.name ?? "unknown"}`,
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

  const validationError = validateWalletInstrument(instrument);
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

  const sessions = await loadSessions();
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

  // Check session status
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
    (session.expires_at && new Date(session.expires_at) < new Date())
  ) {
    if (session.status !== "canceled") {
      session.status = "canceled";
      await saveSessions(sessions);
    }

    return jsonError(
      400,
      "invalid_request",
      "session_expired",
      "This checkout session has expired",
    );
  }

  const customer = instrument.credential.type === "MSISDN"
    ? { phoneNumber: instrument.credential.value }
    : { customerToken: instrument.credential.value };

  // Determine currency (normalize to uppercase for Vipps API)
  const currency = session.currency
    .toUpperCase() as VippsEPaymentAmount["currency"];

  // Call Vipps ePayment API to create the payment with receipt/order lines
  // See: https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment
  const totalEntry = session.totals.find((t) => t.type === "total");
  const paymentResult = await createPayment(
    session.id,
    customer,
    totalEntry?.amount ?? 0,
    currency,
    `Order ${session.id}`,
    session.line_items, // Include order lines in receipt
    session.totals, // Include totals for bottom line
    TAX_RATE, // Tax percentage for calculations
  );

  if (!paymentResult.success) {
    // Check if any errors require buyer input (escalation)
    const requiresEscalation = paymentResult.messages.some(
      (msg) =>
        msg.type === "error" &&
        (msg.severity === "requires_buyer_input" ||
          msg.severity === "requires_buyer_review"),
    );

    return new Response(
      JSON.stringify({
        ...session,
        status: requiresEscalation ? "requires_escalation" : "incomplete",
        messages: paymentResult.messages,
      }),
      {
        status: paymentResult.httpStatus >= 500 ? 502 : 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Payment created successfully with Vipps
  // For PUSH_MESSAGE flow, payment state will be CREATED initially
  // The actual authorization happens asynchronously when user approves in Vipps app
  const now = new Date();
  const paymentExpiresAt = new Date(now.getTime() + PAYMENT_TIMEOUT_MS);

  if (paymentResult.data.state === "AUTHORIZED") {
    session.status = "completed";
    session.order = {
      id: `order-${session.id}`,
      reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
      created_at: now.toISOString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_approved",
      content: "Payment approved. Your order has been placed.",
    }];
  } else {
    // Normal case: PUSH_MESSAGE flow - payment is CREATED, awaiting user approval
    // Return complete_in_progress immediately - don't block waiting for user
    session.status = "complete_in_progress";
    session.payment = {
      ...session.payment,
      state: "pending_approval",
      vipps_reference: paymentResult.data.reference,
      expires_at: paymentExpiresAt.toISOString(),
    };
    session.messages = [{
      type: "info",
      code: "payment_pending_user_approval",
      content:
        "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment to complete your order.",
    }];
  }

  session.updated_at = now.toISOString();

  // Store Vipps reference in metadata for debugging/tracking
  session.metadata = {
    ...session.metadata,
    vipps_reference: paymentResult.data.reference,
    vipps_state: paymentResult.data.state,
    vipps_psp_reference: paymentResult.data.pspReference ?? "",
  };

  await saveSessions(sessions);

  // Start background polling as backup to callbacks (fire-and-forget)
  // See: https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
  if (
    session.status === "complete_in_progress" &&
    session.payment?.vipps_reference
  ) {
    startPaymentPolling(session.id, session.payment.vipps_reference).catch(
      (err) => {
        console.error(
          `[Checkout] Background polling failed for ${session.id}:`,
          err,
        );
      },
    );
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
        timestamp: new Date(),
      }),
    );
  }

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: responseHeaders,
  });
}

// ============================================
// Vipps Callback Handler
// ============================================

/**
 * Vipps ePayment callback payload
 * See: https://developer.vippsmobilepay.com/api/epayment/#tag/Webhooks
 */
interface VippsPaymentCallback {
  reference: string;
  pspReference?: string;
  name?: string;
  amount?: { currency: string; value: number };
  state?: string;
  paymentMethod?: { type: string };
  timestamp?: string;
}

/**
 * Handles Vipps ePayment callbacks for payment status updates.
 *
 * Called by Vipps when:
 * - User approves payment (state: AUTHORIZED)
 * - User rejects payment (state: ABORTED)
 * - Payment expires (state: EXPIRED)
 * - Payment is cancelled (state: TERMINATED)
 *
 * See: https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler#vipps-callback-handling
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

  console.log(
    `[VippsCallback] Received callback for ${callback.reference}: ${callback.state}`,
  );

  // Find the checkout session by Vipps reference
  const sessions = await loadSessions();
  const session = sessions.find(
    (s) =>
      s.metadata?.vipps_reference === callback.reference ||
      s.id === callback.reference,
  );

  if (!session) {
    console.warn(
      `[VippsCallback] Session not found for reference: ${callback.reference}`,
    );
    // Return 200 to acknowledge receipt (Vipps expects this)
    return new Response(JSON.stringify({ status: "session_not_found" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only process if session is still in complete_in_progress state
  if (session.status !== "complete_in_progress") {
    console.log(
      `[VippsCallback] Session ${session.id} not in complete_in_progress, skipping`,
    );
    return new Response(JSON.stringify({ status: "already_processed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();

  switch (callback.state) {
    case "AUTHORIZED": {
      console.log(`[VippsCallback] Payment AUTHORIZED for ${session.id}`);
      session.status = "completed";
      session.payment = {
        ...session.payment,
        state: "approved",
        vipps_reference: callback.reference,
        psp_reference: callback.pspReference,
      };
      session.order = {
        id: `order-${session.id}`,
        reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
        created_at: now.toISOString(),
      };
      session.messages = [{
        type: "info",
        code: "payment_approved",
        content: "Payment approved. Your order has been placed.",
      }];
      break;
    }

    case "ABORTED": {
      // User rejected the payment
      console.log(`[VippsCallback] Payment ABORTED for ${session.id}`);
      session.status = "incomplete";
      session.payment = {
        ...session.payment,
        state: "rejected",
      };
      session.messages = [{
        type: "error",
        code: "payment_rejected",
        severity: "requires_buyer_input",
        content:
          "Payment was declined. Please try again or choose a different payment method.",
      }];
      break;
    }

    case "EXPIRED": {
      // Payment request expired
      console.log(`[VippsCallback] Payment EXPIRED for ${session.id}`);
      session.status = "incomplete";
      session.payment = {
        ...session.payment,
        state: "expired",
      };
      session.messages = [{
        type: "error",
        code: "payment_expired",
        severity: "requires_buyer_input",
        content: "Payment request expired. Please try again.",
      }];
      break;
    }

    case "TERMINATED": {
      // Payment was cancelled
      console.log(`[VippsCallback] Payment TERMINATED for ${session.id}`);
      session.status = "incomplete";
      session.payment = {
        ...session.payment,
        state: "cancelled",
      };
      session.messages = [{
        type: "error",
        code: "payment_cancelled",
        severity: "requires_buyer_input",
        content: "Payment was cancelled. Please try again.",
      }];
      break;
    }

    default:
      console.log(
        `[VippsCallback] Unhandled state ${callback.state} for ${session.id}`,
      );
  }

  session.updated_at = now.toISOString();
  await saveSessions(sessions);

  // Clear cached access token
  clearAccessToken(session.id);

  // Return 200 to acknowledge receipt
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================
// Background Payment Polling (Backup to Callbacks)
// ============================================

/**
 * Polls Vipps for payment status as backup to callbacks.
 *
 * Vipps does not guarantee callback delivery, so we must poll as backup.
 * See: https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 *
 * This runs in the background (fire-and-forget) after payment creation.
 * The callback handler and this poller are idempotent - whichever gets
 * the status update first will process it.
 */
async function startPaymentPolling(
  sessionId: string,
  vippsReference: string,
): Promise<void> {
  console.log(`[VippsPolling] Starting background polling for ${sessionId}`);

  // Wait initial delay per Vipps guidelines
  await new Promise((resolve) =>
    setTimeout(resolve, VIPPS_POLL_INITIAL_DELAY_MS)
  );

  for (let attempt = 0; attempt < VIPPS_POLL_MAX_ATTEMPTS; attempt++) {
    // Check if session is still in progress
    const sessions = await loadSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      console.log(`[VippsPolling] Session ${sessionId} not found, stopping`);
      return;
    }

    // If already processed (by callback), stop polling
    if (session.status !== "complete_in_progress") {
      console.log(
        `[VippsPolling] Session ${sessionId} already processed (${session.status}), stopping`,
      );
      return;
    }

    // Poll Vipps for payment status
    const result = await getPaymentStatus(sessionId, vippsReference);

    if (!result.success) {
      console.warn(
        `[VippsPolling] Failed to get status for ${sessionId}: ${result.error}`,
      );
      // Continue polling despite error
      await new Promise((resolve) =>
        setTimeout(resolve, VIPPS_POLL_INTERVAL_MS)
      );
      continue;
    }

    const { state, pspReference } = result.data;
    console.log(`[VippsPolling] Payment ${vippsReference} state: ${state}`);

    // Process terminal states
    if (state === "AUTHORIZED") {
      console.log(`[VippsPolling] Payment AUTHORIZED for ${sessionId}`);
      await processPaymentAuthorized(sessionId, vippsReference, pspReference);
      return;
    }

    if (state === "ABORTED") {
      console.log(`[VippsPolling] Payment ABORTED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "rejected",
        "payment_rejected",
        "Payment was declined. Please try again or choose a different payment method.",
      );
      return;
    }

    if (state === "EXPIRED") {
      console.log(`[VippsPolling] Payment EXPIRED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "expired",
        "payment_expired",
        "Payment request expired. Please try again.",
      );
      return;
    }

    if (state === "TERMINATED") {
      console.log(`[VippsPolling] Payment TERMINATED for ${sessionId}`);
      await processPaymentFailed(
        sessionId,
        "cancelled",
        "payment_cancelled",
        "Payment was cancelled. Please try again.",
      );
      return;
    }

    // Still CREATED - wait and poll again
    await new Promise((resolve) => setTimeout(resolve, VIPPS_POLL_INTERVAL_MS));
  }

  // Max attempts reached - mark as timed out
  console.log(`[VippsPolling] Max attempts reached for ${sessionId}`);
  await processPaymentFailed(
    sessionId,
    "expired",
    "payment_expired",
    "Payment request timed out. Please try again.",
  );
}

/**
 * Process a successful payment authorization.
 */
async function processPaymentAuthorized(
  sessionId: string,
  vippsReference: string,
  pspReference?: string,
): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session || session.status !== "complete_in_progress") {
    return; // Already processed
  }

  const now = new Date();

  session.status = "completed";
  session.payment = {
    ...session.payment,
    state: "approved",
    vipps_reference: vippsReference,
    psp_reference: pspReference,
  };
  session.order = {
    id: `order-${session.id}`,
    reference: `ORD-${now.getFullYear()}-${session.id.slice(-6)}`,
    created_at: now.toISOString(),
  };
  session.messages = [{
    type: "info",
    code: "payment_approved",
    content: "Payment approved. Your order has been placed.",
  }];
  session.updated_at = now.toISOString();

  await saveSessions(sessions);
  clearAccessToken(sessionId);
}

/**
 * Process a failed payment (rejected, expired, cancelled).
 */
async function processPaymentFailed(
  sessionId: string,
  paymentState: "rejected" | "expired" | "cancelled",
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session || session.status !== "complete_in_progress") {
    return; // Already processed
  }

  session.status = "incomplete";
  session.payment = {
    ...session.payment,
    state: paymentState,
  };
  session.messages = [{
    type: "error",
    code: errorCode,
    severity: "requires_buyer_input",
    content: errorMessage,
  }];
  session.updated_at = new Date().toISOString();

  await saveSessions(sessions);
  clearAccessToken(sessionId);
}
