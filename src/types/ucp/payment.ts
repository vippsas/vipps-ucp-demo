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
