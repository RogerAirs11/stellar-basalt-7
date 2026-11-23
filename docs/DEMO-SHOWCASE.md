# Horse Registry — Demo & Showcase Guide

> Status: **R98-N10/N11 demo batch (application 0.56.0)**. The live site at
> `https://horse-registry-nextgen.rogerfires10.workers.dev` is demo-ready.
> This guide is the single walkthrough for showcasing the platform TODAY,
> with every simulated surface clearly labeled.

## What can be demonstrated live right now

| Capability | Status | How |
|---|---|---|
| Registry search, pedigree, results, newsroom (78k+ horses) | REAL data | Browse the live site |
| Five production frontends (Heritage, Classic Registry, EquiData, FEI Classic, Retro Astra) | REAL | The launcher on the live site |
| Directory: persons, organizations, credentials, honest badges | REAL workflows | Directory pages + admin queues |
| Organization onboarding, staff lifecycle, inboxes (N07) | REAL workflows | `/organizations/manage/:id` + API |
| Credential evidence + expiry workflows (N08) | REAL workflows | Renewal + review queues |
| Privacy: redaction, holds, retention (N09) | REAL workflows | Admin privacy queues |
| Person profile edit + claim UX (N06) | REAL workflows | `/directory/manage/:id` |
| **Paid workspace journey (N10)** | **DEMO gateway — free placeholder** | See §2 |
| **Notification delivery pipeline (N11)** | **DEMO loopback — free placeholder** | See §3 |
| Local-only interactive workbench | Static demo | `/demo-workbench/?lang=en|fa` |

## 1. What the free placeholders replace (and what they do NOT fake)

Two capabilities were blocked on OWNER-PROVIDED accounts: a Zarinpal merchant
account (payments) and real delivery providers (email/SMS). The demo batch
adds **honest placeholders** so the full journeys can be demonstrated without
those accounts:

