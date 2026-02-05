import { load } from "@std/dotenv";

// Load .env file BEFORE importing other modules that use env vars
// Use the directory where main.ts is located to find .env
const envFile = new URL("./.env", import.meta.url);
try {
  // Try to read the file first to verify it exists and get proper path handling
  await Deno.readTextFile(envFile);

  // Convert URL to path string - handle Windows paths correctly
  // On Windows, pathname might be "/C:/Users/..." which needs the leading slash removed
  let envPath = envFile.pathname;
  if (Deno.build.os === "windows" && envPath.match(/^\/[A-Z]:/)) {
    // Remove leading slash on Windows (e.g., "/C:/Users" -> "C:/Users")
    envPath = envPath.slice(1);
  }

  await load({ envPath, export: true });
  console.log("✅ Loaded environment from .env file");

  // Debug: Log which credentials are loaded (without showing values)
  const clientId = Deno.env.get("VIPPS_CLIENT_ID");
  const clientSecret = Deno.env.get("VIPPS_CLIENT_SECRET");
  const subscriptionKey = Deno.env.get("VIPPS_SUBSCRIPTION_KEY");
  const msn = Deno.env.get("VIPPS_MERCHANT_SERIAL_NUMBER");

  console.log(`[ENV] VIPPS_CLIENT_ID: ${clientId ? "✓ set" : "✗ missing"}`);
  console.log(
    `[ENV] VIPPS_CLIENT_SECRET: ${clientSecret ? "✓ set" : "✗ missing"}`,
  );
  console.log(
    `[ENV] VIPPS_SUBSCRIPTION_KEY: ${subscriptionKey ? "✓ set" : "✗ missing"}`,
  );
  console.log(
    `[ENV] VIPPS_MERCHANT_SERIAL_NUMBER: ${msn ? "✓ set" : "✗ missing"}`,
  );
} catch (error) {
  // .env file is optional - credentials can also be set via system env vars
  if (error instanceof Deno.errors.NotFound) {
    console.log("ℹ️  No .env file found, using system environment variables");
  } else {
    console.warn(
      "⚠️  Could not load .env file:",
      error instanceof Error ? error.message : error,
    );
    console.warn(`⚠️  Attempted path: ${envFile.pathname}`);
  }
}

// Dynamic imports to ensure env is loaded first
const { handleGetProducts, handleGetProduct } = await import(
  "./routes/products.ts"
);
const {
  handleCreateCheckoutSession,
  handleGetCheckoutSession,
  handleUpdateCheckoutSession,
  handleCompleteCheckout,
  handleCancelCheckout,
  handleVippsCallback,
} = await import("./routes/checkout.ts");
const { UCP_HEADERS } = await import("./infrastructure/ucp_headers.ts");

const { handleGetUCPProfile } = await import("./routes/ucp.ts");

const PORT = 8080;

// Build UCP header names for CORS
const ucpHeaderNames = Object.values(UCP_HEADERS).join(", ");

// CORS headers for demo purposes
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers":
    `Content-Type, Authorization, API-Version, Idempotency-Key, Request-Id, ${ucpHeaderNames}`,
  "Access-Control-Expose-Headers": ucpHeaderNames,
};

function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
  return null;
}

function addCorsHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

async function router(req: Request): Promise<Response> {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Route GET /.well-known/ucp
  if (method === "GET" && path === "/.well-known/ucp") {
    return addCorsHeaders(handleGetUCPProfile(req));
  }

  // Route: GET /products
  if (method === "GET" && path === "/products") {
    return addCorsHeaders(await handleGetProducts(req));
  }

  // Route: GET /products/:sku
  const productMatch = path.match(/^\/products\/([^/]+)$/);
  if (method === "GET" && productMatch) {
    const sku = decodeURIComponent(productMatch[1]);
    return addCorsHeaders(await handleGetProduct(req, sku));
  }

  // Route: POST /checkout_sessions
  if (method === "POST" && path === "/checkout_sessions") {
    return addCorsHeaders(await handleCreateCheckoutSession(req));
  }

  // Route: GET /checkout_sessions/:id
  const sessionGetMatch = path.match(/^\/checkout_sessions\/([^/]+)$/);
  if (method === "GET" && sessionGetMatch) {
    const sessionId = decodeURIComponent(sessionGetMatch[1]);
    return addCorsHeaders(await handleGetCheckoutSession(req, sessionId));
  }

  // Route: PUT /checkout_sessions/:id (update fulfillment selection)
  const sessionUpdateMatch = path.match(/^\/checkout_sessions\/([^/]+)$/);
  if (method === "PUT" && sessionUpdateMatch) {
    const sessionId = decodeURIComponent(sessionUpdateMatch[1]);
    return addCorsHeaders(await handleUpdateCheckoutSession(req, sessionId));
  }

  // Route: POST /checkout_sessions/:id/complete
  const sessionCompleteMatch = path.match(
    /^\/checkout_sessions\/([^/]+)\/complete$/,
  );
  if (method === "POST" && sessionCompleteMatch) {
    const sessionId = decodeURIComponent(sessionCompleteMatch[1]);
    return addCorsHeaders(await handleCompleteCheckout(req, sessionId));
  }

  // Route: POST /checkout_sessions/:id/cancel
  const sessionCancelMatch = path.match(
    /^\/checkout_sessions\/([^/]+)\/cancel$/,
  );
  if (method === "POST" && sessionCancelMatch) {
    const sessionId = decodeURIComponent(sessionCancelMatch[1]);
    return addCorsHeaders(await handleCancelCheckout(req, sessionId));
  }

  // Route: POST /api/vipps/callback - Vipps ePayment webhook callback
  if (method === "POST" && path === "/api/vipps/callback") {
    return addCorsHeaders(await handleVippsCallback(req));
  }

  // Route: GET / - Health check
  if (method === "GET" && path === "/") {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          service: "UCP Business Service",
          status: "healthy",
          version: "1.0.0",
          ucp_version: "2025-01-01",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }

  // 404 Not Found
  return addCorsHeaders(
    new Response(
      JSON.stringify({
        error: {
          type: "not_found",
          code: "route_not_found",
          message: `Route ${method} ${path} not found`,
        },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
}

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  const dataDir = new URL("./data", import.meta.url).pathname;
  try {
    await Deno.mkdir(dataDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }

  // Initialize sessions.json if it doesn't exist
  const sessionsFile = `${dataDir}/sessions.json`;
  try {
    await Deno.stat(sessionsFile);
  } catch {
    await Deno.writeTextFile(
      sessionsFile,
      JSON.stringify({ sessions: [] }, null, 2),
    );
  }
}

// Start server
console.log(`🏪 UCP Business Service starting on port ${PORT}...`);
await ensureDataDir();
console.log(`✅ Data directory initialized`);
console.log(`📦 Products endpoint: http://localhost:${PORT}/products`);
console.log(`🛒 Checkout endpoint: http://localhost:${PORT}/checkout_sessions`);
console.log(`📲 Vipps callback: http://localhost:${PORT}/api/vipps/callback`);
console.log(`💚 Health check: http://localhost:${PORT}/`);

Deno.serve({ port: PORT }, router);
