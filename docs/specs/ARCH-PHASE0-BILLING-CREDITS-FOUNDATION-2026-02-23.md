# Phase 0 Architecture Package: Billing Plans + Credits Foundation

- **Document ID:** ARCH-PHASE0-BILLING-CREDITS-FOUNDATION-2026-02-23
- **Issue:** #57
- **Date:** 2026-02-23
- **Status:** Ready for implementation handoff (Phase #58 / #59)
- **Aligned with:**
  - `docs/specs/PRD-BILLING-PLANS-CREDITS-2026-02-23.md`
  - `docs/specs/SPEC-SUBSCRIPTION-MANAGEMENT-UI-2026-02-23.md`
  - `docs/specs/DECISION-CLERK-VS-STRIPE-SUBSCRIPTIONS-2026-02-23.md` (**GO Hybrid**)

---

## 1) Scope and outcome (Phase 0)

This document defines the **implementation foundation** only:

1. Canonical domain model for plans/subscriptions/entitlements/credits/ledger
2. Idempotency + reconciliation architecture details
3. Rollout flags + kill-switch semantics
4. Draft API surface for upcoming implementation phases

No broad runtime implementation is included in this phase.

---

## 2) Canonical domain model

## 2.1 Bounded contexts

1. **Catalog & Entitlements**
   - Plan definitions and entitlement policy versions.
2. **Subscription Authority Adapter**
   - Clerk-first authority now; Stripe-compatible abstraction later.
3. **Credit Wallet & Ledger**
   - Immutable transaction ledger + derived balances.
4. **Metering & Settlement**
   - Estimate/reserve/capture/release based on model/versioned cost rules.
5. **Reconciliation & Audit**
   - Cross-system consistency checks and repair workflows.

## 2.2 Canonical entities

### `BillingAccount`
- Internal canonical owner for billing relationships.
- Keys:
  - `id` (internal primary key)
  - `owner_type` (`user` | `workspace`)
  - `owner_id` (internal user/workspace id)
- External refs:
  - `clerk_customer_id` (nullable)
  - `stripe_customer_id` (nullable, future)

### `Plan`
- Commercial package definition (Free/Starter/Pro/Team).
- Keys:
  - `id`, `plan_code`, `display_name`, `billing_interval`
  - `price_minor`, `currency`, `active`

### `EntitlementPolicy`
- Versioned policy payload consumed at request admission.
- Keys:
  - `id`, `plan_id`, `version`, `effective_from`, `effective_to`
- Policy fields (examples):
  - `max_concurrent_jobs`
  - `allowed_model_tiers`
  - `max_output_resolution`
  - `max_video_duration_seconds`
  - `overage_allowed`, `overage_soft_cap_credits`, `overage_hard_cap_credits`

### `Subscription`
- Canonical normalized subscription read model (provider-agnostic).
- Keys:
  - `id`, `billing_account_id`, `plan_id`
  - `authority` (`clerk` | `stripe`)
  - `authority_subscription_id` (external ref)
  - `status` (`trialing` | `active` | `past_due` | `canceled` | `expired`)
  - `current_period_start`, `current_period_end`
  - `cancel_at_period_end`

### `SubscriptionCycleGrant`
- Represents monthly credit allocation per cycle.
- Keys:
  - `id`, `subscription_id`, `cycle_start`, `cycle_end`
  - `granted_credits`, `grant_ledger_txn_id`
  - unique: `(subscription_id, cycle_start, cycle_end)`

### `CreditBucket`
- Logical bucket with independent expiry semantics.
- Bucket types:
  - `promo`, `subscription`, `topup`, `adjustment`, `overage`
- Keys:
  - `id`, `billing_account_id`, `bucket_type`, `expires_at` (nullable)

### `CreditLedgerEntry`
- Immutable source of truth for credit movement.
- Keys:
  - `id` (ULID)
  - `billing_account_id`
  - `txn_type` (`grant`, `reserve`, `capture`, `release`, `refund`, `reversal`, `adjustment`)
  - `amount_credits` (signed integer)
  - `currency` (`CR` logical credit currency)
  - `idempotency_key`
  - `reference_type`, `reference_id`
  - `occurred_at`, `created_at`
- Invariants:
  - never update/delete rows
  - same `idempotency_key` + `reference_type` + `reference_id` returns original row

### `CreditReservation`
- Explicit reservation lifecycle for long/async generation jobs.
- Keys:
  - `id`, `billing_account_id`, `job_id`
  - `reserved_credits`, `captured_credits`, `released_credits`
  - `status` (`active` | `captured` | `released` | `expired`)
  - `expires_at`

### `PricingVersion` + `CostRule`
- Versioned cost model for deterministic replay.
- Keys:
  - `pricing_version_id`, `effective_from`, `effective_to`
  - `cost_rule_id`, `provider`, `operation_type`, `model_id/model_family`, tiers

### `ExternalBillingEvent`
- Raw webhook/event ingest envelope for subscription/payment systems.
- Keys:
  - `id`, `authority`, `event_type`, `authority_event_id`, `payload_hash`
  - `received_at`, `processed_at`, `status`, `error_code`
- unique: `(authority, authority_event_id)`

---

## 3) Canonical lifecycle flows

## 3.1 Monthly cycle grant flow

1. Receive normalized `subscription_cycle_started` event.
2. Upsert `Subscription` status/timestamps.
3. Create exactly one `SubscriptionCycleGrant` (idempotent uniqueness guard).
4. Write `CreditLedgerEntry(txn_type=grant)`.
5. Update read model balance snapshot.

## 3.2 Generation authorization flow

1. Resolve `BillingAccount` and active `EntitlementPolicy` snapshot.
2. Validate entitlements and kill-switch state.
3. Compute estimate using `PricingVersion + CostRule`.
4. Attempt reserve (`CreditLedgerEntry reserve` + `CreditReservation`).
5. Return authorization token containing `reservation_id` and pricing version refs.

## 3.3 Settlement flow

1. Receive provider completion callback with actual usage metadata.
2. Compute final charge with same pricing version unless explicit approved override.
3. Capture from reservation:
   - if actual <= reserved: capture actual, release delta
   - if actual > reserved: capture reserved + delta attempt (subject to policy)
4. Persist settlement event idempotently.

---

## 4) Idempotency design details

## 4.1 Idempotency key schema

Standard key template:

`{domain}:{operation}:{stable_subject_id}:{authority_event_or_request_id}:{version}`

Examples:
- `billing:grant:sub_123:clerk_evt_abc:v1`
- `credits:reserve:job_456:req_789:v1`
- `credits:settle:job_456:fal_cb_123:v1`

## 4.2 Storage and conflict handling

- Store idempotency keys in ledger/event tables with unique indexes.
- On duplicate key conflict:
  - return existing successful result when payload hash matches
  - mark as error when payload hash differs (`IDEMPOTENCY_PAYLOAD_MISMATCH`)

## 4.3 Exactly-once effect pattern

- At-least-once delivery from webhooks/queues is expected.
- Use transactional sequence:
  1) insert event envelope (unique external id)
  2) apply domain mutation(s) + ledger append
  3) mark envelope processed
