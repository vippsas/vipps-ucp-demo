// UCP checkout Core Types - https://ucp.dev/specification/checkout-rest/

import type {
  FulfillmentResponse,
  FulfillmentUpdateRequest,
} from "./fulfillment.ts";
import type { AncillariesObject, AncillariesRequest } from "./ancillaries.ts";

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
  ancillaries?: AncillariesObject;
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
  ancillaries?: AncillariesRequest;
  metadata?: Record<string, string>;
}

export interface UpdateCheckoutSessionRequest {
  buyer?: Buyer;
  shipping_address?: Address;
  billing_address?: Address;
  fulfillment?: FulfillmentUpdateRequest;
  ancillaries?: AncillariesRequest;
}
