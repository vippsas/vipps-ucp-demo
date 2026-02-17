// UCP Ancillaries Extension - https://ucp.dev/specification/ancillaries/

/**
 * Item details for ancillary suggestions.
 * Mirrors the Item type from checkout but defined here to avoid circular imports.
 */
export interface AncillaryItem {
  id: string;
  title: string;
  price: number; // minor units
  description?: string;
  image_url?: string;
}

// ============================================
// Enums / Union Types
// ============================================

/**
 * Relationship type between ancillary and checkout/line item.
 * - complementary: Directly related to a line item (e.g., cables for phone)
 * - suggested: General upsell recommendation
 * - required: Legally or functionally required addition
 */
export type AncillarySuggestionType =
  | "complementary"
  | "suggested"
  | "required";

/**
 * Category of ancillary.
 * - product: Physical/digital goods (cables, cases, accessories)
 * - service: One-time services (installation, setup, gift wrapping)
 * - insurance: Protection/warranty plans
 */
export type AncillaryCategory = "product" | "service" | "insurance";

/**
 * Reason codes for automatically applied ancillaries.
 */
export type AncillaryReasonCode =
  | "legal_requirement"
  | "promotional_gift"
  | "bundle_component"
  | "loyalty_benefit";

// ============================================
// Input Types
// ============================================

/**
 * Option for selection-type inputs.
 */
export interface AncillaryInputOption {
  /** Option identifier. Sent as input.value when selected. */
  id: string;
  /** Human-readable option label for display to the buyer. */
  label: string;
}

/**
 * Constraints for input validation.
 */
export interface AncillaryInputConstraints {
  /** Maximum character length for 'text' type. */
  max_length?: number;
}

/**
 * Schema describing what input is required for an ancillary.
 */
export interface AncillaryInputSchema {
  /**
   * Input type identifier.
   * Well-known types: 'text' (free-form input), 'selection' (choice from options).
   */
  type: string;
  /** Human-readable label for the input field. */
  label?: string;
  /** Additional instructions or context for the input. */
  description?: string;
  /** Whether input is required to add this ancillary. Defaults to true. */
  required?: boolean;
  /**
   * Available options for 'selection' type inputs.
   * Options can represent time slots, configuration choices, or other selectable values.
   */
  options?: AncillaryInputOption[];
  /** Constraints for input validation. */
  constraints?: AncillaryInputConstraints;
}

/**
 * Input data for ancillaries that require buyer input.
 */
export interface AncillaryInput {
  /**
   * Well-known input type or custom identifier.
   * Well-known types: 'text', 'selection'.
   */
  type: string;
  /**
   * The input value.
   * For 'selection': the id of the selected option.
   * For 'text': the entered string.
   */
  value: string;
}

// ============================================
// Request Types
// ============================================

/**
 * Item reference for ancillary requests.
 */
export interface AncillaryItemReference {
  /** The product identifier (SKU) of the ancillary to add. */
  id: string;
}

/**
 * An ancillary item to add to the checkout.
 */
export interface AncillaryRequestItem {
  /** Item reference for the ancillary. */
  item: AncillaryItemReference;
  /** Line item ID this ancillary relates to. Required for relational ancillaries. */
  for?: string;
  /** Quantity of the ancillary. For relational ancillaries, MUST equal the quantity of the related line item. */
  quantity: number;
  /** Input data for ancillaries that require buyer input. */
  input?: AncillaryInput;
}

// ============================================
// Response Types
// ============================================

/**
 * A suggested ancillary item offered by the business.
 */
export interface AncillarySuggestion {
  /** Full item details for the suggested ancillary. */
  item: AncillaryItem;
  /** Relationship type. */
  type: AncillarySuggestionType;
  /** Category of ancillary. */
  category: AncillaryCategory;
  /** Line item ID this suggestion relates to. Present for complementary/required types. */
  for?: string;
  /**
   * Groups mutually exclusive product alternatives.
   * Each grouped ancillary is a distinct SKU with its own price—only one can be selected.
   */
  group_id?: string;
  /** Human-readable description explaining why this ancillary is suggested. */
  description?: string;
  /** Original price before promotional discount, in minor currency units. */
  original_price?: number;
  /** True if this ancillary requires buyer input before it can be added. */
  requires_input?: boolean;
  /** Schema describing what input is required. Present when requires_input is true. */
  input_schema?: AncillaryInputSchema;
  /** URL to external page with full terms, conditions, or details. */
  terms_url?: string;
}

/**
 * An ancillary that was successfully applied to the checkout.
 */
export interface AppliedAncillary {
  /** Line item ID of the applied ancillary in the checkout's line_items array. */
  id: string;
  /** Line item ID this ancillary relates to. Present for relational ancillaries. */
  for?: string;
  /** Relationship type. Matches the type from the original suggestion. */
  type: AncillarySuggestionType;
  /** Category of the applied ancillary. */
  category: AncillaryCategory;
  /** Group identifier for mutually exclusive alternatives. */
  group_id?: string;
  /** Human-readable description of the applied ancillary. */
  description: string;
  /** URL to external page with full terms, conditions, or details. */
  terms_url?: string;
  /** True if applied automatically by the business. Cannot be removed by the platform. */
  automatic?: boolean;
  /** Why the ancillary was automatically applied. Present when automatic is true. */
  reason_code?: AncillaryReasonCode;
  /** Input data provided for this ancillary. Present when the ancillary required input. */
  input?: AncillaryInput;
}

// ============================================
// Main Ancillaries Object
// ============================================

/**
 * Ancillaries request data (for create/update operations).
 */
export interface AncillariesRequest {
  /**
   * Ancillaries to add. Replaces previously submitted ancillaries.
   * Send empty array to clear all non-automatic ancillaries.
   */
  items?: AncillaryRequestItem[];
}

/**
 * Ancillaries response data (included in checkout session responses).
 */
export interface AncillariesResponse {
  /** Optional header text for ancillary suggestions. */
  title?: string;
  /** Suggested ancillaries offered by the business. */
  suggested?: AncillarySuggestion[];
  /** Ancillaries successfully applied to the checkout. */
  applied?: AppliedAncillary[];
}

/**
 * Combined ancillaries object for checkout session.
 * In requests: only `items` is used.
 * In responses: `title`, `suggested`, and `applied` are returned.
 */
export interface AncillariesObject
  extends AncillariesRequest, AncillariesResponse {}
