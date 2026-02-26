/**
 * UCP (Universal Commerce Protocol) Header utilities built on RFC 9651 Structured Fields.
 *
 * Provides standardized header encoding/decoding for agent-server communication
 * in the Agentic Commerce Protocol.
 *
 * @module
 */

import {
  type BareItem,
  date,
  integer,
  isItem,
  item,
  type Item,
  parseDictionary,
  parseItem,
  parseList,
  serializeDictionary,
  serializeItem,
  serializeList,
  string,
  token,
} from "@std/http/unstable-structured-fields";

// =============================================================================
// UCP-Agent Header
// =============================================================================

/**
 * Information about a UCP agent making requests.
 *
 * @example Header format
 * ```
 * UCP-Agent: profile="https://vipps.no/agents/shopper/v1", name="VippsTobi", version=1
 * ```
 */
export interface UCPAgentInfo {
  /** URL to the agent's capability profile document */
  profile: string;
  /** Human-readable agent name */
  name?: string;
  /** Agent version number */
  version?: number;
  /** Agent instance identifier */
  instanceId?: string;
}

/**
 * Serializes agent information to a UCP-Agent header value.
 *
 * @example Usage
 * ```ts
 * const header = serializeUCPAgent({
 *   profile: "https://vipps.no/agents/shopper/v1",
 *   name: "VippsTobi",
 *   version: 1,
 * });
 * // Result: profile="https://vipps.no/agents/shopper/v1", name="VippsTobi", version=1
 * ```
 */
export function serializeUCPAgent(agent: UCPAgentInfo): string {
  const entries: [string, Item][] = [
    ["profile", item(string(agent.profile))],
  ];

  if (agent.name !== undefined) {
    entries.push(["name", item(string(agent.name))]);
  }
  if (agent.version !== undefined) {
    entries.push(["version", item(integer(agent.version))]);
  }
  if (agent.instanceId !== undefined) {
    entries.push(["instance-id", item(string(agent.instanceId))]);
  }

  return serializeDictionary(new Map(entries));
}

/**
 * Parses a UCP-Agent header value into agent information.
 *
 * @returns Parsed agent info, or null if the header is invalid.
 */
export function parseUCPAgent(header: string): UCPAgentInfo | null {
  try {
    const dict = parseDictionary(header);

    const profileItem = dict.get("profile");
    if (
      !profileItem || !isItem(profileItem) ||
      profileItem.value.type !== "string"
    ) {
      return null;
    }

    const result: UCPAgentInfo = {
      profile: profileItem.value.value,
    };

    const nameItem = dict.get("name");
    if (
      nameItem && isItem(nameItem) && nameItem.value.type === "string"
    ) {
      result.name = nameItem.value.value;
    }

    const versionItem = dict.get("version");
    if (
      versionItem && isItem(versionItem) &&
      versionItem.value.type === "integer"
    ) {
      result.version = versionItem.value.value;
    }

    const instanceIdItem = dict.get("instance-id");
    if (
      instanceIdItem && isItem(instanceIdItem) &&
      instanceIdItem.value.type === "string"
    ) {
      result.instanceId = instanceIdItem.value.value;
    }

    return result;
  } catch {
    return null;
  }
}

// =============================================================================
// UCP-Capabilities Header
// =============================================================================

/**
 * A capability with optional version and parameters.
 */
export interface UCPCapability {
  /** Capability name (e.g., "checkout", "payment", "shipping") */
  name: string;
  /** Capability version (e.g., "2025-01-01") */
  version?: string;
  /** Whether this capability is required */
  required?: boolean;
}

/**
 * Serializes capabilities to a UCP-Capabilities header value.
 *
 * @example Usage
 * ```ts
 * const header = serializeUCPCapabilities([
 *   { name: "checkout", version: "2025-01-01" },
 *   { name: "payment" },
 *   { name: "shipping", required: true },
 * ]);
 * // Result: checkout;version="2025-01-01", payment, shipping;required
 * ```
 */
