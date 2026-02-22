/**
 * UCP Signing Keys for webhook signature generation.
 *
 * Generates an ECDSA P-256 key pair at startup for signing webhooks.
 *
 * @module
 */

import { encodeBase64Url } from "@std/encoding/base64url";

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
 * Create a detached JWT signature for a request body (RFC 7797).
 *
 * Returns header..signature (empty payload section).
 * The actual payload is the request body, which the receiver will use for verification.
 */
export async function createDetachedSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();

  const header = { alg: "ES256", kid: keyId };
  const headerB64 = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = encodeBase64Url(encoder.encode(body));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );

  const signatureB64 = encodeBase64Url(new Uint8Array(signature));
  return `${headerB64}..${signatureB64}`;
}
