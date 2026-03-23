/**
 * Vipps wallet instrument validation.
 * @see https://ucp.vippsmobilepay.com/ucp/2026-01-23/schemas/wallet_payment_handler.json
 */

import type { UCPMessage } from "../../../../types/ucp/checkout.ts";
import type { WalletPaymentInstrument } from "../../../../types/ucp/payment.ts";

export const VIPPS_WALLET_HANDLER_ID = "vippsmobilepay_wallet_handler";

/**
 * Validates the wallet payment instrument.
 * Returns null if valid, or a UCPMessage error if invalid.
 */
export function validateInstrument(
  instrument: WalletPaymentInstrument,
): UCPMessage | null {
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

  if (!instrument.credential) {
    return {
      type: "error",
      code: "missing_credential",
      severity: "recoverable",
      content: "Payment credential is required.",
      path: "$.payment.instruments[0].credential",
    };
  }

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

  if (credentialType === "MSISDN") {
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
  } else {
    const token = instrument.credential.value;
    if (!token || typeof token !== "string" || token.trim() === "") {
      return {
        type: "error",
        code: "missing_credential_value",
        severity: "recoverable",
        content: "Payment credential value is required.",
        path: "$.payment.instruments[0].credential.value",
      };
    }
  }

  return null;
}
