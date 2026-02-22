import { formatCacheControl } from "@std/http/unstable-cache-control";
import { ucpProfile } from "../data/ucp-profile.ts";

const PROFILE_CACHE_CONTROL = formatCacheControl({
  public: true,
  maxAge: 300,
  staleWhileRevalidate: 60,
});

export function handleGetUCPProfile(_req: Request): Response {
  return new Response(JSON.stringify(ucpProfile), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": PROFILE_CACHE_CONTROL,
    },
  });
}