export function serializeUCPCapabilities(
  capabilities: UCPCapability[],
): string {
  const list = capabilities.map((cap) => {
    const parameters: [string, BareItem][] = [];

    if (cap.version !== undefined) {
      parameters.push(["version", string(cap.version)]);
    }
    if (cap.required === true) {
      parameters.push(["required", { type: "boolean", value: true }]);
    }

    return item(token(cap.name), parameters);
  });

  return serializeList(list);
}

/**
 * Parses a UCP-Capabilities header value.
 *
 * @returns Array of capabilities, or null if the header is invalid.
 */
export function parseUCPCapabilities(header: string): UCPCapability[] | null {
  try {
    const list = parseList(header);
    const capabilities: UCPCapability[] = [];

    for (const member of list) {
      if (!isItem(member)) continue;
      if (member.value.type !== "token") continue;

      const cap: UCPCapability = { name: member.value.value };

      const versionParam = member.parameters.get("version");
      if (versionParam && versionParam.type === "string") {
        cap.version = versionParam.value;
      }

      const requiredParam = member.parameters.get("required");
      if (requiredParam && requiredParam.type === "boolean") {
        cap.required = requiredParam.value;
      }

      capabilities.push(cap);
    }

    return capabilities;
  } catch {
    return null;
  }
}

// =============================================================================
// UCP-Allowance Header
// =============================================================================

/**
 * Payment allowance information for delegated payments.
 */
export interface UCPAllowance {
  /** Maximum amount in minor currency units */
  maxAmount: number;
  /** Currency code (ISO 4217, lowercase) */
  currency: string;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Optional merchant identifier */
  merchantId?: string;
  /** Optional checkout session identifier */
  sessionId?: string;
}

/**
 * Serializes allowance information to a UCP-Allowance header value.
 *
 * @example Usage
 * ```ts
 * const header = serializeUCPAllowance({
 *   maxAmount: 100000,
 *   currency: "nok",
 *   expiresAt: new Date("2025-02-01T00:00:00Z"),
 *   merchantId: "demo_business_001",
 * });
 * // Result: max-amount=100000;currency="nok", expires=@1738368000, merchant="demo_business_001"
 * ```
 */
export function serializeUCPAllowance(allowance: UCPAllowance): string {
  const entries: [string, Item][] = [
    [
      "max-amount",
      item(integer(allowance.maxAmount), [
        ["currency", string(allowance.currency)],
      ]),
    ],
    ["expires", item(date(allowance.expiresAt))],
  ];

  if (allowance.merchantId !== undefined) {
    entries.push(["merchant", item(string(allowance.merchantId))]);
  }
  if (allowance.sessionId !== undefined) {
    entries.push(["session", item(string(allowance.sessionId))]);
  }

  return serializeDictionary(new Map(entries));
}

/**
 * Parses a UCP-Allowance header value.
 *
 * @returns Parsed allowance info, or null if the header is invalid.
 */
export function parseUCPAllowance(header: string): UCPAllowance | null {
  try {
    const dict = parseDictionary(header);

    const maxAmountItem = dict.get("max-amount");
    if (
      !maxAmountItem || !isItem(maxAmountItem) ||
      maxAmountItem.value.type !== "integer"
    ) {
      return null;
    }

    const currencyParam = maxAmountItem.parameters.get("currency");
    if (!currencyParam || currencyParam.type !== "string") {
      return null;
    }

    const expiresItem = dict.get("expires");
    if (
      !expiresItem || !isItem(expiresItem) ||
      expiresItem.value.type !== "date"
    ) {
      return null;
    }

    const result: UCPAllowance = {
      maxAmount: maxAmountItem.value.value,
      currency: currencyParam.value,
      expiresAt: expiresItem.value.value,
    };

    const merchantItem = dict.get("merchant");
    if (
      merchantItem && isItem(merchantItem) &&
      merchantItem.value.type === "string"
    ) {
      result.merchantId = merchantItem.value.value;
    }

    const sessionItem = dict.get("session");
    if (
      sessionItem && isItem(sessionItem) &&
      sessionItem.value.type === "string"
    ) {
      result.sessionId = sessionItem.value.value;
    }

    return result;
  } catch {
    return null;
  }
}

// =============================================================================
// UCP-Idempotency Header (Enhanced Idempotency-Key)
// =============================================================================

/**
 * Enhanced idempotency information with metadata.
 */
