#!/usr/bin/env bash
# Build stacked review branches from origin/main (see docs/pr-plan.md).
set -euo pipefail
cd "$(dirname "$0")/.."
FULL=b29ae39
BIG=ba95e4c

git fetch origin main
git checkout -f origin/main

for b in pr/01-pr1-libs-std-candidates pr/02-pr2-signing-keys-ucp-profile \
  pr/03-pr3-rfc9421-outbound-webhooks pr/04-pr4-pr5-payment-handler-and-checkout \
  pr/04-pr4-payment-handler-refactor pr/05-pr5-checkout-platform-webhook \
  pr/05-pr6-shipping-fulfillment-persistence pr/06-pr6-shipping-fulfillment-persistence \
  pr/06-pr7-orders-dashboard pr/07-pr7-orders-dashboard pr/07-pr8a-readme-and-pr-plan \
  pr/08-pr8-docs-and-feature-slice pr/08-pr8b-orders-feature-slice-and-comments; do
  git branch -D "$b" 2>/dev/null || true
done

# --- PR1 ---
git checkout -b pr/01-pr1-libs-std-candidates
git checkout "$FULL" -- src/libs/std_candidates/
deno check src/main.ts
git add src/libs/std_candidates/
git commit -m "feat(pr1): add RFC 9421 primitives under libs/std_candidates

Vendored message_signatures + structured_fields for outbound UCP signing.
See src/libs/std_candidates/README.md and docs/pr-plan.md (PR 1)."

# --- PR2: hybrid signing (JWS + JWK) so main-branch webhook_sender still builds ---
git checkout -b pr/02-pr2-signing-keys-ucp-profile
git checkout "$BIG" -- src/routes/ucp.ts
python3 <<'PY'
from pathlib import Path
Path("src/infrastructure/signing_keys.ts").write_text(
    '''/**
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
''',
    encoding="utf-8",
)
PY
deno check src/main.ts
git add src/infrastructure/signing_keys.ts src/routes/ucp.ts
git commit -m "feat(pr2): advertise merchant signing JWK on UCP profile

Adds signing_keys[] to /.well-known/ucp. Keeps createDetachedSignature until PR3
migrates webhook_sender to RFC 9421 (docs/pr-plan.md PR 2)."

# --- PR3 ---
git checkout -b pr/03-pr3-rfc9421-outbound-webhooks
git checkout "$FULL" -- \
  src/infrastructure/content_digest.ts \
  src/infrastructure/webhook_sender.ts \
  src/infrastructure/signing_keys.ts \
  deno.lock
deno check src/main.ts
git add src/infrastructure/content_digest.ts src/infrastructure/webhook_sender.ts \
  src/infrastructure/signing_keys.ts deno.lock
git commit -m "feat(pr3): RFC 9421 + Content-Digest for outbound order webhooks

Replaces JWS with signMessage and Content-Digest per UCP (docs/pr-plan.md PR 3)."

# --- PR4 + PR5 (single PR: payment rename removes vipps_epayment_client.ts; checkout must move together) ---
git checkout -b pr/04-pr4-pr5-payment-handler-and-checkout
git checkout "$BIG" -- \
  src/infrastructure/payment_handlers/registry.ts \
  src/infrastructure/payment_handlers/types.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/access_token.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/callback.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/config.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/constants.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/create.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/epayment_client.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/payment_handler.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/polling.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/validate.ts \
  src/services/payment-service.ts \
  src/types/ucp/payment.ts \
  src/types/ucp/payment_handler.ts \
  src/types/ucp/payment_handlers/vipps/auth.ts \
  src/types/ucp/payment_handlers/vipps/epayment.ts \
  src/types/vipps/auth.ts \
  src/types/vipps/epayment.ts \
  src/routes/checkout.ts \
  src/types/ucp/checkout.ts
if [ -f src/infrastructure/vipps_epayment_client.ts ]; then
  git rm -f src/infrastructure/vipps_epayment_client.ts
fi
python3 scripts/build_pr4_main.py "$BIG" > src/main.ts
deno check src/main.ts
git add src/infrastructure/payment_handlers/ src/services/payment-service.ts \
  src/types/ucp/payment.ts src/types/ucp/payment_handler.ts \
  src/types/ucp/payment_handlers/ src/types/vipps/auth.ts src/types/vipps/epayment.ts \
  src/routes/checkout.ts src/types/ucp/checkout.ts \
  src/main.ts
git commit -m "refactor(pr4/pr5): payment handler registry + checkout platform webhook URL

Vipps ePayment client moves under payment_handlers/ (removes legacy vipps_epayment_client.ts).
Checkout uses payment-service; persists platform_webhook_url (docs/pr-plan.md PR 4–5).
main.ts registers handler only (no orders routes yet)."

# --- PR6 (plan) → branch pr/05 ---
git checkout -b pr/05-pr6-shipping-fulfillment-persistence
git checkout "$BIG" -- src/routes/shipping.ts
deno check src/main.ts
git add src/routes/shipping.ts
git commit -m "feat(pr6): persist merchant fulfillment after platform webhook

Shipping callback updates session.merchant_fulfillment (docs/pr-plan.md PR 6)."

# --- PR7 (plan) → branch pr/06 ---
git checkout -b pr/06-pr7-orders-dashboard
git checkout "$BIG" -- src/main.ts src/routes/orders_dashboard.ts
deno check src/main.ts
git add src/main.ts src/routes/orders_dashboard.ts
git commit -m "feat(pr7): orders dashboard + demo orders JSON API

GET / and GET /api/demo/orders (docs/pr-plan.md PR 7)."

# --- PR8a docs only → branch pr/07 ---
git checkout -b pr/07-pr8a-readme-and-pr-plan
git checkout "$FULL" -- README.md docs/pr-plan.md
git add README.md docs/pr-plan.md
git commit -m "docs(pr8a): README structure and sequential PR plan

Adds docs/pr-plan.md describing the review stack (PR 8 split for smaller diffs)."

# --- PR8b feature slice + Vipps demo notes → branch pr/08 ---
git checkout -b pr/08-pr8b-orders-feature-slice-and-comments
git checkout "$FULL" -- \
  src/features/orders-dashboard/dashboard_page.ts \
  src/features/orders-dashboard/mod.ts \
  src/features/orders-dashboard/placed_orders.ts \
  src/routes/orders_dashboard.ts \
  src/main.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/callback.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/create.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/epayment_client.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/polling.ts \
  src/routes/checkout.ts \
  src/services/payment-service.ts \
  src/types/ucp/payment_handler.ts
deno check src/main.ts
git add src/features/orders-dashboard/ src/routes/orders_dashboard.ts src/main.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/callback.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/create.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/epayment_client.ts \
  src/infrastructure/payment_handlers/vipps/2026-01-23/polling.ts \
  src/routes/checkout.ts src/services/payment-service.ts src/types/ucp/payment_handler.ts \
  scripts/build_pr4_main.py scripts/stack_prs.sh
git commit -m "refactor(pr8b): orders-dashboard feature slice; Vipps demo polling notes

Moves list/dashboard into src/features/orders-dashboard; clarifies polling-only demo;
adds scripts/stack_prs.sh to rebuild this stack (docs/pr-plan.md PR 8)."

echo "Done. Current branch: $(git branch --show-current)"
