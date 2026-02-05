/**
 * UCP Signing Keys for webhook signature generation.
 *
 * Loads keys from environment variables:
 * - UCP_SIGNING_KEY_ID: Key identifier
 * - UCP_SIGNING_PRIVATE_KEY: Private key in JWK JSON format
 * - UCP_SIGNING_PUBLIC_KEY: Public key in JWK JSON format
 *
 * @module
 */

import { importJWK, type JWK, SignJWT } from "@panva/jose";

// Runtime state
let privateKey: CryptoKey | null = null;
let keyId: string = "";
let publicKeyJwk: JWK | null = null;

/**
 * Initialize the signing keys from environment variables.
 * Call this at application startup.
 *
 * Required env vars:
 * - UCP_SIGNING_KEY_ID
 * - UCP_SIGNING_PRIVATE_KEY (JWK JSON)
 * - UCP_SIGNING_PUBLIC_KEY (JWK JSON)
 */
export async function initSigningKeys(): Promise<void> {
  const envKeyId = Deno.env.get("UCP_SIGNING_KEY_ID");
  const envPrivateKey = Deno.env.get("UCP_SIGNING_PRIVATE_KEY");
  const envPublicKey = Deno.env.get("UCP_SIGNING_PUBLIC_KEY");

  if (!envKeyId || !envPrivateKey || !envPublicKey) {
    const missing = [];
    if (!envKeyId) missing.push("UCP_SIGNING_KEY_ID");
    if (!envPrivateKey) missing.push("UCP_SIGNING_PRIVATE_KEY");
    if (!envPublicKey) missing.push("UCP_SIGNING_PUBLIC_KEY");

    throw new Error(
      `Missing required signing key environment variables: ${
        missing.join(", ")
      }. ` +
        `Copy .env_example to .env and configure the signing keys.`,
    );
  }

  try {
    const privateJwk = JSON.parse(envPrivateKey) as JWK;
    const publicJwk = JSON.parse(envPublicKey) as JWK;

    // Add standard JWK fields
    privateJwk.kid = envKeyId;
    privateJwk.alg = "ES256";
    privateJwk.use = "sig";

    publicJwk.kid = envKeyId;
    publicJwk.alg = "ES256";
    publicJwk.use = "sig";

    keyId = envKeyId;
    publicKeyJwk = publicJwk;
    privateKey = (await importJWK(privateJwk, "ES256")) as CryptoKey;

    console.log(`✅ Signing keys initialized (kid: ${keyId})`);
  } catch (error) {
    throw new Error(
      `Failed to parse signing keys from environment: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

/**
 * Get the key ID for the current signing key.
 */
export function getSigningKeyId(): string {
  if (!keyId) {
    throw new Error(
      "Signing keys not initialized. Call initSigningKeys() first.",
    );
  }
  return keyId;
}

/**
 * Get the public key JWK for inclusion in the UCP profile.
 */
export function getPublicKeyJwk(): JWK {
  if (!publicKeyJwk) {
    throw new Error(
      "Signing keys not initialized. Call initSigningKeys() first.",
    );
  }
  return publicKeyJwk;
}

/**
 * Get all signing keys for the UCP profile.
 * Returns an array to support key rotation.
 */
export function getSigningKeys(): JWK[] {
  if (!publicKeyJwk) {
    throw new Error(
      "Signing keys not initialized. Call initSigningKeys() first.",
    );
  }
  return [publicKeyJwk];
}

/**
 * Create a detached JWT signature for a request body (RFC 7797).
 *
 * The signature format is: header..signature (empty payload section)
 * The actual payload is the request body, which the receiver will use for verification.
 *
 * @param body - The request body to sign
 * @returns The detached JWT signature for the Request-Signature header
 */
export async function createDetachedSignature(body: string): Promise<string> {
  if (!privateKey) {
    throw new Error(
      "Signing keys not initialized. Call initSigningKeys() first.",
    );
  }

  const encoder = new TextEncoder();

  // Create the header
  const header = {
    alg: "ES256",
    kid: keyId,
  };
  const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));

  // Create the payload (base64url encoded body)
  const payloadB64 = base64urlEncode(encoder.encode(body));

  // Create the signing input: header.payload
  const signingInput = `${headerB64}.${payloadB64}`;

  // Sign using Web Crypto API
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );

  // Convert signature to base64url
  const signatureB64 = base64urlEncode(new Uint8Array(signature));

  // Return detached JWT: header..signature (empty payload section)
  return `${headerB64}..${signatureB64}`;
}

/**
 * Create a standard (non-detached) JWT signature.
 *
 * @param payload - The payload to include in the JWT
 * @returns The complete JWT
 */
export async function createSignature(
  payload: Record<string, unknown>,
): Promise<string> {
  if (!privateKey) {
    throw new Error(
      "Signing keys not initialized. Call initSigningKeys() first.",
    );
  }

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({
      alg: "ES256",
      kid: keyId,
    })
    .setIssuedAt()
    .sign(privateKey);

  return jwt;
}

/**
 * Base64url encode bytes (no padding).
 */
function base64urlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