export interface UCPIdempotency {
  /** The idempotency key */
  key: string;
  /** When the key was created */
  createdAt?: Date;
  /** Time-to-live in seconds */
  ttl?: number;
}

/**
 * Serializes idempotency information to a UCP-Idempotency header value.
 *
 * @example Usage
 * ```ts
 * const header = serializeUCPIdempotency({
 *   key: "req_abc123",
 *   createdAt: new Date(),
 *   ttl: 3600,
 * });
 * // Result: "req_abc123";created=@1705708800;ttl=3600
 * ```
 */
export function serializeUCPIdempotency(idempotency: UCPIdempotency): string {
  const parameters: [string, BareItem][] = [];

  if (idempotency.createdAt !== undefined) {
    parameters.push(["created", date(idempotency.createdAt)]);
  }
  if (idempotency.ttl !== undefined) {
    parameters.push(["ttl", integer(idempotency.ttl)]);
  }

  return serializeItem(item(string(idempotency.key), parameters));
}

/**
 * Parses a UCP-Idempotency header value.
 *
 * @returns Parsed idempotency info, or null if the header is invalid.
 */
export function parseUCPIdempotency(header: string): UCPIdempotency | null {
  try {
    const parsed = parseItem(header);

    if (parsed.value.type !== "string") {
      return null;
    }

    const result: UCPIdempotency = {
      key: parsed.value.value,
    };

    const createdParam = parsed.parameters.get("created");
    if (createdParam && createdParam.type === "date") {
      result.createdAt = createdParam.value;
    }

    const ttlParam = parsed.parameters.get("ttl");
    if (ttlParam && ttlParam.type === "integer") {
      result.ttl = ttlParam.value;
    }

    return result;
  } catch {
    return null;
  }
}

// =============================================================================
// UCP-Request-Context Header
// =============================================================================

/**
 * Request context for tracing and correlation.
 */
export interface UCPRequestContext {
  /** Unique request identifier */
  requestId: string;
  /** Correlation ID for tracing across services */
  correlationId?: string;
  /** Session ID for user session tracking */
  sessionId?: string;
  /** Timestamp when the request was initiated */
  timestamp?: Date;
}

/**
 * Serializes request context to a UCP-Request-Context header value.
 */
export function serializeUCPRequestContext(context: UCPRequestContext): string {
  const entries: [string, Item][] = [
    ["request-id", item(string(context.requestId))],
  ];

  if (context.correlationId !== undefined) {
    entries.push(["correlation-id", item(string(context.correlationId))]);
  }
  if (context.sessionId !== undefined) {
    entries.push(["session-id", item(string(context.sessionId))]);
  }
  if (context.timestamp !== undefined) {
    entries.push(["timestamp", item(date(context.timestamp))]);
  }

  return serializeDictionary(new Map(entries));
}

/**
 * Parses a UCP-Request-Context header value.
 */
export function parseUCPRequestContext(
  header: string,
): UCPRequestContext | null {
  try {
    const dict = parseDictionary(header);

    const requestIdItem = dict.get("request-id");
    if (
      !requestIdItem || !isItem(requestIdItem) ||
      requestIdItem.value.type !== "string"
    ) {
      return null;
    }

    const result: UCPRequestContext = {
      requestId: requestIdItem.value.value,
    };

    const correlationIdItem = dict.get("correlation-id");
    if (
      correlationIdItem && isItem(correlationIdItem) &&
      correlationIdItem.value.type === "string"
    ) {
      result.correlationId = correlationIdItem.value.value;
    }

    const sessionIdItem = dict.get("session-id");
    if (
      sessionIdItem && isItem(sessionIdItem) &&
      sessionIdItem.value.type === "string"
    ) {
      result.sessionId = sessionIdItem.value.value;
    }

    const timestampItem = dict.get("timestamp");
    if (
      timestampItem && isItem(timestampItem) &&
      timestampItem.value.type === "date"
    ) {
      result.timestamp = timestampItem.value.value;
    }

    return result;
  } catch {
    return null;
  }
}

// =============================================================================
// Header Names Constants
// =============================================================================

/**
 * Standard UCP header names.
 */
