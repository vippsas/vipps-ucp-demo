/**
 * Vipps ePayment API Client
 *
 * Implements the Vipps MobilePay ePayment API for creating wallet payments.
 * See: https://developer.vippsmobilepay.com/api/epayment/
 *
 * Payment Handler: com.vippsmobilepay.pay.payment_handler
 * Handler Spec: https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler
 *
 * This client:
 * - Handles Access Token API authentication
 * - Creates payments via the ePayment API
 * - Maps Vipps errors to UCP error format (see Error Handling section in spec)
 */

import type {
  LineItemResponse,
  TotalEntry,
  UCPMessage,
  UCPMessageSeverity,
} from "../types/ucp/checkout.ts";
import type {
  VippsAccessTokenError,
  VippsAccessTokenResponse,
} from "../types/vipps/auth.ts";
import type {
  VippsCreatePaymentRequest,
  VippsCreatePaymentResponse,
  VippsEPaymentAmount,
  VippsEPaymentError,
  VippsEPaymentMSISDNCustomer,
  VippsEPaymentOrderLine,
  VippsEPaymentReceipt,
  VippsEPaymentTokenCustomer,
} from "../types/vipps/epayment.ts";

import { getConfig } from "./config.ts";
import { Logger } from "@deno-library/logger";

const logger = new Logger();

// ============================================
// Configuration
// ============================================

const vipps = () => getConfig();
const VIPPS_ACCESS_TOKEN_URL = () => `${vipps().apiBaseUrl}/accesstoken/get`;
const VIPPS_EPAYMENT_URL = () => `${vipps().apiBaseUrl}/epayment/v1/payments`;
const VIPPS_SYSTEM_NAME = "UCP-POC";
const VIPPS_SYSTEM_VERSION = "1.0.0";
const VIPPS_PLUGIN_NAME = "ucp-checkout";
const VIPPS_PLUGIN_VERSION = "0.0.1";

// ============================================
// Access Token Management
// ============================================

interface CachedToken {
  token: string;
  expiresAt: number; // Unix timestamp in ms
}

// Token cache per checkout session
const tokenCache = new Map<string, CachedToken>();

// Buffer time before token expiry (5 minutes)
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Fetches a new access token from Vipps Access Token API.
 * See: https://developer.vippsmobilepay.com/api/access-token/
 */
async function fetchAccessToken(): Promise<
  { success: true; token: string; expiresIn: number } | {
    success: false;
    error: VippsAccessTokenError;
  }
