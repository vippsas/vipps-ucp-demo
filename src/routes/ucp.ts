import { formatCacheControl } from "@std/http/unstable-cache-control";
import { ucpProfile } from "../data/ucp-profile.ts";
import { getSigningPublicJwkForProfile } from "../infrastructure/signing_keys.ts";

const PROFILE_CACHE_CONTROL = formatCacheControl({
  public: true,
  maxAge: 300,
  staleWhileRevalidate: 60,
});

export function handleGetUCPProfile(_req: Request): Response {
  const profile = {
    ...ucpProfile,
    signing_keys: [getSigningPublicJwkForProfile()],
  };
  return new Response(JSON.stringify(profile), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": PROFILE_CACHE_CONTROL,
    },
  });
}
