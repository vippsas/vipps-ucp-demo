/**
 * UCP Profile Utility
 *
 * Reads the business UCP profile from well-known/profile.json and provides
 * helpers for accessing UCP version, capabilities, and response metadata.
 */

import type {
  UCPCapability,
  UCPResponseMetadata,
} from "../types/ucp/checkout.ts";

// ============================================
// Profile Types
// ============================================

interface UCPProfileCapability {
  version: string;
  spec?: string;
  schema?: string;
  extends?: string;
}

interface UCPProfilePaymentHandler {
  id: string;
  version: string;
  spec?: string;
  config_schema?: string;
  instrument_schemas?: string[];
  config?: Record<string, unknown>;
}

interface UCPProfileService {
  url: string;
  transport: string;
}

interface UCPProfile {
  ucp: {
    version: string;
    services?: Record<string, UCPProfileService>;
    capabilities: Record<string, UCPProfileCapability[]>;
    payment_handlers?: Record<string, UCPProfilePaymentHandler[]>;
  };
  signing_keys?: unknown[];
}

// ============================================
// Profile Loading
// ============================================

const PROFILE_FILE = new URL("../well-known/profile.json", import.meta.url);

let cachedProfile: UCPProfile | null = null;

/**
 * Loads the UCP profile from the well-known/profile.json file.
 * Caches the result for subsequent calls.
 */
async function loadProfile(): Promise<UCPProfile> {
  if (cachedProfile) {
    return cachedProfile;
  }

  const data = await Deno.readTextFile(PROFILE_FILE);
  cachedProfile = JSON.parse(data) as UCPProfile;
  return cachedProfile;
}

/**
 * Synchronously get the cached profile.
 * Throws if profile hasn't been loaded yet.
 */
function getProfile(): UCPProfile {
  if (!cachedProfile) {
    throw new Error(
      "UCP profile not loaded. Call initUCPProfile() during startup.",
    );
  }
  return cachedProfile;
}

// ============================================
// Public API
// ============================================

/**
 * Initialize the UCP profile. Call this during application startup.
 */
export async function initUCPProfile(): Promise<void> {
  await loadProfile();
  const profile = cachedProfile!;

  const capabilities = Object.keys(profile.ucp.capabilities);
  const paymentHandlers = Object.keys(profile.ucp.payment_handlers ?? {});

  console.log(`[UCP] Profile loaded:`);
  console.log(`  Version: ${profile.ucp.version}`);
  console.log(`  Capabilities: ${capabilities.join(", ")}`);
  console.log(`  Payment handlers: ${paymentHandlers.join(", ") || "none"}`);
}

/**
 * Get the UCP API version from the profile.
 */
export function getUCPVersion(): string {
  return getProfile().ucp.version;
}

/**
 * Get the list of capability names supported by this business.
 */
export function getCapabilityNames(): string[] {
  return Object.keys(getProfile().ucp.capabilities);
}

/**
 * Check if a specific capability is supported.
 */
export function hasCapability(capabilityName: string): boolean {
  return capabilityName in getProfile().ucp.capabilities;
}

/**
 * Get capability details for a specific capability.
 */
export function getCapability(
  capabilityName: string,
): UCPProfileCapability | undefined {
  const capabilities = getProfile().ucp.capabilities[capabilityName];
  return capabilities?.[0];
}

/**
 * Get the UCPResponseMetadata for use in checkout session responses.
 * This includes the version and all capabilities in the format expected by UCP.
 */
export function getUCPResponseMetadata(): UCPResponseMetadata {
  const profile = getProfile();
  const capabilities: UCPCapability[] = [];

  for (const [name, caps] of Object.entries(profile.ucp.capabilities)) {
    for (const cap of caps) {
      capabilities.push({
        name,
        version: cap.version,
        spec: cap.spec,
        schema: cap.schema,
        extends: cap.extends,
      });
    }
  }

  return {
    version: profile.ucp.version,
    capabilities,
  };
}

/**
 * Get a specific payment handler by its namespace.
 */
export function getPaymentHandler(
  namespace: string,
): UCPProfilePaymentHandler | undefined {
  const handlers = getProfile().ucp.payment_handlers?.[namespace];
  return handlers?.[0];
}

/**
 * Get the payment handler ID for a given namespace.
 */
export function getPaymentHandlerId(namespace: string): string | undefined {
  return getPaymentHandler(namespace)?.id;
}

/**
 * Get the payment handlers in the format expected by UCP.
 * { handler_name: [versions] }
 */
export function mapPaymentHandlers(): Record<string, string[]> | undefined {
  const handlers = getProfile().ucp.payment_handlers;
  if (!handlers) return undefined;
  const mapped: Record<string, string[]> = {};
  for (const [name, versions] of Object.entries(handlers)) {
    mapped[name] = versions.map((v) => v.version);
  }
  return mapped;
}

/**
 * Get all payment handler IDs supported by this business.
 */
export function getPaymentHandlerIds(): string[] {
  const handlers = getProfile().ucp.payment_handlers ?? {};
  return Object.values(handlers).flatMap((h) => h.map((handler) => handler.id));
}

/**
 * Get the service URL for a given service name.
 */
export function getServiceUrl(serviceName: string): string | undefined {
  return getProfile().ucp.services?.[serviceName]?.url;
}

/**
 * Get the raw profile object (for advanced use cases).
 */
export function getRawProfile(): UCPProfile {
  return getProfile();
}
