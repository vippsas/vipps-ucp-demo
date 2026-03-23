// Vipps ePayment API - https://developer.vippsmobilepay.com/api/epayment/

export interface VippsEPaymentAmount {
  currency: "NOK" | "DKK" | "EUR";
  value: number; // minor units
}

export interface VippsEPaymentMSISDNCustomer {
  phoneNumber: string; // MSISDN format
}

export interface VippsEPaymentTokenCustomer {
  customerToken: string;
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
