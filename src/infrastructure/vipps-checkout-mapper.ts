/**
 * Vipps Checkout Mapper
 *
 * Maps UCP checkout session data to Vipps Checkout API format.
 * Used when creating Vipps Checkout sessions for embedded checkout flow.
 *
 * @see https://developer.vippsmobilepay.com/api/checkout/
 */

import type { CheckoutSession, LineItemResponse } from "../types/ucp/checkout.ts";
import type {
  CreateVippsCheckoutSessionRequest,
  VippsCheckoutConfiguration,
  VippsMerchantInfo,
  VippsOrderLine,
  VippsOrderSummary,
  VippsPrefillCustomer,
  VippsTransactionRequest,
} from "../types/vipps/checkout.ts";

// ============================================
// Configuration
// ============================================

/** Norwegian VAT rate */
const TAX_RATE = 25;

/** Vipps Merchant Configuration - loaded from environment */
const VIPPS_MERCHANT_CONFIG: VippsMerchantInfo = {
  callbackUrl: Deno.env.get("VIPPS_CALLBACK_URL") ??
    "https://example.com/api/vipps/callback",
  returnUrl: Deno.env.get("VIPPS_RETURN_URL") ??
    "https://example.com/checkout/complete",
  callbackAuthorizationToken: Deno.env.get("VIPPS_CALLBACK_TOKEN"),
  termsAndConditionsUrl: Deno.env.get("VIPPS_TERMS_URL") ??
    "https://example.com/terms",
};

/** Default Vipps Checkout configuration */
const VIPPS_CHECKOUT_CONFIG: VippsCheckoutConfiguration = {
  elements: "Full",
  customerInteraction: "CUSTOMER_PRESENT",
  countries: {
    supported: ["NO", "SE", "DK", "FI"],
  },
  showOrderSummary: true,
};

/**
 * Default prefill customer data for demo/testing.
 * In production, this would come from the buyer data in the request.
 */
const DEFAULT_PREFILL_CUSTOMER: VippsPrefillCustomer = {
  firstName: "Test",
  lastName: "User",
  email: "test@example.com",
  phoneNumber: "4700000000",
  streetAddress: "Testveien 1",
  postalCode: "0001",
  city: "Oslo",
  country: "NO",
};

// ============================================
// Main Mapper
// ============================================

/**
 * Maps a UCP CheckoutSession to a Vipps CreateCheckoutSessionRequest.
 *
 * @param session - The UCP checkout session
 * @param merchantInfo - Optional merchant info overrides
 * @param configuration - Optional checkout configuration overrides
 */
export function mapUCPToVippsCheckoutRequest(
  session: CheckoutSession,
  merchantInfo?: Partial<VippsMerchantInfo>,
  configuration?: Partial<VippsCheckoutConfiguration>,
): CreateVippsCheckoutSessionRequest {
  return {
    type: "PAYMENT",
    reference: session.id,
    transaction: mapToVippsTransaction(session),
    prefillCustomer: mapBuyerToVippsPrefillCustomer(session),
    merchantInfo: {
      ...VIPPS_MERCHANT_CONFIG,
      ...merchantInfo,
    },
    configuration: {
      ...VIPPS_CHECKOUT_CONFIG,
      ...configuration,
    },
  };
}

// ============================================
// Transaction Mapping
// ============================================

/**
 * Maps UCP CheckoutSession to Vipps Transaction.
 */
function mapToVippsTransaction(
  session: CheckoutSession,
): VippsTransactionRequest {
  const totalEntry = session.totals.find((t) => t.type === "total");
  return {
    amount: {
      value: totalEntry?.amount ?? 0,
      currency: session.currency.toUpperCase(),
    },
    reference: session.id,
    paymentDescription: `Order ${session.id}`,
    orderSummary: mapToVippsOrderSummary(session),
  };
}

/**
 * Maps UCP CheckoutSession to Vipps OrderSummary.
 */
function mapToVippsOrderSummary(session: CheckoutSession): VippsOrderSummary {
  const orderLines = session.line_items.map(mapLineItemToVippsOrderLine);

  // Add shipping as an order line if applicable
  const shippingEntry = session.totals.find((t) => t.type === "shipping");
  if (shippingEntry && shippingEntry.amount > 0) {
    const shippingTax = Math.round(
      shippingEntry.amount * (TAX_RATE / (100 + TAX_RATE)),
    );
    orderLines.push({
      name: "Shipping",
      id: "SHIPPING",
      totalAmount: shippingEntry.amount,
      totalAmountExcludingTax: shippingEntry.amount - shippingTax,
      totalTaxAmount: shippingTax,
      taxPercentage: TAX_RATE,
      taxRate: TAX_RATE * 100,
      isShipping: true,
    });
  }

  return {
    orderLines,
    orderBottomLine: {
      currency: session.currency.toUpperCase(),
    },
  };
}

/**
 * Maps a UCP LineItemResponse to a Vipps OrderLine.
 */
function mapLineItemToVippsOrderLine(
  lineItem: LineItemResponse,
): VippsOrderLine {
  const totalEntry = lineItem.totals.find((t) => t.type === "total");
  const totalAmount = totalEntry?.amount ?? 0;
  const taxAmount = Math.round(totalAmount * (TAX_RATE / (100 + TAX_RATE)));
  const amountExcludingTax = totalAmount - taxAmount;

  return {
    name: lineItem.item.title,
    id: lineItem.item.id,
    totalAmount: totalAmount,
    totalAmountExcludingTax: amountExcludingTax,
    totalTaxAmount: taxAmount,
    taxPercentage: TAX_RATE,
    taxRate: TAX_RATE * 100, // Vipps uses basis points (2500 = 25%)
    unitInfo: {
      unitPrice: lineItem.item.price,
      quantity: lineItem.quantity.toString(),
      quantityUnit: "PCS",
    },
    discount: 0,
  };
}

// ============================================
// Customer Mapping
// ============================================

/**
 * Maps UCP Buyer to Vipps PrefillCustomer.
 */
function mapBuyerToVippsPrefillCustomer(
  session: CheckoutSession,
): VippsPrefillCustomer {
  const { buyer, shipping_address } = session;

  // Use default prefill data if no buyer or shipping address provided
  if (!buyer && !shipping_address) {
    return DEFAULT_PREFILL_CUSTOMER;
  }

  // Split name into first/last name if available
  let firstName: string | undefined;
  let lastName: string | undefined;

  if (buyer?.name) {
    const nameParts = buyer.name.trim().split(/\s+/);
    firstName = nameParts[0];
    lastName = nameParts.slice(1).join(" ") || undefined;
  } else if (shipping_address?.name) {
    const nameParts = shipping_address.name.trim().split(/\s+/);
    firstName = nameParts[0];
    lastName = nameParts.slice(1).join(" ") || undefined;
  }

  return {
    firstName: firstName ?? DEFAULT_PREFILL_CUSTOMER.firstName,
    lastName: lastName ?? DEFAULT_PREFILL_CUSTOMER.lastName,
    email: buyer?.email ?? DEFAULT_PREFILL_CUSTOMER.email,
    phoneNumber: buyer?.phone ?? DEFAULT_PREFILL_CUSTOMER.phoneNumber,
    streetAddress: shipping_address?.line_one ??
      DEFAULT_PREFILL_CUSTOMER.streetAddress,
    postalCode: shipping_address?.postal_code ??
      DEFAULT_PREFILL_CUSTOMER.postalCode,
    city: shipping_address?.city ?? DEFAULT_PREFILL_CUSTOMER.city,
    country: shipping_address?.country ?? DEFAULT_PREFILL_CUSTOMER.country,
  };
}
