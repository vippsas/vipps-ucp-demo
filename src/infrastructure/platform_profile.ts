/**
 * Platform Profile Discovery.
 *
 * Fetches platform profiles from UCP-Agent header profile URLs
 * to discover webhook URLs and capabilities.
 * Cache TTL is derived from the upstream `Cache-Control` header per
 * RFC 9111 (UCP spec: platforms SHOULD cache according to HTTP
 * cache-control directives).
 *
 * @module
 */

import { parseCacheControl } from "@std/http/unstable-cache-control";
import { Logger } from "@deno-library/logger";

const logger = new Logger();

/**
 * Platform's UCP profile structure (subset of what we need)
 */
interface PlatformProfile {
  ucp?: {
    version?: string;
    capabilities?: {
      "dev.ucp.shopping.order"?: Array<{
        version?: string;
        config?: {
          webhook_url?: string;
        };
      }>;
    };
  };
}

const DEFAULT_CACHE_TTL_S = 300;

const profileCache = new Map<
  string,
  { profile: PlatformProfile; expiresAt: number }
>();

/** Derive a TTL (in ms) from a response's Cache-Control header. */
function cacheTtlMs(response: Response): number {
  const cc = parseCacheControl(response.headers.get("cache-control"));
  const seconds = cc.maxAge ?? DEFAULT_CACHE_TTL_S;
  return seconds * 1000;
}

/**
 * Fetch and parse a platform's UCP profile from their profile URL.
 * Results are cached according to the upstream `Cache-Control` max-age
 * directive, falling back to {@link DEFAULT_CACHE_TTL_S} seconds.
 *
 * @param profileUrl - The platform's profile URL from UCP-Agent header
 * @returns The platform profile or null if fetch fails
 */
export async function fetchPlatformProfile(
  profileUrl: string,
): Promise<PlatformProfile | null> {
  const cached = profileCache.get(profileUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  try {
    logger.info(`Fetching profile from: ${profileUrl}`);

    const response = await fetch(profileUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      logger.warn(
        `Failed to fetch profile: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const profile = (await response.json()) as PlatformProfile;
    const ttl = cacheTtlMs(response);

    profileCache.set(profileUrl, {
      profile,
      expiresAt: Date.now() + ttl,
    });

    logger.info(`Profile fetched and cached (ttl: ${ttl / 1000}s)`);
    return profile;
  } catch (error) {
    logger.warn(
      `Error fetching profile: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return null;
  }
}

/**
 * Extract the order webhook URL from a platform profile.
 *
 * Looks for dev.ucp.shopping.order capability with config.webhook_url.
 *
 * @param profile - The platform's UCP profile
 * @returns The webhook URL or undefined if not found
 */
export function extractOrderWebhookUrl(
  profile: PlatformProfile,
): string | undefined {
  const orderCapabilities = profile.ucp?.capabilities
    ?.["dev.ucp.shopping.order"];

  if (!orderCapabilities || orderCapabilities.length === 0) {
    return undefined;
  }

  // Use the first capability that has a webhook_url
  for (const cap of orderCapabilities) {
    if (cap.config?.webhook_url) {
      return cap.config.webhook_url;
    }
  }

  return undefined;
}

/**
 * Fetch platform profile and extract order webhook URL in one call.
 *
 * @param profileUrl - The platform's profile URL from UCP-Agent header
 * @returns The webhook URL or undefined
 */
export async function discoverPlatformWebhookUrl(
  profileUrl: string,
): Promise<string | undefined> {
  const profile = await fetchPlatformProfile(profileUrl);
  if (!profile) return undefined;

  return extractOrderWebhookUrl(profile);
}

/**
 * Clear the profile cache (for testing)
 */
export function clearPlatformProfileCache(): void {
  profileCache.clear();
}
