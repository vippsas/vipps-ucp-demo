/**
 * UCP Signing Keys for webhook signature generation.
 *
 * Generates an ECDSA P-256 key pair at startup for signing webhooks.
 * Payloads are canonicalized with JCS (RFC 8785) before signing per the
 * UCP AP2 Mandates specification.
 *
 * @module
 */

import { canonicalizeToBytes } from "@std/json/unstable-canonicalize";
import type { JsonValue } from "@std/json/types";
let privateKey: CryptoKey;
let keyId: string;

const KEY_ID = "dev-signing-key-1";

export async function initSigningKeys(): Promise<void> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  privateKey = keyPair.privateKey;
  keyId = KEY_ID;

  console.log(`Signing keys initialized (kid: ${keyId})`);
}

export function getSigningKeyId(): string {
  return keyId;
}

/**
 * Create a detached JWS signature (RFC 7515 Appendix F) over a
 * JCS-canonicalized (RFC 8785) payload.
 *
 * Returns `header..signature` (empty payload section).
 * The receiver reconstructs the signing input by canonicalizing the
 * request body themselves.
 */
export async function createDetachedSignature(
  payload: JsonValue,
): Promise<string> {
  const canonicalBytes = canonicalizeToBytes(payload);

  const encoder = new TextEncoder();
  const b64url = { alphabet: "base64url" as const, omitPadding: true };
  const header = { alg: "ES256", kid: keyId };
  const headerB64 = encoder.encode(JSON.stringify(header)).toBase64(b64url);
  const payloadB64 = canonicalBytes.toBase64(b64url);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );

  const signatureB64 = new Uint8Array(signature).toBase64(b64url);
  return `${headerB64}..${signatureB64}`;
}
