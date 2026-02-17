// UCP Fulfillment Extension - https://ucp.dev/specification/fulfillment/

import type { TotalEntry } from "./checkout.ts";

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
