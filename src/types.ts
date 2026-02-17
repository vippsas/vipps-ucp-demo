// Product catalog types
export interface Product {
  sku: string;
  name: string;
  description: string;
  price: number; // minor units (cents/øre)
  currency: string;
  stock: number;
  image_url?: string;
}

// UCP Core Types - https://ucp.dev/specification/checkout-rest/

export interface TotalEntry {
  type: "subtotal" | "tax" | "shipping" | "discount" | "total";
  amount: number; // minor units
  description?: string;
}

export interface UCPCapability {
  name: string;
  version: string;
  spec?: string;
  schema?: string;
  extends?: string;
}

export interface UCPResponseMetadata {
  version: string;
  capabilities: UCPCapability[];
}

export interface Link {
  type: "terms_of_service" | "privacy_policy" | "return_policy";
  url: string;
  title?: string;
}

export interface Item {
  id: string;
  title: string;
  price: number; // minor units
  description?: string;
  image_url?: string;
}

export interface LineItemResponse {
  id: string;
  item: Item;
  quantity: number;
  totals: TotalEntry[];
}

export interface Address {
  name: string;
  line_one: string;
  line_two?: string;
  city: string;
  state: string;
  country: string; // ISO 3166-1 alpha-2
  postal_code: string;
}

export interface Buyer {
  email?: string;
  phone?: string;
  name?: string;
}

export type CheckoutSessionStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled"; // American spelling per UCP spec

export type PaymentState =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface CheckoutPaymentInfo {
  state: PaymentState;
  vipps_reference?: string;
  expires_at?: string; // RFC 3339
  psp_reference?: string;
}

export interface Order {
  id: string;
  reference: string;
  created_at: string; // RFC 3339
}

// UCP Fulfillment Extension - https://ucp.dev/specification/fulfillment/

export type FulfillmentMethodType = "shipping" | "pickup";

export interface PostalAddress {
  extended_address?: string;
  street_address?: string;
  address_locality?: string;
  address_region?: string;
  address_country?: string; // ISO 3166-1 alpha-2
  postal_code?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
}

export interface ShippingDestinationResponse extends PostalAddress {
  id: string;
}

export interface RetailLocationResponse {
  id: string;
  name: string;
  address?: PostalAddress;
}

export type FulfillmentDestinationResponse =
  | ShippingDestinationResponse
  | RetailLocationResponse;

export interface FulfillmentOptionResponse {
  id: string;
  title: string;
  description?: string;
  carrier?: string;
  earliest_fulfillment_time?: string; // RFC 3339
  latest_fulfillment_time?: string; // RFC 3339
  totals: TotalEntry[];
}

export interface FulfillmentGroupResponse {
  id: string;
  line_item_ids: string[];
  options?: FulfillmentOptionResponse[];
  selected_option_id?: string | null;
}

export interface FulfillmentMethodResponse {
  id: string;
  type: FulfillmentMethodType;
  line_item_ids: string[];
  destinations?: FulfillmentDestinationResponse[];
  selected_destination_id?: string | null;
  groups?: FulfillmentGroupResponse[];
}

export interface FulfillmentAvailableMethodResponse {
  type: FulfillmentMethodType;
  line_item_ids: string[];
  fulfillable_on?: string | null; // "now" or RFC 3339 date
  description?: string;
}

export interface FulfillmentResponse {
  methods?: FulfillmentMethodResponse[];
  available_methods?: FulfillmentAvailableMethodResponse[];
}

// Fulfillment Update Request Types (from Platform)

export interface FulfillmentGroupUpdateRequest {
  id: string;
  selected_option_id?: string | null;
}

export interface FulfillmentMethodUpdateRequest {
  id: string;
  selected_destination_id?: string | null;
  groups?: FulfillmentGroupUpdateRequest[];
}

export interface FulfillmentUpdateRequest {
  methods?: FulfillmentMethodUpdateRequest[];
}

export interface UpdateCheckoutSessionRequest {
  buyer?: Buyer;
  shipping_address?: Address;
  billing_address?: Address;
  fulfillment?: FulfillmentUpdateRequest;
}