- **Demo payment gateway (N10)** — speaks the SAME provider contract as the
  real Zarinpal adapter and settles INSIDE the application database
  (`demo_payment_sessions`). The entire journey runs its REAL code: order
  freezing, attempt reservation, hosted pay page, server-side verification,
  command receipts, entitlement grants, workspace gating, renewal
  accumulation, expiry read-only. Only the settlement is simulated. Every
  attempt is stored `provider='demo'`, every API response carries the demo
  note, and the real gateway stays fail-closed (it still 503s without
  merchant credentials + the owner's terminal-release approval).
- **Demo email provider (N11)** — satisfies the SAME `EmailProvider` contract
  as the real HTTP adapter (idempotency window, request fingerprint, lease
  discipline). Sends are recorded in an operator-visible demo inbox
  (`demo_deliveries`) and reported as ACCEPTED — acceptance is still never
  delivery. Delivery exists ONLY through the real HMAC-signed callback path,
  driven by an explicit operator action. SMS (login OTP) stays honestly
  unavailable: a demo SMS inbox readable by an operator would be an
  account-takeover vector, so it was deliberately NOT simulated.

Both are enabled by deployment flags (`DEMO_PAYMENTS_ENABLED`,
`DEMO_NOTIFICATIONS_ENABLED`) and BOTH yield to a real provider the moment
one is configured. Nothing about the placeholders weakens a production
safeguard — that is pinned by 29 real-database tests
(`r98-n10-demo-payment-journey.test.ts`, `r98-n11-demo-notifications.test.ts`).

## 2. Demo: the paid stable-workspace journey (N10)

Prerequisites: a registered account, and the demo offer price seeded by
`scripts/seed-demo-catalog.mjs` (farm workspace, 30 days, 1,900,000 toman —
a labeled demonstration hypothesis, not a verified market rate).

1. **Choose the offer** — `GET /api/billing/catalog` shows the live offer.
   `POST /api/billing/orders` with `{order_key, items:[{sku:"farm_workspace_monthly", quantity:1}], payer_organization_id}`.
   The total is recomputed server-side and frozen into the order.
2. **Start the payment** — `POST /api/billing/orders/:id/pay`. The response
   carries `demo: true`, the demo note, and the hosted pay page URL
   (`/demo-pay/?authority=...`). Show the buyer the note: *"DEMO gateway
   active: this is a simulated settlement... no real charge can occur."*
3. **The hosted gateway page** — open the `start_pay_url`. It is a faithful
   miniature of a real provider checkout: amount in toman + rial, description,
   session expiry, and two actions — *Simulate successful payment* /
   *Simulate cancellation*. No card or bank fields exist at all.
4. **Settle and redirect** — choose an outcome. The page records the
   settlement (a `DEMO-...` reference for a payment) and redirects to the
   server callback exactly like a real gateway — whose status parameter the
   callback deliberately ignores.
5. **Server-side verification** — `POST /api/billing/payments/verify` with
   the attempt id. Only now is the entitlement granted (30 days, org-held).
   Demonstrate honesty: verify BEFORE settling reports `not_paid`; a
   cancelled session reports `not_paid`; a forged authority reports
   `authority_not_found`; replaying verification never extends expiry.
6. **Use the workspace** — `POST /api/workspaces` (the organization context),
   add horses, invite staff, create timezone-aware tasks. Show the dashboard
   buckets and the CSV export.
7. **Renewal** — a second order paid through the demo gateway EXTENDS the
   same entitlement row (never a second row, never double time).
8. **Expiry** — after expiry the workspace is READ-ONLY: writes refuse with
   the honest renewal pointer, reads and exports keep working, nothing is
   lost; a renewal restores writes on the next request.

## 3. Demo: notification delivery and reconciliation (N11)

1. **A real business event** — a workspace task due in its own timezone
   enqueues a reminder exactly once (`workspace_task_due` in the outbox).
2. **The drain** — the scheduled worker (or `drainNotificationOutbox`) picks
   it up. With the demo loopback active, the provider-side inbox records the
   message and the outbox row moves to `provider_accepted` — NOT delivered.
   Show `GET /api/admin/notifications/outbox`: the four independent pipeline
   metrics (attempted / accepted / delivered / failed) are visible.
3. **The operator inbox** — `GET /api/admin/notifications/demo-deliveries`
   pairs the provider-side record (address, subject, message id) with the
   platform-side outbox state.
4. **Settlement through the REAL path** — `POST /api/admin/notifications/demo-deliveries/:id/callback`
   with `{outcome: "delivered"}` (or `not_delivered`). The action builds the
   provider's bridge envelope, signs it exactly like the real bridge
   (HMAC over `provider:rawBody`) and drives the production recording path:
   signature verification, envelope translation, replay handling and CAS
   correlation. The outbox row only NOW becomes `delivered`.
5. **Honesty pins** — replaying the callback cannot regress or duplicate the
   terminal state; a task completed between enqueue and drain sends NOTHING
   (suppression re-checks current authority); with no provider at all the
   drain keeps its visible `configuration` failure instead of a fake success.

## 4. The local interactive workbench

`https://.../demo-workbench/?lang=en` (also `?lang=fa`) — a static,
no-install capability showcase: 28 synthetic horses, pedigree comparisons,
sale listings, professionals, local-only inquiries/reminders/shortlists and
the business-model calculator (`/business-model/`). All interactions are
local to the browser; no message, order, booking, payment or attestation is
executed. Use it when you want a zero-setup, offline-safe walkthrough.

## 5. Suggested 10-minute showcase script

1. **2 min — the registry**: search a horse, open its profile, walk the
   pedigree, open a person link; switch EN/FA.
2. **2 min — the five frontends**: open the launcher, show Heritage and one
   alternate visual (e.g. Classic Registry) on the SAME data — one platform,
   five independent experiences.
3. **2 min — trust surfaces**: a directory professional card with an honest
   credential badge (what was checked, by whom, against which evidence, when);
   show an UNVERIFIED credential failing closed the same way.
4. **3 min — the paid journey (§2)**: order → demo gateway page → settle →
   server-side verify → workspace in use → renewal extends. Say out loud:
   "the payment was simulated; the workflow is the real one."
5. **1 min — notification pipeline (§3)**: due-task reminder → accepted (not
   delivered) → signed callback → delivered, with the operator inbox.

## 6. Boundaries (say these during the demo)

- The demo gateway is a free placeholder: no real money can move; a real
  merchant account + owner approval are still required for live charges.
- Demo entitlements are real rows, but always `provider='demo'` — they can be
  distinguished from any future real charge forever.
- The demo email provider records — never transmits. A real provider account
  is still required for actual delivery.
- SMS (login OTP) is deliberately NOT simulated and stays unavailable.
- The workbench is a separate capability showcase; it does not prove that
  every workflow is integrated into all five frontends (that is the N12-N22
  frontend journey work, still open).
