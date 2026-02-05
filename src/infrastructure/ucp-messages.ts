/**
 * UCP (Universal Checkout Protocol) Message Types
 *
 * Type system for working with messages in the Checkout HTTP/REST binding.
 * Messages appear in the `messages` array of checkout responses to communicate
 * errors, warnings, and informational notices.
 */

// =============================================================================
// Content Types
// =============================================================================

/** Format of the message content */
export type MessageContentType = "plain" | "markdown";

// =============================================================================
// Error Severity
// =============================================================================

/** Error severity levels as runtime array + type */
const ERROR_SEVERITIES = [
  "recoverable",
  "requires_buyer_input",
  "requires_buyer_review",
] as const satisfies readonly string[];

/**
 * Error severity levels indicating who/what can resolve the error
 *
 * - `recoverable`: Can be resolved programmatically by the platform via API calls
 * - `requires_buyer_input`: Requires information from the buyer (checkout incomplete)
 * - `requires_buyer_review`: Requires buyer review/authorization (checkout complete)
 */
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

// =============================================================================
// Error Codes
// =============================================================================

/** Standard error codes defined by UCP (runtime array) */
export const STANDARD_ERROR_CODES = [
  "missing",
  "invalid",
  "out_of_stock",
  "payment_declined",
  "requires_sign_in",
  "requires_3ds",
  "requires_identity_linking",
] as const satisfies readonly string[];

/** Standard error codes defined by UCP */
export type StandardErrorCode = (typeof STANDARD_ERROR_CODES)[number];

/** Discount-specific error codes (runtime array) */
export const DISCOUNT_ERROR_CODES = [
  "discount_code_expired",
  "discount_code_invalid",
  "discount_code_already_applied",
  "discount_code_combination_disallowed",
  "discount_code_user_not_logged_in",
  "discount_code_user_ineligible",
] as const satisfies readonly string[];

/** Discount-specific error codes */
export type DiscountErrorCode = (typeof DISCOUNT_ERROR_CODES)[number];

/** All known error codes (runtime array for validation) */
export const KNOWN_ERROR_CODES = [
  ...STANDARD_ERROR_CODES,
  ...DISCOUNT_ERROR_CODES,
] as const;

/** All known error codes (businesses can define custom codes) */
export type KnownErrorCode = StandardErrorCode | DiscountErrorCode;

/** Error code - known codes or custom string */
export type ErrorCode = KnownErrorCode | `${string}`;

// =============================================================================
// Warning Codes
// =============================================================================

/** Standard warning codes (runtime array) */
export const STANDARD_WARNING_CODES = [
  "final_sale",
  "prop65",
  "fulfillment_changed",
  "age_restricted",
] as const satisfies readonly string[];

/** Standard warning codes defined by UCP */
export type StandardWarningCode = (typeof STANDARD_WARNING_CODES)[number];

/** Warning code - known codes or custom string */
export type WarningCode = StandardWarningCode | `${string}`;

// =============================================================================
// Info Codes
// =============================================================================

/** Standard info codes (runtime array) */
export const STANDARD_INFO_CODES = [
  "free_shipping",
] as const satisfies readonly string[];

/** Standard info codes defined by UCP */
export type StandardInfoCode = (typeof STANDARD_INFO_CODES)[number];

/** Info code - known codes or custom string */
export type InfoCode = StandardInfoCode | `${string}`;

// =============================================================================
// Base Message Fields
// =============================================================================

/** Common fields shared by all message types */
type BaseMessageFields = {
  /**
   * RFC 9535 JSONPath to the related component in the checkout request/response.
   * @example "$.buyer.email"
   * @example "$.line_items[0]"
   * @example "$.payment"
   */
  path?: string;

  /**
   * Format of the content field.
   * @default "plain"
   */
  content_type?: MessageContentType;
};

// =============================================================================
// Message Types
// =============================================================================

/**
 * Error message indicating a problem that must be resolved.
 * The `severity` field indicates who can resolve the error.
 */
export type UCPErrorMessage = BaseMessageFields & {
  type: "error";

  /** Machine-readable error identifier */
  code: ErrorCode;

  /** Human-readable error description */
  content: string;

  /** Indicates who/what can resolve this error */
  severity: ErrorSeverity;
};

/**
 * Warning message for important notices that MUST be displayed to the buyer.
 */
export type UCPWarningMessage = BaseMessageFields & {
  type: "warning";

  /** Machine-readable warning identifier */
  code: WarningCode;

  /** Human-readable warning description */
  content: string;
};

/**
 * Informational message for non-critical notices.
 */
export type UCPInfoMessage = BaseMessageFields & {
  type: "info";

  /** Optional machine-readable identifier for programmatic handling */
  code?: InfoCode;

  /** Human-readable informational message */
  content: string;
};

/**
 * Union of all UCP message types.
 * Use type narrowing on the `type` field to access type-specific properties.
 *
 * @example
 * function handleMessage(message: UCPMessage) {
 *   switch (message.type) {
 *     case "error":
 *       console.log(`Error [${message.severity}]: ${message.code}`);
 *       break;
 *     case "warning":
 *       console.log(`Warning: ${message.code}`);
 *       break;
 *     case "info":
 *       console.log(`Info: ${message.content}`);
 *       break;
 *   }
 * }
 */
export type UCPMessage = UCPErrorMessage | UCPWarningMessage | UCPInfoMessage;

// =============================================================================
// Typed Error Variants (by Severity)
// =============================================================================

/** Mapped type for error variants by severity */
type ErrorBySeverity = {
  [S in ErrorSeverity]: Omit<UCPErrorMessage, "severity"> & { severity: S };
};

/** Error that can be resolved by the platform via API */
export type RecoverableError = ErrorBySeverity["recoverable"];