export interface CheckoutSession {
  ucp: UCPResponseMetadata;
  id: string;
  status: CheckoutSessionStatus;
  currency: string; // ISO 4217
  line_items: LineItemResponse[];
  totals: TotalEntry[];
  links: Link[];
  buyer?: Buyer;
  shipping_address?: Address;
  billing_address?: Address;
  fulfillment?: FulfillmentResponse;
  payment?: CheckoutPaymentInfo;
  messages?: UCPMessage[];
  order?: Order;
  expires_at?: string; // RFC 3339
  continue_url?: string;
  created_at?: string; // RFC 3339
  updated_at?: string; // RFC 3339
  metadata?: Record<string, string>;
  /** Platform's webhook URL for order events (from UCP-Agent profile) */
  platform_webhook_url?: string;
  /** Platform's profile URL (from UCP-Agent header) */
  platform_profile_url?: string;
}

export interface CreateCheckoutSessionRequest {
  currency?: string;
  line_items: Array<{ sku: string; quantity: number }>;
  buyer?: Buyer;
  shipping_address?: Address;
  billing_address?: Address;
  metadata?: Record<string, string>;
}

// Vipps Wallet Payment - https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler
export interface WalletTokenPaymentCredential {
  type: "TOKEN";
  value: string;
} // This is the one we will most likely send. But we also support the below one

export interface WalletMSISDNPaymentCredential {
  type: "MSISDN";
  value: string; // MSISDN format
}

export interface WalletPaymentInstrument {
  id?: string;
  handler_id: string;
  type: "WALLET";
  credential: WalletTokenPaymentCredential | WalletMSISDNPaymentCredential;
}

export interface PaymentData {
  instruments: WalletPaymentInstrument[];
}

export interface CompleteCheckoutRequest {
  payment: PaymentData;
}

// UCP Messages - https://ucp.dev/specification/checkout/#error-handling

export type UCPMessageSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review";

export interface UCPMessageError {
  type: "error";
  path?: string; // JSONPath, e.g. $.payment.instruments[0]
  code: string;
  severity: UCPMessageSeverity;
  content: string;
  content_type?: "plain" | "markdown";
}

export interface UCPMessageWarning {
  type: "warning";
  path?: string;
  code: string;
  content: string;
  content_type?: "plain" | "markdown";
}

export interface UCPMessageInfo {
  type: "info";
  path?: string;
  code?: string;
  content: string;
  content_type?: "plain" | "markdown";
}

export type UCPMessage = UCPMessageError | UCPMessageWarning | UCPMessageInfo;

export type UCPCheckoutStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled";

export interface ErrorResponse {
  error: {
    type:
      | "invalid_request"
      | "not_found"
      | "processing_error"
      | "service_unavailable";
    code: string;
    message: string;
    param?: string;
  };
}

// Data store types

export interface ProductsStore {
  products: Product[];
}

export interface SessionsStore {
  sessions: CheckoutSession[];
}

// Vipps Checkout API (v3) - https://developer.vippsmobilepay.com/api/checkout/

export interface VippsMoney {
  value: number; // minor units
  currency: string;
}

export interface VippsUnitInfo {
  unitPrice: number;
  quantity: string;
  quantityUnit: string;
}

export interface VippsOrderLine {
  name: string;
  id: string;
  totalAmount: number;
  totalAmountExcludingTax: number;
  totalTaxAmount: number;
  taxPercentage: number;
  taxRate: number;
  unitInfo?: VippsUnitInfo;
  discount?: number;
  productUrl?: string;
  isReturn?: boolean;
  isShipping?: boolean;
}

export interface VippsPaymentSources {
  giftCard?: number;
  card?: number;
  voucher?: number;
  cash?: number;
}

export interface VippsOrderBottomLine {
  currency: string;
  tipAmount?: number;
  giftCardAmount?: number;
  terminalId?: string;
  paymentSources?: VippsPaymentSources;
  receiptNumber?: string;
}

export interface VippsOrderSummary {
  orderLines: VippsOrderLine[];
  orderBottomLine: VippsOrderBottomLine;
}

export interface VippsTransactionRequest {
  amount: VippsMoney;
  reference?: string;
  paymentDescription: string;
  orderSummary?: VippsOrderSummary;
}

