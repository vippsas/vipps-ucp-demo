/**
 * UCP signing keys for merchant webhooks (RFC 9421 HTTP Message Signatures).
 *
 * Generates an ECDSA P-256 key pair at startup. The public JWK is exposed via
 * `/.well-known/ucp` so platforms can verify order callbacks.
 *
 * @module
 */

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

/** Private key for RFC 9421 `signMessage` on outbound webhooks. */
export function getSigningPrivateKey(): CryptoKey {
  return privateKey;
}

/** Public JWK advertised in `signing_keys` on the merchant UCP profile. */
export function getSigningPublicJwkForProfile(): JsonWebKey & { kid: string } {
  return publicJwkForProfile;
}
