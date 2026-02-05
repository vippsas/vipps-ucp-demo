import json from "../well-known/profile.json" with { type: "json" };

export function handleGetUCPProfile(_req: Request): Response {
  return new Response(JSON.stringify(json));
}
