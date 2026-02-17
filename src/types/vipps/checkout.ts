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