/** Error requiring buyer input (checkout incomplete) */
export type RequiresBuyerInputError = ErrorBySeverity["requires_buyer_input"];

/** Error requiring buyer review (checkout complete, needs authorization) */
export type RequiresBuyerReviewError = ErrorBySeverity["requires_buyer_review"];

// =============================================================================
// Type Guards
// =============================================================================

/** Check if a message is an error */
export function isErrorMessage(
  message: UCPMessage,
): message is UCPErrorMessage {
  return message.type === "error";
}

/** Check if a message is a warning */
export function isWarningMessage(
  message: UCPMessage,
): message is UCPWarningMessage {
  return message.type === "warning";
}

/** Check if a message is informational */
export function isInfoMessage(message: UCPMessage): message is UCPInfoMessage {
  return message.type === "info";
}

/** Check if an error is recoverable by the platform */
export function isRecoverableError(
  message: UCPMessage,
): message is RecoverableError {
  return message.type === "error" && message.severity === "recoverable";
}

/** Check if an error requires buyer input */
export function isRequiresBuyerInputError(
  message: UCPMessage,
): message is RequiresBuyerInputError {
  return message.type === "error" &&
    message.severity === "requires_buyer_input";
}

/** Check if an error requires buyer review */
export function isRequiresBuyerReviewError(
  message: UCPMessage,
): message is RequiresBuyerReviewError {
  return message.type === "error" &&
    message.severity === "requires_buyer_review";
}

/** Check if an error requires escalation to the buyer (either input or review) */
export function requiresEscalation(
  message: UCPMessage,
): message is RequiresBuyerInputError | RequiresBuyerReviewError {
  return (
    message.type === "error" &&
    (message.severity === "requires_buyer_input" ||
      message.severity === "requires_buyer_review")
  );
}

// =============================================================================
// Utility Types
// =============================================================================

/** Extract a message type by its discriminant */
export type MessageOfType<T extends UCPMessage["type"]> = Extract<
  UCPMessage,
  { type: T }
>;

/** Array of UCP messages (as returned in checkout responses) */
export type UCPMessages = UCPMessage[];

/** Partition of messages by type */
export type PartitionedMessages = {
  errors: UCPErrorMessage[];
  warnings: UCPWarningMessage[];
  infos: UCPInfoMessage[];
};

/** Partition of errors by severity */
export type PartitionedErrors = {
  recoverable: RecoverableError[];
  requiresBuyerInput: RequiresBuyerInputError[];
  requiresBuyerReview: RequiresBuyerReviewError[];
};

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an error message with proper typing based on severity.
 */
export function createErrorMessage<S extends ErrorSeverity>(
  code: ErrorCode,
  content: string,
  severity: S,
  options?: BaseMessageFields,
): ErrorBySeverity[S] {
  return {
    type: "error",
    code,
    content,
    severity,
    ...options,
  } as ErrorBySeverity[S];
}

/**
 * Create a warning message.
 */
export function createWarningMessage(
  code: WarningCode,
  content: string,
  options?: BaseMessageFields,
): UCPWarningMessage {
  return {
    type: "warning",
    code,
    content,
    ...options,
  };
}

/**
 * Create an info message.
 */
export function createInfoMessage(
  content: string,
  code?: InfoCode,
  options?: BaseMessageFields,
): UCPInfoMessage {
  return {
    type: "info",
    content,
    ...(code && { code }),
    ...options,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Partition messages by type for easier processing.
 */
export function partitionMessages(messages: UCPMessages): PartitionedMessages {
  return {
    errors: messages.filter(isErrorMessage),
    warnings: messages.filter(isWarningMessage),
    infos: messages.filter(isInfoMessage),
  };
}

/**
 * Partition errors by severity for processing according to UCP algorithm.
 *
 * Processing order:
 * 1. Resolve `recoverable` errors via API
 * 2. If `requiresBuyerInput` remains, hand off to buyer (checkout incomplete)
 * 3. If `requiresBuyerReview` remains, hand off to buyer (checkout complete)
 */
export function partitionErrorsBySeverity(
  errors: UCPErrorMessage[],
): PartitionedErrors {
  return {
    recoverable: errors.filter(
      (e): e is RecoverableError => e.severity === "recoverable",
    ),
    requiresBuyerInput: errors.filter(
      (e): e is RequiresBuyerInputError =>
        e.severity === "requires_buyer_input",
    ),
    requiresBuyerReview: errors.filter(
      (e): e is RequiresBuyerReviewError =>
        e.severity === "requires_buyer_review",
    ),
  };
}

/**
 * Get all messages targeting a specific JSONPath.
 * Useful for displaying field-specific errors in UI.
 *
 * @example
 * const emailErrors = getMessagesForPath(messages, "$.buyer.email");
 */
export function getMessagesForPath(
  messages: UCPMessages,
  path: string,
): UCPMessages {
  return messages.filter((m) => m.path === path);
}

/**
 * Check if any error requires escalation to the buyer.
 */
export function hasEscalationRequired(messages: UCPMessages): boolean {
  return messages.some(requiresEscalation);
}

/**
 * Check if all errors are recoverable (can be fixed via API).
 */
export function allErrorsRecoverable(messages: UCPMessages): boolean {
  return messages.filter(isErrorMessage).every((e) =>
    e.severity === "recoverable"
  );
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if a string is a known error code.
 * Useful for runtime validation.
 */
export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Check if a string is a known warning code.
 */
export function isKnownWarningCode(code: string): code is StandardWarningCode {
  return (STANDARD_WARNING_CODES as readonly string[]).includes(code);
}

/**
 * Check if a string is a known info code.
 */
export function isKnownInfoCode(code: string): code is StandardInfoCode {
  return (STANDARD_INFO_CODES as readonly string[]).includes(code);
}
