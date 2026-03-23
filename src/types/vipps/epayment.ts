/**
 * Vipps ePayment API types.
 * @see https://developer.vippsmobilepay.com/api/epayment/
 */

export interface VippsEPaymentAmount {
  currency: "NOK" | "DKK" | "EUR";
  value: number;
}

export interface VippsEPaymentMSISDNCustomer {
  phoneNumber: string;
}

export interface VippsEPaymentTokenCustomer {
  customerToken: string;
}

export interface VippsEPaymentOrderLine {
  name: string;
  id: string;
  totalAmount: number;
  totalAmountExcludingTax: number;
  totalTaxAmount: number;
  taxPercentage: number;
  unitInfo: {
    unitPrice: number;
    quantity: string;
    quantityUnit: string;
  };
  isShipping?: boolean;
}

export interface VippsEPaymentReceipt {
  orderLines: VippsEPaymentOrderLine[];
  bottomLine: {
    currency: string;
    totalAmount: number;
    totalTax: number;
    shippingAmount?: number;
  };
}

export interface VippsCreatePaymentRequest {
  amount: VippsEPaymentAmount;
  customer: VippsEPaymentMSISDNCustomer | VippsEPaymentTokenCustomer;
  paymentMethod: { type: string };
  reference: string;
  userFlow: string;
  paymentDescription?: string;
  receipt?: VippsEPaymentReceipt;
}

export interface VippsCreatePaymentResponse {
  reference: string;
  state: string;
  pspReference?: string;
}

export interface VippsEPaymentError {
  title?: string;
  detail?: string;
  [key: string]: unknown;
}
