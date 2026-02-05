/**
 * UCP (Universal Commerce Protocol) Header utilities built on RFC 9651 Structured Fields.
 *
 * Provides standardized header encoding/decoding for agent-server communication
 * in the Agentic Commerce Protocol.
 *
 * @module
 */

import {
  isBareItemType,
  isItem,
  parseDictionary,
  parseItem,
  parseList,
  serializeDictionary,
  serializeItem,
  serializeList,
  type SfBareItem,
  sfDate,
  sfInteger,
  type SfItem,
  type SfList,
  sfString,
  sfToken,
} from "./structured_fields.ts";

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
  const entries: [string, SfItem][] = [
    ["profile", { value: sfString(agent.profile), parameters: new Map() }],
  ];

  if (agent.name !== undefined) {
    entries.push(["name", {
      value: sfString(agent.name),
      parameters: new Map(),
    }]);
  }
  if (agent.version !== undefined) {
    entries.push(["version", {
      value: sfInteger(agent.version),
      parameters: new Map(),
    }]);
  }
  if (agent.instanceId !== undefined) {
    entries.push(["instance-id", {
      value: sfString(agent.instanceId),
      parameters: new Map(),
    }]);
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
      !isBareItemType(profileItem.value, "string")
    ) {
      return null;
    }

    const result: UCPAgentInfo = {
      profile: profileItem.value.value,
    };

    const nameItem = dict.get("name");
    if (
      nameItem && isItem(nameItem) && isBareItemType(nameItem.value, "string")
    ) {
      result.name = nameItem.value.value;
    }

    const versionItem = dict.get("version");
    if (
      versionItem && isItem(versionItem) &&
      isBareItemType(versionItem.value, "integer")
    ) {
      result.version = versionItem.value.value;
    }

    const instanceIdItem = dict.get("instance-id");
    if (
      instanceIdItem && isItem(instanceIdItem) &&
      isBareItemType(instanceIdItem.value, "string")
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
  const list: SfList = capabilities.map((cap) => {
    const parameters = new Map<string, SfBareItem>();

    if (cap.version !== undefined) {
      parameters.set("version", sfString(cap.version));
    }
    if (cap.required === true) {
      parameters.set("required", { type: "boolean", value: true });
    }

    return {
      value: sfToken(cap.name),
      parameters,
    };
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
      if (!isBareItemType(member.value, "token")) continue;

      const cap: UCPCapability = { name: member.value.value };

      const versionParam = member.parameters.get("version");
      if (versionParam && isBareItemType(versionParam, "string")) {
        cap.version = versionParam.value;
      }

      const requiredParam = member.parameters.get("required");
      if (requiredParam && isBareItemType(requiredParam, "boolean")) {
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
  const entries: [string, SfItem][] = [
    [
      "max-amount",
      {
        value: sfInteger(allowance.maxAmount),
        parameters: new Map([["currency", sfString(allowance.currency)]]),
      },
    ],
    ["expires", { value: sfDate(allowance.expiresAt), parameters: new Map() }],
  ];

  if (allowance.merchantId !== undefined) {
    entries.push(["merchant", {
      value: sfString(allowance.merchantId),
      parameters: new Map(),
    }]);
  }
  if (allowance.sessionId !== undefined) {
    entries.push(["session", {
      value: sfString(allowance.sessionId),
      parameters: new Map(),
    }]);
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
      !isBareItemType(maxAmountItem.value, "integer")
    ) {
      return null;
    }

    const currencyParam = maxAmountItem.parameters.get("currency");
    if (!currencyParam || !isBareItemType(currencyParam, "string")) {
      return null;
    }

    const expiresItem = dict.get("expires");
    if (
      !expiresItem || !isItem(expiresItem) ||
      !isBareItemType(expiresItem.value, "date")
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
      isBareItemType(merchantItem.value, "string")
    ) {
      result.merchantId = merchantItem.value.value;
    }

    const sessionItem = dict.get("session");
    if (
      sessionItem && isItem(sessionItem) &&
      isBareItemType(sessionItem.value, "string")
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
  const parameters = new Map<string, SfBareItem>();

  if (idempotency.createdAt !== undefined) {
    parameters.set("created", sfDate(idempotency.createdAt));
  }
  if (idempotency.ttl !== undefined) {
    parameters.set("ttl", sfInteger(idempotency.ttl));
  }

  return serializeItem({
    value: sfString(idempotency.key),
    parameters,
  });
}

/**
 * Parses a UCP-Idempotency header value.
 *
 * @returns Parsed idempotency info, or null if the header is invalid.
 */
export function parseUCPIdempotency(header: string): UCPIdempotency | null {
  try {
    const item = parseItem(header);

    if (!isBareItemType(item.value, "string")) {
      return null;
    }

    const result: UCPIdempotency = {
      key: item.value.value,
    };

    const createdParam = item.parameters.get("created");
    if (createdParam && isBareItemType(createdParam, "date")) {
      result.createdAt = createdParam.value;
    }

    const ttlParam = item.parameters.get("ttl");
    if (ttlParam && isBareItemType(ttlParam, "integer")) {
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
  const entries: [string, SfItem][] = [
    ["request-id", {
      value: sfString(context.requestId),
      parameters: new Map(),
    }],
  ];

  if (context.correlationId !== undefined) {
    entries.push(["correlation-id", {
      value: sfString(context.correlationId),
      parameters: new Map(),
    }]);
  }
  if (context.sessionId !== undefined) {
    entries.push(["session-id", {
      value: sfString(context.sessionId),
      parameters: new Map(),
    }]);
  }
  if (context.timestamp !== undefined) {
    entries.push(["timestamp", {
      value: sfDate(context.timestamp),
      parameters: new Map(),
    }]);
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
      !isBareItemType(requestIdItem.value, "string")
    ) {
      return null;
    }

    const result: UCPRequestContext = {
      requestId: requestIdItem.value.value,
    };

    const correlationIdItem = dict.get("correlation-id");
    if (
      correlationIdItem && isItem(correlationIdItem) &&
      isBareItemType(correlationIdItem.value, "string")
    ) {
      result.correlationId = correlationIdItem.value.value;
    }

    const sessionIdItem = dict.get("session-id");
    if (
      sessionIdItem && isItem(sessionIdItem) &&
      isBareItemType(sessionIdItem.value, "string")
    ) {
      result.sessionId = sessionIdItem.value.value;
    }

    const timestampItem = dict.get("timestamp");
    if (
      timestampItem && isItem(timestampItem) &&
      isBareItemType(timestampItem.value, "date")
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

  return {
    agent: headers.has(UCP_HEADERS.AGENT)
      ? parseUCPAgent(headers.get(UCP_HEADERS.AGENT)!)
      : null,
    capabilities: headers.has(UCP_HEADERS.CAPABILITIES)
      ? parseUCPCapabilities(headers.get(UCP_HEADERS.CAPABILITIES)!)
      : null,
    allowance: headers.has(UCP_HEADERS.ALLOWANCE)
      ? parseUCPAllowance(headers.get(UCP_HEADERS.ALLOWANCE)!)
      : null,
    idempotency: headers.has(UCP_HEADERS.IDEMPOTENCY)
      ? parseUCPIdempotency(headers.get(UCP_HEADERS.IDEMPOTENCY)!)
      : null,
    requestContext: headers.has(UCP_HEADERS.REQUEST_CONTEXT)
      ? parseUCPRequestContext(headers.get(UCP_HEADERS.REQUEST_CONTEXT)!)
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
