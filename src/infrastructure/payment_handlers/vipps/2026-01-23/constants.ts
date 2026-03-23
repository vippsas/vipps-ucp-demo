/**
 * Vipps 2026-01-23 handler constants.
 * @see https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/
 */

/** Payment timeout for async PUSH_MESSAGE flow (5 minutes). */
export const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000;

export const VIPPS_POLL_INITIAL_DELAY_MS = 5000;
export const VIPPS_POLL_INTERVAL_MS = 2000;
export const VIPPS_POLL_MAX_ATTEMPTS = 150;

/** Norwegian VAT. */
export const TAX_RATE = 25;
