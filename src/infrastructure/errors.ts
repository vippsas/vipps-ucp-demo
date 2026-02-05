/**
 * Converts an unknown value to an Error object.
 * If the value is already an Error, returns it directly. Otherwise, wraps the value in a new Error.
 * @param error - The value to convert (can be any type)
 * @returns An Error object
 */
export const unknownToError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
};

/**
 * Error thrown when a user under 18 attempts to access the service.
 * This error type can be detected by the app to display age-appropriate messaging.
 */
export class AgeRestrictionError extends Error {
  public readonly errorCode = "AGE_RESTRICTION_U18";
  public readonly statusCode = 403;

  constructor(message?: string) {
    super(message || "Service is not available for users under 18 years old");
    this.name = "AgeRestrictionError";
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgeRestrictionError);
    }
  }

  /**
   * Returns a JSON representation suitable for API responses
   */
  toJSON() {
    return {
      error: this.message,
      errorCode: this.errorCode,
      statusCode: this.statusCode,
    };
  }
}