- If failure after append but before mark processed, replay must detect prior mutation via idempotency key.

## 4.4 Replay safety rules

- Replaying the same external event must never create additional grants/charges.
- Replay only appends compensations when correction is needed (`reversal`, `adjustment`), never in-place edits.

---

## 5) Reconciliation design details

## 5.1 Required reconciliation jobs

1. **Subscription grants reconciliation** (hourly + daily)
   - Compare authority cycle events vs `SubscriptionCycleGrant` rows.
   - Repair action: emit missing grant command (idempotent).

2. **Generation settlement reconciliation** (near-real-time + daily)
   - Compare completed jobs vs reservation/capture/release closure.
   - Repair action: settle stale active reservations; release expired reservations.

3. **Invoice/payment reconciliation** (daily)
   - Compare payment failures/refunds vs overage/top-up and adjustment entries.
   - Repair action: append `refund`/`reversal` entries with audit reason code.

4. **Balance integrity reconciliation** (daily)
   - Rebuild derived balances from ledger append-only stream and compare snapshots.
   - Repair action: recalc snapshot table only (ledger unchanged).

## 5.2 Reconciliation state model

- Each job writes `reconciliation_run` with:
  - `run_id`, `job_name`, `window_start/end`, `status`, `mismatch_count`, `repair_count`
