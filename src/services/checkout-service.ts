/**
 * Checkout Session Service
 *
 * Manages checkout session persistence and business logic.
 * Handles session creation, retrieval, updates, and status transitions.
 */

import type {
  CheckoutSession,
  CheckoutSessionStatus,
  LineItemResponse,
  TotalEntry,
} from "../types/ucp/checkout.ts";
import type { SessionsStore } from "../types/merchant.ts";

// ============================================
// Configuration
// ============================================

const DATA_FILE = new URL("../data/sessions.json", import.meta.url).pathname;
const SESSION_EXPIRY_HOURS = 24;

// ============================================
// Session Persistence
// ============================================

/**
 * Loads all checkout sessions from the data file.
 */
export async function loadSessions(): Promise<CheckoutSession[]> {
  try {
    const data = await Deno.readTextFile(DATA_FILE);
    const store: SessionsStore = JSON.parse(data);
    return store.sessions;
  } catch {
    return [];
  }
}

/**
 * Saves all checkout sessions to the data file.
 */
export async function saveSessions(sessions: CheckoutSession[]): Promise<void> {
  const store: SessionsStore = { sessions };
  await Deno.writeTextFile(DATA_FILE, JSON.stringify(store, null, 2));
}

/**
 * Generates a unique session ID.
 */
export function generateSessionId(): string {
  return `cs-${crypto.randomUUID()}`;
}

// ============================================
// Session Retrieval
// ============================================

/**
 * Finds a checkout session by ID.
 */
export async function findSession(
  sessionId: string,
): Promise<CheckoutSession | null> {
  const sessions = await loadSessions();
  return sessions.find((s) => s.id === sessionId) ?? null;
}

/**
 * Finds a checkout session by Vipps reference.
 */
export async function findSessionByVippsReference(
  vippsReference: string,
): Promise<CheckoutSession | null> {
  const sessions = await loadSessions();
  return sessions.find(
    (s) =>
      s.metadata?.vipps_reference === vippsReference ||
      s.id === vippsReference,
  ) ?? null;
}

// ============================================
// Session Status Management
// ============================================

/**
 * Checks if a session has expired and updates its status if needed.
 * Returns the updated session.
 */
export async function checkAndUpdateExpiry(
  session: CheckoutSession,
): Promise<CheckoutSession> {
  const sessions = await loadSessions();
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index === -1) return session;

  const currentSession = sessions[index];
  let updated = false;

  // Check if session expired
  if (
    currentSession.expires_at &&
    Temporal.Instant.compare(
        Temporal.Instant.from(currentSession.expires_at),
        Temporal.Now.instant(),
      ) < 0 &&
    currentSession.status === "incomplete"
  ) {
    currentSession.status = "canceled";
    currentSession.messages = [{
      type: "error",
      code: "session_expired",
      severity: "recoverable",
      content: "This checkout session has expired.",
    }];
    updated = true;
  }

  // Check if payment expired (for complete_in_progress sessions)
  if (
    currentSession.status === "complete_in_progress" &&
    currentSession.payment?.expires_at &&
    Temporal.Instant.compare(
        Temporal.Instant.from(currentSession.payment.expires_at),
        Temporal.Now.instant(),
      ) < 0
  ) {
    currentSession.status = "incomplete";
    currentSession.payment.state = "expired";
    currentSession.messages = [{
      type: "error",
      code: "payment_expired",
      severity: "requires_buyer_input",
      content: "Payment request expired. Please try again.",
    }];
    updated = true;
  }

  if (updated) {
    await saveSessions(sessions);
  }

  return currentSession;
}

/**
 * Updates a session's status and saves it.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: CheckoutSessionStatus,
  additionalUpdates?: Partial<CheckoutSession>,
): Promise<CheckoutSession | null> {
  const sessions = await loadSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return null;

  const session = sessions[index];
  session.status = status;
  session.updated_at = Temporal.Now.instant().toString();

  if (additionalUpdates) {
    Object.assign(session, additionalUpdates);
  }

  await saveSessions(sessions);
  return session;
}

// ============================================
// Totals Calculation
// ============================================

/** Norwegian VAT rate */
export const TAX_RATE = 25;

/**
 * Calculates line item subtotal from the totals array.
 */
export function calculateSubtotal(lineItems: LineItemResponse[]): number {
  return lineItems.reduce((sum, li) => {
    const subtotalEntry = li.totals.find((t) => t.type === "subtotal");
    return sum + (subtotalEntry?.amount ?? 0);
  }, 0);
}

/**
 * Calculates tax from subtotal.
 */
export function calculateTax(subtotal: number): number {
  return Math.round(subtotal * (TAX_RATE / 100));
}

/**
 * Builds the totals array for a checkout session.
 */
export function buildTotals(
  subtotal: number,
  tax: number,
  fulfillmentCost: number,
): TotalEntry[] {
  const totals: TotalEntry[] = [
    { type: "subtotal", amount: subtotal },
    { type: "tax", amount: tax },
  ];

  if (fulfillmentCost > 0) {
    totals.push({ type: "shipping", amount: fulfillmentCost });
  }

  const total = subtotal + tax + fulfillmentCost;
  totals.push({ type: "total", amount: total });

  return totals;
}

/**
 * Gets the session expiry timestamp.
 */
export function getSessionExpiryTime(): string {
  return Temporal.Now.instant()
    .add(Temporal.Duration.from({ hours: SESSION_EXPIRY_HOURS }))
    .toString();
}
