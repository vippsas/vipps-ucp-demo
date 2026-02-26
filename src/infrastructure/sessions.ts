import type { CheckoutSession } from "../types/ucp/checkout.ts";

const sessions: CheckoutSession[] = [];

export function loadSessions(): CheckoutSession[] {
  return [...sessions];
}

export function saveSessions(newSessions: CheckoutSession[]): void {
  sessions.length = 0;
  sessions.push(...newSessions);
}

export function generateSessionId(): string {
  return `cs-${crypto.randomUUID()}`;
}

/**
 * Get a checkout session by ID.
 * Used by checkout routes and shipping callback.
 */
export function getSessionById(
  sessionId: string,
): CheckoutSession | undefined {
  return sessions.find((s) => s.id === sessionId);
}
