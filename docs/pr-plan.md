# PR split plan (`vipps-ucp-demo`)

Large changes are split into **small, sequential PRs** so each is reviewable. Later PRs may branch from the previous merged branch (stack) or be cherry-picked by directory.

**RFC 9421 alignment with `vipps-tobi`:** Tobi keeps primitives under [`vipps-tobi/src/libs/std_candidates/`](../../vipps-tobi/src/libs/std_candidates/) and policy in [`ucp_signing.ts`](../../vipps-tobi/src/agent/infrastructure/merchant_client/ucp_signing.ts). Demo mirrors that split: std-like code under `libs/std_candidates`, merchant wiring elsewhere. Add a short `libs/std_candidates/README.md` describing sync with Tobi until Deno std absorbs RFC 9421.

---

## PR 1 — RFC 9421 primitives (`libs/std_candidates`)

**Scope**

- `src/libs/std_candidates/message_signatures.ts`, `structured_fields.ts` (and `digest_fields.ts` if shared with Tobi’s signing story).
- **Do not** place this under `src/infrastructure/rfc9421/`.
- Wire `deno.json` imports (e.g. alias) so consumers import from `@…/libs/std_candidates/...`.
- No route or payment behavior changes unless required to compile (ideally none).

**Review:** Parity with Tobi `std_candidates`; intentional diffs called out in PR description.

---

## PR 2 — Signing keys + `/.well-known/ucp`

**Scope**

- `signing_keys.ts`, `initSigningKeys()` in startup, `routes/ucp.ts` adds `signing_keys` to profile JSON.
- Env/docs for local run.

**Review:** JWK shape matches what platforms (e.g. Tobi) use for verification.

**Depends on:** PR 1 if anything in this layer imports std_candidates (otherwise can be reordered with care).

---

## PR 3 — Outbound UCP order webhooks (RFC 9421)

**Scope**

- `webhook_sender.ts`: canonical body, `Content-Digest`, `Signature` / `Signature-Input`, component list aligned with Tobi’s inbound verification (`@method`, `@authority`, `@path`, `content-digest`, `content-type`).
- Still minimal or no new **routes** if possible.

**Review:** Match [`order_callback_handler.ts`](../../vipps-tobi/src/agent/features/order/order_callback_handler.ts) + [`ucp_signing.ts`](../../vipps-tobi/src/agent/infrastructure/merchant_client/ucp_signing.ts).

**Depends on:** PR 1 + PR 2.

---

## PR 4 — Payment handler structure (Vipps in the right layer)

**Scope**

- Thin registry in `payment_handler.ts`; Vipps HTTP/token/errors in `epayment_client.ts`; `create.ts` / `callback.ts` / `polling.ts` orchestrate session updates only.

**Review:** Boundaries only; behavior unchanged unless fixing obvious bugs.

**Depends on:** None of PR 1–3 (can stack before or parallel).

---

## PR 5 — Checkout: platform order webhook URL

**Scope**

- Parse platform profile / `UCP-Agent`, persist `platform_webhook_url` (and related fields) on `CheckoutSession`.
- Types + `checkout.ts` only; no shipping route yet.

**Review:** Graceful behavior when webhook URL is missing.

---

## PR 6 — Shipping simulation + signed platform webhook

**Scope**

- `routes/shipping.ts`, `createShippedOrderEvent`, `sendOrderWebhook`, session updates.

**Depends on:** PR 3 + PR 5.

---

## PR 7 — Orders dashboard (**presentation feature slice**)

**Scope**

- Treat as **UX / demo surface only**, logically separate from UCP crypto and Vipps.
- Suggested layout: `src/features/orders-dashboard/` (templates, client snippet) + thin `routes/orders_dashboard.ts` adapter; `main.ts` only registers routes.

**Review:** No payment/signing logic unless unavoidable (then split out).

**Depends on:** PR 5 minimum; PR 6 if UI reflects shipping/webhook results.

---

## PR 8 — Vipps ePayment status (**demo: polling only**)

**Intent (for the plan, not a promise to add code in every sub-PR):** This demo **does not implement** the [Vipps Webhooks API](https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/events/#epayment-api-event-types). **Automated** payment completion is driven by **polling** `GET /epayment/v1/payments/{reference}` only, per [polling guidelines](https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/).

**Production expectation (document in README / code comments):** Real integrations must use **both** webhooks and polling as required by the [ePayment checklist](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/checklist/#implement-both-webhooks-and-polling). Webhook registration (`POST /webhooks/v1/webhooks`) and [HMAC verification](https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication/) are **out of scope** for this demo to keep the project simple.

**Optional in-repo scope for PR 8 (small, reviewable):**

- Clarify comments and docs: polling is the demo path; `POST /api/payment/vipps/callback` is **manual/test only**, not Vipps-delivered webhooks.
- Tune polling intervals/timeouts only if needed; shared idempotent “apply terminal payment state” helper if polling and manual hook should stay in sync.

**Explicitly not in scope for PR 8:** Vipps Webhooks API client, registration lifecycle, or HMAC middleware.

---

## Dependency sketch

```text
PR1 (std_candidates) → PR2 (keys + profile) → PR3 (outbound UCP webhook)
PR3 + PR5 → PR6 (shipping)
PR5 → PR7 (dashboard); PR6 → PR7 if tied to fulfillment UI
PR4 parallel to PR1–3
PR8 (Vipps polling / docs) orthogonal; best after PR4 or alongside small doc PRs
```

---

## PR description template (each PR)

- **Depends on:** #…
- **Reviewers focus on:** …
- **How to test:** …

---

## Implemented in this repo (structural)

- **PR 1:** `src/libs/std_candidates/` holds `message_signatures.ts` and `structured_fields.ts` (see `README.md` there). `infrastructure/webhook_sender.ts` imports from this path.
- **PR 7:** `src/features/orders-dashboard/` contains dashboard HTML/JSON logic; `src/routes/orders_dashboard.ts` re-exports handlers only.

Remaining slices (PR 2–6, 8) may already overlap with current `main`—use this file when splitting **future** PRs or extracting commits.
