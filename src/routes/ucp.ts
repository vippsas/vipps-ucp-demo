import { ucpProfile } from "../data/ucp-profile.ts";

export function handleGetUCPProfile(_req: Request): Response {
  return new Response(JSON.stringify(ucpProfile));
}
