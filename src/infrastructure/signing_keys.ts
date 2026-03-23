/**
 * UCP signing keys: JWS for legacy webhooks + JWK on profile for RFC 9421 (PR3).
 *
 * PR2 adds signing_keys to /.well-known/ucp. PR3 switches outbound webhooks
 * to RFC 9421 and drops createDetachedSignature.
 *
 * @module
 */

import { canonicalizeToBytes } from "@std/json/unstable-canonicalize";
import type { JsonValue } from "@std/json/types";

let privateKey!: CryptoKey;
let publicJwkForProfile!: JsonWebKey & { kid: string };

const KEY_ID = "dev-signing-key-1";

export async function initSigningKeys(): Promise<void> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  privateKey = keyPair.privateKey;

  const pub = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as
    & JsonWebKey
    & { kid?: string };
  pub.kid = KEY_ID;
  pub.alg = "ES256";
  pub.use = "sig";
  publicJwkForProfile = pub as JsonWebKey & { kid: string };

  console.log(`Signing keys initialized (kid: ${KEY_ID})`);
}

export function getSigningKeyId(): string {
  return KEY_ID;
}

/** Private key for RFC 9421 signMessage (used from PR3). */
export function getSigningPrivateKey(): CryptoKey {
  return privateKey;
}

/** Public JWK advertised in signing_keys on the merchant UCP profile. */
export function getSigningPublicJwkForProfile(): JsonWebKey & { kid: string } {
  return publicJwkForProfile;
}

/**
 * Legacy detached JWS over JCS payload (pre-RFC-9421 webhook sender; removed in PR3).
 */
export async function createDetachedSignature(
  payload: JsonValue,
): Promise<string> {
  const canonicalBytes = canonicalizeToBytes(payload);

  const encoder = new TextEncoder();
  const b64url = { alphabet: "base64url" as const, omitPadding: true };
  const header = { alg: "ES256", kid: KEY_ID };
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
