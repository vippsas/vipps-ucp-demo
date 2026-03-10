import { Hono } from "hono";
import { cors } from "hono/cors";
import { Logger } from "@deno-library/logger";
import { loadConfig } from "./infrastructure/config.ts";
import { UCP_HEADERS } from "./infrastructure/ucp_headers.ts";
import { initSigningKeys } from "./infrastructure/signing_keys.ts";
import {
  handleCancelCheckout,
  handleCompleteCheckout,
  handleCreateCheckoutSession,
  handleGetCheckoutSession,
  handleUpdateCheckoutSession,
  handleVippsCallback,
} from "./routes/checkout.ts";
import { handleShippingCallback } from "./routes/shipping.ts";

const { handleGetUCPProfile } = await import("./routes/ucp.ts");
const { initUCPProfile } = await import("./infrastructure/ucp_profile.ts");

// Initialize UCP profile (loads capabilities from well-known/profile.json)
await initUCPProfile();

// Initialize signing keys for webhook signatures
await loadConfig();
await initSigningKeys();

const ucpHeaderNames = Object.values(UCP_HEADERS);

const app = new Hono();

app.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "API-Version",
      "Idempotency-Key",
      "Request-Id",
      ...ucpHeaderNames,
    ],
    exposeHeaders: ucpHeaderNames,
  }),
);

app.get("/health", (c) => c.json({ ok: true, data: "ok" }));

app.get("/.well-known/ucp", (c) => handleGetUCPProfile(c.req.raw));

app.post("/checkout_sessions", (c) => handleCreateCheckoutSession(c.req.raw));
app.get(
  "/checkout_sessions/:id",
  (c) => handleGetCheckoutSession(c.req.raw, c.req.param("id")),
);
app.put(
  "/checkout_sessions/:id",
  (c) => handleUpdateCheckoutSession(c.req.raw, c.req.param("id")),
);
app.post(
  "/checkout_sessions/:id/complete",
  (c) => handleCompleteCheckout(c.req.raw, c.req.param("id")),
);
app.post(
  "/checkout_sessions/:id/cancel",
  (c) => handleCancelCheckout(c.req.raw, c.req.param("id")),
);

app.post("/api/vipps/callback", (c) => handleVippsCallback(c.req.raw));
app.post("/api/shipping/callback", (c) => handleShippingCallback(c.req.raw));

const PORT = 8080;
const logger = new Logger();
logger.info(`UCP Business Service starting on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
