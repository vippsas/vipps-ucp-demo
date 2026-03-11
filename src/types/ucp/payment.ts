// Vipps Wallet Payment - https://ucp.vippsmobilepay.com/ucp/2026-01-23/payment_handlers/vipps_mp_payment_handler.md

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