export type VippsLogisticsType =
  | "MAILBOX"
  | "PICKUP_POINT"
  | "HOME_DELIVERY"
  | "STORE_PICKUP";

export type VippsLogisticsBrand =
  | "POSTEN"
  | "BRING"
  | "POSTNORD"
  | "PORTERBUDDY"
  | "HELTHJEM"
  | "POSTI"
  | "GLS"
  | "DAO"
  | "OTHER";

export interface VippsLogisticsOption {
  brand: VippsLogisticsBrand;
  id: string;
  priority: number;
  isDefault: boolean;
  description?: string;
  amount: VippsMoney;
  type?: VippsLogisticsType;
}

export interface VippsLogisticsIntegration {
  porterbuddy?: {
    publicToken: string;
    origin: {
      name: string;
      email: string;
      phoneNumber: string;
      address: {
        streetAddress: string;
        postalCode: string;
        city: string;
        country: string;
      };
    };
  };
  instabox?: { clientId: string; clientSecret: string };
  helthjem?: { username: string; password: string; shopId: number };
}

export interface VippsLogistics {
  dynamicOptionsCallback?: string;
  fixedOptions?: VippsLogisticsOption[];
  integrations?: VippsLogisticsIntegration;
}

export interface VippsPrefillCustomer {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  streetAddress?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

export interface VippsMerchantInfo {
  callbackUrl: string;
  returnUrl: string;
  callbackAuthorizationToken?: string;
  termsAndConditionsUrl?: string;
}

export type VippsCustomerInteraction =
  | "CUSTOMER_PRESENT"
  | "CUSTOMER_NOT_PRESENT";
export type VippsCheckoutElements =
  | "Full"
  | "PaymentOnly"
  | "PaymentAndContactInfo";

export interface VippsExternalPaymentMethod {
  paymentMethod: string;
  redirectUrl: string;
}

export interface VippsCountriesConfig {
  supported: string[];
}

export interface VippsCheckoutConfiguration {
  customerInteraction?: VippsCustomerInteraction;
  elements?: VippsCheckoutElements;
  countries?: VippsCountriesConfig;
  showOrderSummary?: boolean;
  requireUserInfo?: boolean;
  externalPaymentMethods?: VippsExternalPaymentMethod[];
}

export type VippsSessionType = "PAYMENT" | "SUBSCRIPTION";

export interface CreateVippsCheckoutSessionRequest {
  type: VippsSessionType;
  reference?: string | null;
  transaction: VippsTransactionRequest;
  logistics?: VippsLogistics | null;
  prefillCustomer?: VippsPrefillCustomer | null;
  merchantInfo: VippsMerchantInfo;
  configuration?: VippsCheckoutConfiguration | null;
}

export interface CreateVippsCheckoutSessionResponse {
  token: string;
  checkoutFrontendUrl: string;
  pollingUrl: string;
}

export type VippsSessionState =
  | "SessionCreated"
  | "PaymentInitiated"
  | "SessionExpired"
  | "PaymentSuccessful"
  | "PaymentTerminated";

export type VippsPaymentMethod = "Wallet" | "Card";

export type VippsPaymentState =
  | "CREATED"
  | "AUTHORIZED"
  | "TERMINATED"
  | "ABORTED"
  | "EXPIRED"
  | "SALE"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "PARTIALLY_CAPTURED";

export interface VippsPaymentAggregate {
  cancelledAmount?: VippsMoney;
  capturedAmount?: VippsMoney;
  refundedAmount?: VippsMoney;
  authorizedAmount?: VippsMoney;
}

export interface VippsPaymentDetails {
  amount: VippsMoney;
  state: VippsPaymentState;
  aggregate?: VippsPaymentAggregate;
  type?: string;
}

export interface VippsSubscriptionDetails {
  state: string;
  agreementId?: string;
}

export interface VippsUserInfo {
  sub: string;
  email?: string;
}

export interface VippsPickupPoint {
  id: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  openingHours?: string[];
}

export interface VippsTimeSlot {
  id?: string;
  date?: string;
  start?: string;
  end?: string;
}

export interface VippsShippingDetails {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  shippingMethodId?: string;
  amount?: VippsMoney;
  pickupPoint?: VippsPickupPoint;
  timeslot?: VippsTimeSlot;
}

export interface VippsBillingDetails {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface VippsCheckoutSessionInfo {
  sessionId: string;
  merchantSerialNumber: string;
  reference: string;
  sessionState: VippsSessionState;
  paymentMethod?: VippsPaymentMethod;
  subscriptionDetails?: VippsSubscriptionDetails;
  paymentDetails?: VippsPaymentDetails;
  userInfo?: VippsUserInfo;
  shippingDetails?: VippsShippingDetails;
  billingDetails?: VippsBillingDetails;
  customConsentProvided?: boolean;
}

export interface UpdateVippsSessionRequest {
  transaction?: VippsTransactionRequest | null;
  logisticOptions?: VippsLogisticsOption[] | null;
}

export interface VippsDynamicOptionsCallbackPayload {
  streetAddress: string;
  postalCode: string;
  region?: string;
  country: string;
}

export interface VippsSessionCompletedCallback {
  reference: string;
  sessionState: VippsSessionState;
  paymentDetails?: VippsPaymentDetails;
}

export interface VippsCheckoutError {
  type: string;
  code: string;
  message: string;
  contextId?: string;
  extraDetails?: Array<{ field?: string; reason?: string; message?: string }>;
}

// Vipps Access Token API - https://developer.vippsmobilepay.com/api/access-token/

export interface VippsAccessTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface VippsAccessTokenError {
  error: string;
  error_description?: string;
}

// Vipps ePayment API - https://developer.vippsmobilepay.com/api/epayment/

export interface VippsEPaymentAmount {
  currency: "NOK" | "DKK" | "EUR";
  value: number; // minor units
}

export interface VippsEPaymentMethod {
  type: "WALLET" | "CARD";
}

export type VippsEPaymentUserFlow =
  | "PUSH_MESSAGE"
  | "NATIVE_REDIRECT"
  | "WEB_REDIRECT"
  | "QR";

export interface VippsEPaymentOrderLine {
  name: string;
  id: string;
  totalAmount: number;
  totalAmountExcludingTax: number;
  totalTaxAmount: number;
  taxPercentage: number;
  unitInfo?: { unitPrice: number; quantity: string; quantityUnit: string };
  discount?: number;
  productUrl?: string;
  isReturn?: boolean;
  isShipping?: boolean;
}

export interface VippsEPaymentBottomLine {
  currency: VippsEPaymentAmount["currency"];
  tipAmount?: number;
  totalAmount?: number;
  totalTax?: number;
  totalDiscount?: number;
  shippingAmount?: number;
  giftCardAmount?: number;
  terminalId?: string;
}

export interface VippsEPaymentReceipt {
  orderLines: VippsEPaymentOrderLine[];
  bottomLine: VippsEPaymentBottomLine;
}

export interface VippsCreatePaymentRequest {
  amount: VippsEPaymentAmount;
  customer: VippsEPaymentTokenCustomer | VippsEPaymentMSISDNCustomer;
  paymentMethod: VippsEPaymentMethod;
  reference: string;
  userFlow: VippsEPaymentUserFlow;
  paymentDescription?: string;
  returnUrl?: string;
  receipt?: VippsEPaymentReceipt;
}

export type VippsEPaymentState =
  | "CREATED"
  | "ABORTED"
  | "EXPIRED"
  | "AUTHORIZED"
  | "TERMINATED";

export interface VippsEPaymentAggregate {
  authorizedAmount?: VippsEPaymentAmount;
  cancelledAmount?: VippsEPaymentAmount;
  capturedAmount?: VippsEPaymentAmount;
  refundedAmount?: VippsEPaymentAmount;
}

export interface VippsCreatePaymentResponse {
  redirectUrl?: string;
  reference: string;
  state: VippsEPaymentState;
  aggregate?: VippsEPaymentAggregate;
  pspReference?: string;
}

export interface VippsEPaymentError {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  extraDetails?: Array<{ name?: string; reason?: string }>;
}