- Each mismatch writes `reconciliation_item` with:
  - deterministic `item_key`, severity, recommended action, action result

## 5.3 Severity classes

- `SEV-1`: money-impacting overcharge/undercharge leakage
- `SEV-2`: missing non-critical metadata or lagged status
- `SEV-3`: cosmetic/read-model drift only

---

## 6) Rollout flags + kill-switch semantics

## 6.1 Flag set (Phase 0 contract)

- `billing.enabled`
  - master switch for billing domain API enablement
- `billing.subscription_authority`
  - enum: `clerk` (default), `stripe` (future)
- `credits.metering.enabled`
  - enables estimate/reserve/capture path
- `credits.enforcement.mode`
  - `off` | `shadow` | `soft` | `hard`
- `credits.overage.enabled`
  - enables overage charging path
- `credits.topup.enabled`
  - enables top-up purchase + grant path
- `billing.reconciliation.repair_enabled`
  - when false, jobs report only (no automatic repair)

## 6.2 Kill switches (immediate stop controls)

- `killswitch.generation_admission.billing`
  - bypasses billing admission checks (emergency continuity)
- `killswitch.ledger.writes`
  - blocks new charge/grant writes except explicit admin emergency ops
- `killswitch.overage.charge`
  - disables overage charge attempts; forces graceful denial
- `killswitch.webhooks.ingest`
  - pauses external billing event processing

## 6.3 Semantic contract

- Kill switches are **fail-safe and explicit**:
  - write operation must check kill switches synchronously
  - returned reason codes are machine-readable
- Shadow mode (`credits.enforcement.mode=shadow`):
  - compute full metering and ledger simulation signals
  - do not block generation or charge users
- Hard mode:
  - enforce entitlements and balance sufficiency before job admission

## 6.4 Observability requirements for flags

- Emit structured log event on every flag evaluation:
  - `flag_name`, `value`, `context`, `request_id`
- Emit audit event for every flag change:
  - actor, previous value, new value, justification, timestamp

---

## 7) API surface draft (for Phase #58 / #59)

> API naming is draft-level and provider-agnostic. Final routing can be REST or RPC with same contracts.

## 7.1 Catalog and entitlements

- `GET /api/billing/plans`
- `GET /api/billing/entitlements` (current caller/account resolved)
- `GET /api/billing/usage/summary`

## 7.2 Subscription lifecycle (authority abstraction)

- `GET /api/billing/subscription`
- `POST /api/billing/subscription/change-plan`
- `POST /api/billing/subscription/cancel`
- `POST /api/billing/subscription/resume`
- `POST /api/billing/webhooks/{authority}` (internal ingress)

## 7.3 Credits operations

- `GET /api/credits/balance`
- `GET /api/credits/ledger?cursor=...`
- `POST /api/credits/authorize` (estimate + reserve)
- `POST /api/credits/settle` (capture/release)
- `POST /api/credits/release` (cancel/timeout path)
- `POST /api/credits/admin/adjust` (privileged)

## 7.4 Metering + pricing ops (internal/admin)

- `GET /api/internal/pricing/versions`
- `POST /api/internal/pricing/versions`
- `POST /api/internal/pricing/versions/{id}/activate`
- `POST /api/internal/reconciliation/run`

## 7.5 Settings UI support endpoints

- `GET /api/settings/billing/overview`
- `GET /api/settings/billing/invoices`
- `POST /api/settings/billing/payment-method/session`

---

## 8) Security, audit, and compliance baseline

- All financial mutations require authenticated principal + role checks.
- Admin adjustments require reason code + immutable audit entry.
- Ledger entries are append-only; corrections are compensating entries.
- Every external event stores payload hash for dispute/replay diagnostics.

---

## 9) Phase handoff checklist (ready criteria)

Phase #58 / #59 can proceed when:

- [x] Canonical entities and invariants are agreed
- [x] Idempotency key schema + conflict semantics are defined
- [x] Reconciliation job matrix and repair policy are defined
- [x] Rollout flags and kill-switch semantics are defined
- [x] API draft list exists for implementation planning
- [x] Provider abstraction boundary reflects **GO Hybrid** decision
