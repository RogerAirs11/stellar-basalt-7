# Notification provider contracts (R96-N04)

This document is the single place where the platform's outbound notification
contracts are defined. The code that implements them:

- `src/notifications/email.ts` — the HTTP email adapter (chosen reference
  provider: **Resend**).
- `src/notifications/sms.ts` — the SMS adapter (Kavenegar, for OTP only).
- `src/notifications/outbox.ts` — the transactional outbox, lease dispatch,
  uncertain-send guard and callback recording.
- `src/notifications/callbackAdapters.ts` — vendor callback envelope translation.
- `src/notifications/worker.ts` — the scheduled drain caller.

## 1. Email — Resend-style HTTP JSON API (the chosen adapter)

The adapter speaks the generic "HTTPS JSON email API" contract that Resend,
Mailgun and Postmark all fit. **Resend is the documented reference vendor**;
the owner supplies the credentials and the endpoint.

### Request (what the adapter sends)

```
POST {EMAIL_API_URL}                      e.g. https://api.resend.com/emails
Authorization: Bearer {EMAIL_API_KEY}
Content-Type: application/json
Idempotency-Key: {event key}              (R96-N04, every send)
Accept: application/json

{ "from": "{EMAIL_FROM}", "to": "<recipient>", "subject": "...", "html": "..." }
```

Field rules the adapter enforces:

| Field | Rule |
| --- | --- |
| `from` | must contain `@`; the provider-verified sender identity |
| `to` | exactly one recipient resolved at send time from the purpose's own table — never a stored copy |
| `subject` / `html` | purpose-specific bilingual templates only (`emailMessageFor`); OTP codes and one-time tokens are **never** placed in outbox rows, logs, or callback history — they exist only inside the action link of the built message |
| `Idempotency-Key` | the outbox event key (stable per logical event, 8-190 URL-safe chars) |

### Response identifiers and semantics

- `200/201` with `{ "id": "<provider message id>" }` → **ACCEPTED ONLY**. The
  adapter records `accepted: true` + `providerMessageId`. Acceptance is never
  delivery; `delivered` exists exclusively via a signature-verified callback.
- `401/403` → `configuration` failure (bad key/sender) — no retry storm; the
  operator queue shows it.
- Other non-2xx → `provider_rejected` (retryable with backoff).
- Network error → `network`; timeout → `timeout`. **Both are UNCERTAIN
  outcomes** (see §3).

### Timeout

8 seconds default (`AbortSignal.timeout`), configurable per deployment.

### Rate limits (verify in the owner dashboard — plan dependent)

Resend's current published free tier: **100 emails/day, 3,000 emails/month**
(daily quota resets at midnight UTC). Rate-limit responses surface as
`provider_rejected` failures in the operator queue; the platform additionally
enforces its own per-recipient monthly cap via reservation accounting
(`notification_send_reservations`) independent of the vendor quota. Confirm
current numbers at https://resend.com/docs before capacity planning; the
platform never assumes a specific vendor limit in code.

### Idempotency window

Resend deduplicates requests carrying the same `Idempotency-Key` **within a
24-hour window** (confirmed against current vendor documentation, 2026-10).
The platform anchors this window at the row's `first_attempt_at`
(migration 0065) and:

1. every send carries the event key as the idempotency key;
2. an uncertain outcome (timeout/network) is retried only with the SAME key —
   the provider returns the original send's result instead of duplicating;
3. once `now - first_attempt_at >= 24h`, the drain REFUSES to resend: the row
   is dead-lettered with `idempotency_window_expired` for operator review —
   never a blind unkeyed duplicate;
4. an explicit operator retry resets the window anchor — the operator takes
   audited responsibility for one more keyed attempt.

## 2. SMS — Kavenegar (OTP only)

The only SMS purpose is `login_otp`, a one-time code. The outbox never stores
the code (privacy design): the worker honestly refuses to resend one-time
payloads (`payload_not_resendable`, immediate dead-letter) instead of
fabricating them. Kavenegar's documented delivery-report statuses are
translated exactly (5 = delivered, 6 = not delivered, everything else =
intermediate — never a delivery fact).

## 3. Uncertain-send handling (the R96-N04 protocol)

A timeout or network error after the request was issued MAY mean the provider
accepted the message. Such outcomes are never treated as definitely-unsent:

1. The row stays `queued` with `last_error='timeout'|'network'` and retries
   with the SAME idempotency key (§1) — provider-side dedupe makes the retry
   safe within the window.
2. A delivery callback that arrives BEFORE our acceptance bookkeeping (the
   lost-response case) upgrades the row directly: a signature-verified
   `delivered` callback carrying the event key moves a
   `queued`/`failed`/`dead_letter` row to `delivered`, records the provider
   message id, and retires any in-flight drain lease. `suppressed` rows are
   excluded — no provider IO ever happened for them.
3. Outside the idempotency window the row is dead-lettered
   (`idempotency_window_expired`), visible in the operator queue with masked
   recipient only.

Exactly-once is never claimed: dispatch is leased at-least-once with
provider-keyed retries inside a documented window, and delivery facts come
only from verified callbacks.

## 4. Callbacks (delivery evidence)

- Transport: the platform's HMAC bridge — `POST /api/notifications/callback/{provider}`
  with `x-signature: hex(HMAC-SHA256(secret, provider + ":" + rawBody))`.
  Vendor-native webhook signatures are not enabled; enabling one is an
  explicit owner decision.
- Replay rules: a replayed verified callback is idempotent (ON CONFLICT DO
  NOTHING on `notification_deliveries`; the response says `idempotent_replay`).
- Wrong-recipient / wrong-provider callbacks correlate nothing: acceptance
  correlation requires provider + message id (+ event key); the upgrade path
  additionally requires the event key to match a row whose recorded provider
  matches. Forged signatures are recorded `rejected` and change no state.
- Bounded evidence: raw bodies are never persisted — only a payload hash and
  the signature state, under retention control.

## 5. Quiet windows, consent and quotas (unchanged, re-verified)

Send-time re-authorization happens for every attempt: consent withdrawal,
revoked provider mandate, deactivated accounts and missing requests suppress
BEFORE any provider IO (no guess, no endless retry). Quiet hours and the
per-recipient monthly cap apply only to non-essential purposes; essential
security notices bypass them but never the idempotency guard. A quota slot is
reserved per attempt (concurrency-safe); a privacy refusal returns it.

## 6. What is deliberately NOT implemented (honest boundary)

- No vendor-native webhook signature verification (bridge HMAC only, until an
  owner explicitly enables a vendor scheme).
- No claim of recipient delivery from HTTP 2xx. No exactly-once claim.
- No automated refund/API-driven provider configuration; credentials are
  owner-supplied environment variables and nothing activates without them.
- Rate limits above are the vendor's published free-tier numbers at the time
  of writing; they are plan-dependent and must be re-verified in the owner
  dashboard — the code assumes none of them.
