/**
 * Platform Profile Discovery.
 *
 * Fetches platform profiles from UCP-Agent header profile URLs
 * to discover webhook URLs and capabilities.
 *
 * @module
 */

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

/**
 * Simple cache for platform profiles
 */
const profileCache = new Map<
  string,
  { profile: PlatformProfile; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and parse a platform's UCP profile from their profile URL.
 * Results are cached for CACHE_TTL_MS.
 *
 * @param profileUrl - The platform's profile URL from UCP-Agent header
 * @returns The platform profile or null if fetch fails
 */
export async function fetchPlatformProfile(
  profileUrl: string,
): Promise<PlatformProfile | null> {
  // Check cache
  const cached = profileCache.get(profileUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  try {
    console.log(`[PLATFORM] Fetching profile from: ${profileUrl}`);

    const response = await fetch(profileUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      console.warn(
        `[PLATFORM] Failed to fetch profile: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const profile = (await response.json()) as PlatformProfile;

    // Cache it
    profileCache.set(profileUrl, {
      profile,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    console.log(`[PLATFORM] Profile fetched and cached`);
    return profile;
  } catch (error) {
    console.warn(
      `[PLATFORM] Error fetching profile: ${
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
