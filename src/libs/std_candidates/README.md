# `std_candidates` (RFC 9421 primitives)

This folder mirrors the role of
[`vipps-tobi/src/libs/std_candidates/`](../../../../vipps-tobi/src/libs/std_candidates/):

- **`message_signatures.ts`** — RFC 9421 HTTP Message Signatures (`signMessage`, etc.).
- **`structured_fields.ts`** — Structured field parsing/serialization used by the signer.

Keep these files **in sync** with Tobi when fixing spec bugs or updating behavior, until a
canonical copy lands in Deno’s standard library.

**Consumers in this repo:** `infrastructure/webhook_sender.ts` (outbound UCP order webhooks).