> {
  const cfg = vipps();

  try {
    const response = await fetch(VIPPS_ACCESS_TOKEN_URL(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "client_id": cfg.clientId,
        "client_secret": cfg.clientSecret,
        "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
        "Merchant-Serial-Number": cfg.msn,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      logger.error(`Token fetch failed: ${response.status}`, errorBody);
      return {
        success: false,
        error: {
          error: errorBody.error ?? `http_${response.status}`,
          error_description: errorBody.error_description ??
            `Access token request failed with status ${response.status}`,
        },
      };
    }

    const data = (await response.json()) as VippsAccessTokenResponse;
    logger.info(`Token fetched successfully, expires in ${data.expires_in}s`);

    return {
      success: true,
      token: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    logger.error("Network error fetching token:", error);
    return {
      success: false,
      error: {
        error: "network_error",
        error_description: error instanceof Error
          ? error.message
          : "Failed to connect to Vipps Access Token API",
      },
    };
  }
}

/**
 * Gets an access token for a checkout session.
 * Caches tokens per session and refreshes when expired.
 */
export async function getAccessToken(
  checkoutId: string,
): Promise<
  { success: true; token: string } | { success: false; error: string }
> {
  const cached = tokenCache.get(checkoutId);
  const now = Temporal.Now.instant().epochMilliseconds;

  // Return cached token if still valid (with buffer)
  if (cached && cached.expiresAt - TOKEN_EXPIRY_BUFFER_MS > now) {
    logger.info(`Using cached token for checkout ${checkoutId}`);
    return { success: true, token: cached.token };
  }

  // Fetch new token
  const result = await fetchAccessToken();
  if (!result.success) {
    return {
      success: false,
      error: result.error.error_description ?? result.error.error,
    };
  }

  // Cache the token
  const expiresAt = now + result.expiresIn * 1000;
  tokenCache.set(checkoutId, { token: result.token, expiresAt });

  return { success: true, token: result.token };
}

/**
 * Pre-fetches an access token for a checkout session.
 * Called during CreateCheckout to have token ready for CompleteCheckout.
 */
export function prefetchAccessToken(checkoutId: string): void {
  // Fire and forget - don't await
  getAccessToken(checkoutId).then((result) => {
    if (!result.success) {
      logger.warn(`Prefetch failed for ${checkoutId}: ${result.error}`);
    }
  });
}

/**
 * Clears cached token for a checkout session.
 * Called when checkout is completed or cancelled.
 */
export function clearAccessToken(checkoutId: string): void {
  tokenCache.delete(checkoutId);
}

// ============================================
// ePayment API
// ============================================

export type CreatePaymentResult =
  | { success: true; data: VippsCreatePaymentResponse }
  | { success: false; messages: UCPMessage[]; httpStatus: number };

/** Options for creating a payment with receipt/order lines */
export interface CreatePaymentOptions {
  /** Checkout session ID (used as payment reference) */
  checkoutId: string;
  /** Customer phone number in MSISDN format */
  msisdn: string;
  /** Total payment amount in minor units */
  amount: number;
  /** Currency (NOK, DKK, EUR) */
  currency: VippsEPaymentAmount["currency"];
  /** Payment description shown to user */
  paymentDescription?: string;
  /** Line items for receipt (optional but recommended) - UCP spec format */
  lineItems?: LineItemResponse[];
  /** Totals including tax and shipping (optional but recommended) - UCP spec format */
  totals?: TotalEntry[];
  /** Tax percentage for calculating line item taxes (default: 25) */
  taxPercentage?: number;
}

/**
 * Creates a payment via Vipps ePayment API.
 * See: https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment
 */
export async function createPayment(
  checkoutId: string,
  customer: VippsEPaymentTokenCustomer | VippsEPaymentMSISDNCustomer,
  amount: number,
  currency: VippsEPaymentAmount["currency"],
  paymentDescription?: string,
  lineItems?: LineItemResponse[],
  totals?: TotalEntry[],
  taxPercentage?: number,
): Promise<CreatePaymentResult> {
  // Get access token
  const tokenResult = await getAccessToken(checkoutId);
  if (!tokenResult.success) {
    logger.error(`Auth failed for ${checkoutId}: ${tokenResult.error}`);
    return {
      success: false,
      httpStatus: 500,
      messages: [
        {
          type: "error",
          code: "payment_service_error",
          severity: "recoverable",
          content:
            "Payment service is temporarily unavailable. Please try again.",
        },
      ],
    };
  }

  const cfg = vipps();

  // Build receipt with order lines if line items provided
  let receipt: VippsEPaymentReceipt | undefined;
  if (lineItems && lineItems.length > 0) {
    receipt = mapLineItemsToReceipt(lineItems, currency, totals, taxPercentage);
  }

  // Build request
  const request: VippsCreatePaymentRequest = {
    amount: { currency, value: amount },
    customer,
    paymentMethod: { type: "WALLET" },
    reference: checkoutId,
    userFlow: "PUSH_MESSAGE",
    paymentDescription: paymentDescription ?? `Order ${checkoutId}`,
    receipt,
  };

  try {
    logger.info(`Creating payment for ${checkoutId}`);

    const response = await fetch(VIPPS_EPAYMENT_URL(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenResult.token}`,
        "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
        "Merchant-Serial-Number": cfg.msn,
        "Idempotency-Key": checkoutId,
        "Vipps-System-Name": VIPPS_SYSTEM_NAME,
        "Vipps-System-Version": VIPPS_SYSTEM_VERSION,
        "Vipps-System-Plugin-Name": VIPPS_PLUGIN_NAME,
        "Vipps-System-Plugin-Version": VIPPS_PLUGIN_VERSION,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody =
        (await response.json().catch(() => ({}))) as VippsEPaymentError;
      logger.error(`API error: ${response.status}`, errorBody);
      return {
        success: false,
        httpStatus: response.status,
        messages: mapVippsErrorToUCP(response.status, errorBody),
      };
    }

    const data = (await response.json()) as VippsCreatePaymentResponse;
    logger.info(`Payment created: ${data.reference}, state: ${data.state}`);

    return { success: true, data };
  } catch (error) {
    logger.error("Network error:", error);
    return {
      success: false,
      httpStatus: 502,
      messages: [
        {
          type: "error",
          code: "payment_service_unavailable",
          severity: "recoverable",
          content:
            "Payment service is temporarily unavailable. Please try again.",
        },
      ],
    };
  }
}

// ============================================
// Get Payment Status (for polling)
// ============================================

export type VippsPaymentState =
  | "CREATED"
  | "AUTHORIZED"
  | "ABORTED"
  | "EXPIRED"
  | "TERMINATED";

export interface VippsPaymentStatus {
  reference: string;
  state: VippsPaymentState;
  pspReference?: string;
}

export type GetPaymentResult =
  | { success: true; data: VippsPaymentStatus }
  | { success: false; error: string };

/**
 * Gets the current status of a Vipps payment.
 * Used for polling as backup to callbacks.
 *
 * See: https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 * Endpoint: GET /epayment/v1/payments/{reference}
 */
export async function getPaymentStatus(
  checkoutId: string,
  reference: string,
): Promise<GetPaymentResult> {
  const tokenResult = await getAccessToken(checkoutId);
  if (!tokenResult.success) {
    return { success: false, error: tokenResult.error };
  }

  try {
    const cfg = vipps();
    const response = await fetch(`${VIPPS_EPAYMENT_URL()}/${reference}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tokenResult.token}`,
        "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
        "Merchant-Serial-Number": cfg.msn,
        "Vipps-System-Name": VIPPS_SYSTEM_NAME,
        "Vipps-System-Version": VIPPS_SYSTEM_VERSION,
        "Vipps-System-Plugin-Name": VIPPS_PLUGIN_NAME,
        "Vipps-System-Plugin-Version": VIPPS_PLUGIN_VERSION,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      logger.error(`Get payment failed: ${response.status}`, errorBody);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        reference: data.reference,
        state: data.state,
        pspReference: data.pspReference,
      },
    };
  } catch (error) {
    logger.error("Get payment network error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// ============================================
// Receipt / Order Lines Mapping
// ============================================

/** Default tax percentage (Norwegian VAT) */
const DEFAULT_TAX_PERCENTAGE = 25;

/**
 * Maps UCP LineItemResponse[] to Vipps ePayment Receipt format.
 * See: https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment
 *
 * @param lineItems - UCP line items from checkout session (spec format)
 * @param currency - Currency for the receipt
 * @param totals - Optional totals array (UCP spec format)
 * @param taxPercentage - Tax percentage to use (default: 25 for Norwegian VAT)
 */
function mapLineItemsToReceipt(
  lineItems: LineItemResponse[],
  currency: VippsEPaymentAmount["currency"],
  totals?: TotalEntry[],
  taxPercentage: number = DEFAULT_TAX_PERCENTAGE,
): VippsEPaymentReceipt {
  // Map line items to Vipps order lines
  const orderLines: VippsEPaymentOrderLine[] = lineItems.map((item) =>
    mapLineItemToOrderLine(item, taxPercentage)
  );

  // Add shipping as a separate order line if present
  const shippingEntry = totals?.find((t) => t.type === "shipping");
  if (shippingEntry && shippingEntry.amount > 0) {
    orderLines.push(
      createShippingOrderLine(shippingEntry.amount, taxPercentage),
    );
  }

  // Extract totals from the array
  const totalEntry = totals?.find((t) => t.type === "total");
  const taxEntry = totals?.find((t) => t.type === "tax");

  // Calculate totals for bottom line
  const totalAmount = totalEntry?.amount ?? lineItems.reduce((sum, li) => {
    const liTotal = li.totals.find((t) => t.type === "total");
    return sum + (liTotal?.amount ?? 0);
  }, 0);
  const totalTax = taxEntry?.amount ??
    calculateTaxFromTotal(totalAmount, taxPercentage);
  const shippingAmount = shippingEntry?.amount ?? 0;

  return {
    orderLines,
    bottomLine: {
      currency,
      totalAmount,
      totalTax,
      shippingAmount: shippingAmount > 0 ? shippingAmount : undefined,
    },
  };
}

/**
 * Maps a single UCP LineItemResponse to a Vipps ePayment OrderLine.
 */
function mapLineItemToOrderLine(
  lineItem: LineItemResponse,
  taxPercentage: number,
): VippsEPaymentOrderLine {
  // Get total from the line item's totals array
  const totalEntry = lineItem.totals.find((t) => t.type === "total");
  const totalAmount = totalEntry?.amount ?? 0;

  // Calculate tax amounts (assuming price includes tax)
  const taxAmount = calculateTaxFromTotal(totalAmount, taxPercentage);
  const amountExcludingTax = totalAmount - taxAmount;

  return {
    name: lineItem.item.title,
    id: lineItem.item.id,
    totalAmount: totalAmount,
    totalAmountExcludingTax: amountExcludingTax,
    totalTaxAmount: taxAmount,
    taxPercentage,
    unitInfo: {
      unitPrice: lineItem.item.price,
      quantity: lineItem.quantity.toString(),
      quantityUnit: "PCS",
    },
  };
}

/**
 * Creates a shipping order line.
 */
function createShippingOrderLine(
  shippingAmount: number,
  taxPercentage: number,
): VippsEPaymentOrderLine {
  const taxAmount = calculateTaxFromTotal(shippingAmount, taxPercentage);
  const amountExcludingTax = shippingAmount - taxAmount;

  return {
    name: "Shipping",
    id: "SHIPPING",
    totalAmount: shippingAmount,
    totalAmountExcludingTax: amountExcludingTax,
    totalTaxAmount: taxAmount,
    taxPercentage,
    isShipping: true,
  };
}

/**
 * Calculates tax amount from a total that includes tax.
 * Formula: tax = total * (taxRate / (100 + taxRate))
 */
function calculateTaxFromTotal(
  totalIncludingTax: number,
  taxPercentage: number,
): number {
  return Math.round(
    totalIncludingTax * (taxPercentage / (100 + taxPercentage)),
  );
}

// ============================================
// Error Mapping
// ============================================

/**
 * Maps Vipps ePayment API errors to UCP message format.
 *
 * Error mapping follows the handler specification:
 * https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler#error-handling
 *
 * IMPORTANT: Error messages are intentionally opaque to avoid leaking
 * internal payment provider details to the platform.
 */
function mapVippsErrorToUCP(
  httpStatus: number,
  error: VippsEPaymentError,
): UCPMessage[] {
  logger.error("Error details:", JSON.stringify(error));

  // Determine severity and return opaque error message
  const { code, severity, content } = interpretVippsError(httpStatus, error);

  return [
    {
      type: "error",
      code,
      severity,
      content,
      path: "$.payment.instruments[0]",
    },
  ];
}

/**
 * Interprets Vipps error and determines UCP severity.
 *
 * Returns opaque, user-friendly error messages that don't leak
 * internal payment provider details.
 */
function interpretVippsError(
  httpStatus: number,
  error: VippsEPaymentError,
): { code: string; severity: UCPMessageSeverity; content: string } {
  // Use error details only for internal classification, not in response messages
  const errorDetail = (error.detail ?? error.title ?? "").toLowerCase();

  // 400 Bad Request - usually validation errors (recoverable by platform)
  if (httpStatus === 400) {
    // Invalid phone number - check error hints without exposing them
    if (
      errorDetail.includes("phone") ||
      errorDetail.includes("msisdn") ||
      errorDetail.includes("customer")
    ) {
      return {
        code: "invalid_phone_number",
        severity: "recoverable",
        content:
          "The provided phone number is invalid. Please verify the format.",
      };
    }
    // Generic validation error
    return {
      code: "invalid_payment_data",
      severity: "recoverable",
      content:
        "The payment request contains invalid data. Please verify and try again.",
    };
  }

  // 401/403 - Authentication/Authorization errors (internal issue, opaque to platform)
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: "payment_service_error",
      severity: "recoverable",
      content: "Payment service encountered an error. Please try again.",
    };
  }

  // 404 - Customer not found (requires buyer to have the wallet app)
  if (httpStatus === 404) {
    return {
      code: "wallet_not_found",
      severity: "requires_buyer_input",
      content:
        "No wallet account found for this phone number. Please ensure the wallet app is installed and registered with this number.",
    };
  }

  // 409 - Conflict (e.g., payment already exists)
  if (httpStatus === 409) {
    return {
      code: "duplicate_payment",
      severity: "recoverable",
      content:
        "A payment request for this checkout is already being processed.",
    };
  }

  // 429 - Rate limited
  if (httpStatus === 429) {
    return {
      code: "too_many_requests",
      severity: "recoverable",
      content: "Too many requests. Please wait a moment and try again.",
    };
  }

  // 5xx - Server errors (should retry)
  if (httpStatus >= 500) {
    return {
      code: "payment_service_unavailable",
      severity: "recoverable",
      content: "Payment service is temporarily unavailable. Please try again.",
    };
  }

  // Default fallback - generic error, no details leaked
  return {
    code: "payment_failed",
    severity: "recoverable",
    content: "Payment processing failed. Please try again.",
  };
}