export const UCP_HEADERS = {
  /** Agent identification header */
  AGENT: "UCP-Agent",
  /** Capabilities header */
  CAPABILITIES: "UCP-Capabilities",
  /** Allowance header for delegated payments */
  ALLOWANCE: "UCP-Allowance",
  /** Enhanced idempotency header */
  IDEMPOTENCY: "UCP-Idempotency",
  /** Request context header */
  REQUEST_CONTEXT: "UCP-Request-Context",
  /** API version header */
  API_VERSION: "UCP-API-Version",
} as const;

// =============================================================================
// Helper: Extract UCP Headers from Request
// =============================================================================

/**
 * Extracts all UCP headers from a request.
 */
export interface UCPHeadersFromRequest {
  agent: UCPAgentInfo | null;
  capabilities: UCPCapability[] | null;
  allowance: UCPAllowance | null;
  idempotency: UCPIdempotency | null;
  requestContext: UCPRequestContext | null;
  apiVersion: string | null;
}

/**
 * Parses all UCP headers from a Request object.
 */
export function parseUCPHeaders(
  request: Request,
  logWarnings = true,
): UCPHeadersFromRequest {
  const headers = request.headers;

  // Log warnings for missing headers (non-blocking for POC)
  if (logWarnings) {
    if (!headers.has(UCP_HEADERS.AGENT)) {
      console.warn(
        "⚠️  UCP-Agent header missing (required per spec, but not enforced for POC)",
      );
    }
    // Request-Id is typically in the Request-Context header
    if (
      !headers.has(UCP_HEADERS.REQUEST_CONTEXT) && !headers.has("Request-Id")
    ) {
      console.warn(
        "⚠️  Request-Id/UCP-Request-Context header missing (recommended per spec)",
      );
    }
  }

  const agent = headers.get(UCP_HEADERS.AGENT);
  const capabilities = headers.get(UCP_HEADERS.CAPABILITIES);
  const allowance = headers.get(UCP_HEADERS.ALLOWANCE);
  const idempotency = headers.get(UCP_HEADERS.IDEMPOTENCY);
  const requestContext = headers.get(UCP_HEADERS.REQUEST_CONTEXT);

  return {
    agent: agent ? parseUCPAgent(agent) : null,
    capabilities: capabilities ? parseUCPCapabilities(capabilities) : null,
    allowance: allowance ? parseUCPAllowance(allowance) : null,
    idempotency: idempotency ? parseUCPIdempotency(idempotency) : null,
    requestContext: requestContext
      ? parseUCPRequestContext(requestContext)
      : null,
    apiVersion: headers.get(UCP_HEADERS.API_VERSION),
  };
}

/**
 * Adds UCP headers to a Headers object or Response.
 */
export function addUCPHeaders(
  headers: Headers,
  ucpHeaders: {
    agent?: UCPAgentInfo;
    capabilities?: UCPCapability[];
    allowance?: UCPAllowance;
    idempotency?: UCPIdempotency;
    requestContext?: UCPRequestContext;
    apiVersion?: string;
  },
): void {
  if (ucpHeaders.agent) {
    headers.set(UCP_HEADERS.AGENT, serializeUCPAgent(ucpHeaders.agent));
  }
  if (ucpHeaders.capabilities) {
    headers.set(
      UCP_HEADERS.CAPABILITIES,
      serializeUCPCapabilities(ucpHeaders.capabilities),
    );
  }
  if (ucpHeaders.allowance) {
    headers.set(
      UCP_HEADERS.ALLOWANCE,
      serializeUCPAllowance(ucpHeaders.allowance),
    );
  }
  if (ucpHeaders.idempotency) {
    headers.set(
      UCP_HEADERS.IDEMPOTENCY,
      serializeUCPIdempotency(ucpHeaders.idempotency),
    );
  }
  if (ucpHeaders.requestContext) {
    headers.set(
      UCP_HEADERS.REQUEST_CONTEXT,
      serializeUCPRequestContext(ucpHeaders.requestContext),
    );
  }
  if (ucpHeaders.apiVersion) {
    headers.set(UCP_HEADERS.API_VERSION, ucpHeaders.apiVersion);
  }
}
