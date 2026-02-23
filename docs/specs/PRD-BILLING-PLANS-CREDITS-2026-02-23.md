# PRD: Billing Plans + Credit Metering System (Cost-Tied Generation)

- **Document ID:** PRD-BILLING-PLANS-CREDITS-2026-02-23
- **Project:** `spaces-clone`
- **Date:** 2026-02-23
- **Owner:** Product + Platform Engineering
- **Status:** Draft for execution planning
- **Scope:** Product and technical requirements only (no implementation code)

---

## 0) Executive Summary

This PRD defines a production-grade billing and credit metering system for image/video generation, where user credit burn is tied to provider cost (with explicit FAL dependency support). The system introduces:

1. Subscription plans with clear entitlements and monthly credit allocation.
2. A configurable metering engine for generation requests (image/video) based on model, parameters, and runtime factors.
3. A cost-model layer to map provider spend (USD) to platform credits via margin policies and safety buffers.
4. An immutable credit ledger with idempotent accounting, reconciliation, and auditable adjustments.
5. Billing + identity integration flows (Clerk + payment provider webhooks).
6. Operational controls for failure handling, fraud prevention, migration, observability, and compliance.

The design is execution-ready and phased to reduce rollout risk.

---

## 1) Product Requirements

### 1.1 Goals

- Monetize generation usage through transparent credit-based plans.
- Keep gross margin predictable despite provider pricing volatility.
- Ensure credit accounting correctness (no double charge/no free usage leaks).
- Maintain user trust with clear balances, statements, and reversals.

### 1.2 Non-Goals

- Building a new payment processor.
- Supporting every provider at launch (FAL-first, extensible for others).
- Token-level metering for LLM chat (out of scope for this PRD).

### 1.3 Personas

- **Free user:** explores platform with limited monthly credits.
- **Pro creator:** recurring monthly usage with overage enabled.
- **Studio/team admin:** higher quota, advanced models, seats, invoice billing (phase 2+).
- **Internal admin/finance/ops:** monitors costs, applies manual adjustments, handles disputes.

### 1.4 Plan Catalog (Initial)

> Values below are placeholders; finance/product finalize before launch.

| Plan | Monthly Price | Included Monthly Credits | Overage | Key Entitlements |
|---|---:|---:|---|---|
| Free | $0 | 100 | Not allowed | Standard models, watermark, low concurrency |
| Starter | $19 | 2,500 | Optional pay-as-you-go | HD image, standard video, priority queue |
| Pro | $49 | 8,000 | Enabled by default (cap-controlled) | Premium models, faster queue, higher concurrency |
| Team | $199 | 40,000 shared | Enabled + invoicing option | Shared workspace quota, admin controls, SSO (phase 2) |

### 1.5 Entitlements Model

Each plan maps to entitlements enforced at request admission:

- `max_concurrent_jobs`
- `allowed_model_tiers` (e.g., standard/premium/experimental)
- `max_output_resolution`
- `max_video_duration_seconds`
- `priority_queue_level`
- `watermark_required` (bool)
- `overage_allowed` (bool)
- `overage_soft_cap_credits`
- `overage_hard_cap_credits`

### 1.6 Monthly Credit Buckets

Credit buckets are tracked separately for clarity and accounting:

1. **Subscription bucket** (monthly, expires at cycle end, non-rollover by default)
2. **Top-up bucket** (purchased packs, optional expiration e.g., 12 months)
3. **Promo bucket** (grant-based, shortest expiry)
4. **Adjustment bucket** (manual corrections)

**Deduction order (default):** Promo → Subscription → Top-up → Overage.

### 1.7 Overage Policy

- Overage is only enabled for eligible paid plans.
- Overage can be billed as:
  - **A)** Immediate metered charges (usage records), or
  - **B)** Auto-purchase top-up packs when below threshold.
- Must enforce:
  - soft warning threshold (e.g., 80% overage cap)
  - hard stop threshold (no further generation until next cycle/top-up/payment method fixed)

### 1.8 UX/Product Transparency Requirements

- Show estimated credit cost before generation.
- Show final charged credits after completion.
- Show reason codes for adjustments/refunds.
- Downloadable usage statement by date range.

---

## 2) Metering Model (Image/Video)

### 2.1 Metering Principles

- Metering is request-centric with deterministic cost estimation inputs.
- Final charge can differ from estimate only under predefined conditions (e.g., provider-reported actual duration/output frames).
- Cost tables are versioned and time-effective.

### 2.2 Metered Unit Definitions

- **Image generation:** per request with multipliers for resolution, batch size, and model tier.
- **Video generation:** per second (or per frame equivalent), adjusted by resolution, fps tier, and model tier.

### 2.3 Configurable Credit Cost Table (Versioned)

Cost table keyed by:

- `provider` (e.g., `fal`)
- `model_id` / `model_family`
- `operation_type` (`image.generate`, `video.generate`, `upscale`, `variation`, etc.)
- `input/output attributes` (resolution tier, duration tier, quality tier)
- `effective_from` / `effective_to`

Example conceptual entries:

| Operation | Model Tier | Base Credits | Multipliers |
|---|---|---:|---|
| image.generate | standard | 8 | resolution (1x/1.5x/2x), batch_size |
| image.generate | premium | 14 | resolution, batch_size |
| video.generate | standard | 20 / sec | resolution tier, fps tier |
| video.generate | premium | 35 / sec | resolution tier, fps tier |

### 2.4 Estimation vs Settlement

- **Pre-charge estimate:** computed at admission; optionally reserve credits.
- **Settlement charge:** computed after provider callback with actual usage metadata.
- If settlement < reserve: release difference.
- If settlement > reserve: charge delta if available; otherwise enforce debt/failed-settlement policy.

### 2.5 Reservation Strategy

- For long-running jobs (video), reserve worst-case estimate (bounded by user-selected params).
- Reservation TTL with automatic release on timeout/cancel.
- Prevents balance race conditions under concurrency.

### 2.6 Versioning and Reproducibility

- Every charge references `pricing_version_id` and `cost_rule_id`.
- Historical invoice/ledger replay must produce identical credits from stored parameters + version snapshots.

---

## 3) Cost Model Layer (Provider Spend → Credits)

### 3.1 Inputs

- Provider list price (USD) from FAL/model catalog (manual import or API feed).
- Contract modifiers (discounts/commits where applicable).
- Infra overhead factor (storage/egress/retries).
- Target gross margin policy by plan or global.

### 3.2 Transformation Formula (Policy-Level)

Conceptual pipeline:

1. `effective_provider_cost_usd = base_provider_cost_usd * provider_multiplier`
2. `fully_loaded_cost_usd = effective_provider_cost_usd + overhead_buffer_usd`
3. `target_sell_usd = fully_loaded_cost_usd / (1 - target_margin_pct)`
4. `credits = ceil_to_policy(target_sell_usd * credits_per_usd)`

### 3.3 Margin Policy

- Default margin floor (e.g., 60%) for premium video ops.
- Margin bands by operation/model tier.
- Safety override: minimum credits per operation regardless of low provider cost.

### 3.4 Rounding Rules

- Always round user charge up to nearest policy step (e.g., 1 credit or 5 credits).
- Internal cost tracking keeps high precision decimals.
- Rounding strategy must be consistent and documented in customer-facing FAQ.

### 3.5 Safety Buffers

- **Volatility buffer:** +X% for provider price changes between sync windows.
- **Retry buffer:** expected retry rate per operation class.
- **FX buffer:** if non-USD billing rails are introduced.

### 3.6 Price Update Governance

- Cost model updates require:
  - finance approval
  - staged rollout (shadow compute first)
  - effective timestamp
- No retroactive repricing of completed transactions.

---

## 4) Ledger Design (Immutable, Idempotent, Reconciliable)

### 4.1 Ledger Principles

- Immutable append-only transaction records.
- Double-entry style logical consistency (debit/credit sources and sinks explicit).
- Idempotent write semantics for all external-event-driven mutations.

### 4.2 Core Transaction Types

- `credit_grant_subscription`
- `credit_grant_topup`
- `credit_grant_promo`
- `credit_reserve`
- `credit_capture` (final charge)
- `credit_release`
- `credit_refund`
- `credit_reversal`
- `credit_adjustment_admin`
- `debt_recorded` (if negative settlement policy allowed)

### 4.3 Required Ledger Fields

- `ledger_txn_id` (immutable unique)
- `account_id` / `workspace_id`
- `txn_type`
- `amount_credits` (+/-)
- `currency_context` (credits only for ledger, with USD shadow fields optional)
- `balance_after` (materialized optional, authoritative via replay)
- `reference_type` (job, invoice, webhook, manual)
- `reference_id`
- `idempotency_key`
- `pricing_version_id`
- `created_at`, `created_by`
- `metadata_json` (provider/model params snapshot)

### 4.4 Idempotency Keys

Deterministic keying examples:

- Provider completion event: `provider:{provider_job_id}:capture:v1`
- Webhook invoice paid: `billing:{invoice_id}:grant:v1`
- Admin adjustment: `admin:{ticket_id}:{seq}`

Unique constraint on idempotency key prevents duplicates.

### 4.5 Reconciliation Requirements

Daily jobs:

1. Compare provider-reported completed jobs vs internal captured charges.
2. Compare billing provider paid invoices vs credit grants.
3. Detect orphan reservations older than TTL.
4. Produce discrepancy report with severity and auto-remediation recommendations.

### 4.6 Balance Read Model

- Authoritative source: ledger replay.
- Performance source: balance snapshot table/materialized view updated transactionally.
- Snapshot drift detector must validate replay parity periodically.

---

## 5) API Contracts + Webhook Flows (Clerk + Billing Provider)

### 5.1 Identity (Clerk) Integration Requirements

Events consumed:

- `user.created`
- `organization.created` / `membership.updated` (if team plans)
- `user.deleted` / `organization.deleted`

Outcomes:

- Provision billing account record.
- Map Clerk user/org IDs to billing account/workspace IDs.
- Enforce ownership for plan management operations.

### 5.2 Billing Provider Event Flows (e.g., Stripe/Paddle)

Required inbound webhook event categories:

- Subscription lifecycle: created/updated/canceled/paused/resumed
- Invoice lifecycle: finalized/paid/payment_failed/voided
- Checkout success/failure
- Refund/dispute/chargeback

### 5.3 Canonical Internal API Endpoints (Contract-Level)

#### Plan & Billing
- `GET /v1/billing/plans` → available plan catalog + entitlements
- `GET /v1/billing/subscription` → active subscription state
- `POST /v1/billing/checkout-session` → initiate upgrade/top-up purchase
- `POST /v1/billing/portal-session` → self-serve billing portal

#### Credits & Usage
- `GET /v1/credits/balance` → bucketized current balances + pending reservations
- `GET /v1/credits/ledger?cursor=...` → transaction history
- `POST /v1/generation/estimate` → estimated credits for request payload
- `POST /v1/generation/authorize` → reserve/validate credits before provider submit
- `POST /v1/generation/settle` (internal/system) → capture/release after provider callback

#### Admin
- `POST /v1/admin/credits/adjust` → manual grant/debit with reason
- `POST /v1/admin/pricing-versions` → create/activate pricing table version

### 5.4 Event Processing Contracts

- All webhook endpoints must ack quickly and process asynchronously.
- Store raw webhook payload + signature verification result.
- Idempotent consumer per `event_id` + per business idempotency key.
- Dead-letter queue for repeated failures with operator workflow.

### 5.5 Sequence Example: Monthly Renewal

1. Billing provider invoices and charges customer.
2. `invoice.paid` webhook received.
3. System verifies signature, records event, enqueues job.
4. Worker applies monthly credit grant transaction.
5. Subscription cycle counters reset; usage dashboard updates.
6. Confirmation event emitted for analytics and audit.

---

## 6) Failure Handling

### 6.1 Timeout Scenarios

- Provider job accepted but callback delayed/lost.
- Billing webhook delivery delayed.

Policy:

- Keep reservation until timeout window; mark as `pending_settlement`.
- Periodic fetch/reconcile from provider API for stale pending jobs.
- Release or settle based on eventual provider status.

### 6.2 Duplicate Webhooks

- Deduplicate by provider `event_id` and business idempotency key.
- Duplicate delivery returns 2xx with no side effects.

### 6.3 Partial Failures

Examples:

- Generation succeeded but capture failed due DB outage.
- Capture succeeded but notification failed.

Policy:

- Transactional outbox for state change + event publish.
- Retry with exponential backoff.
- Human-visible incident queue for unresolved inconsistencies.

### 6.4 Refunds and Reversals

- If user charged credits for failed generation:
  - issue `credit_refund` referencing original capture txn.
- If payment is refunded/chargeback:
  - reverse previously granted credits (or create debt if already consumed).
- Maintain immutable link chain: original txn ↔ reversal/refund txn.

### 6.5 Negative Balance / Debt Policy

- Allowed only for paid plans with verified payment method.
- Debt threshold beyond which generation is blocked.
- Auto-recovery on next payment/top-up.

---

## 7) Abuse/Fraud Guardrails + Rate Limits

### 7.1 Threat Model

- Card testing and disposable-account abuse.
- Promo exploitation (multi-account farming).
- Automated high-volume generation to drain included credits/probe edge cases.
- Webhook replay attacks.

### 7.2 Guardrails

- Verified email/payment method required for overage and high-cost models.
- Velocity limits by user, workspace, IP, device fingerprint.
- Risk scoring input from failed payments, chargebacks, suspicious geography shifts.
- Promo grants gated by anti-abuse heuristics.

### 7.3 Rate Limits (Policy Examples)

- Free: low QPS, low concurrent jobs, strict daily cap.
- Paid: higher QPS, concurrency by plan.
- Dynamic throttling when fraud score rises.

### 7.4 Security Controls

- Webhook signature verification mandatory.
- Replay protection via nonce/timestamp windows.
- Secrets in managed vault; strict key rotation.

---

## 8) Admin Controls

### 8.1 Required Admin Actions

- Manual credit grant/debit with reason code and notes.
- Force release stuck reservations.
- Retry settlement/reconciliation for a job.
- Adjust overage caps for specific account.
- Suspend billing account or generation access.

### 8.2 Governance

- Role-based access: Support, Finance, Risk, SuperAdmin.
- Two-person approval for high-value adjustments above threshold.
- Immutable admin action audit logs (who, what, why, before/after).

### 8.3 Admin UX Requirements

- Unified account timeline: subscription events + ledger + generation jobs.
- One-click export for disputes.
- Guardrails against accidental duplicate adjustments.

---

## 9) Migration Strategy (No-Credits → Credits Enabled)

### 9.1 Migration Goals

- Avoid user disruption and billing shocks.
- Preserve trust via transparent communication and grace periods.
- Validate economics before hard enforcement.

### 9.2 Phased Migration

1. **Shadow Metering (read-only):** compute credits silently for all generations.
2. **Visible Metering (no enforcement):** show estimated/actual credits in UI; no blocking.
3. **Soft Enforcement:** enforce only on high-cost operations and new users.
4. **Full Enforcement:** all users/plans subject to credit authorization.

### 9.3 Legacy User Handling

- Grant one-time migration credit package based on historical usage bands.
- 30-day grace window for existing active users.
- Explicit in-product notices + email timeline.

### 9.4 Data Backfill

- Backfill historical generation jobs into analytics usage tables (not ledger unless needed).
- Start ledger at cutover point with opening balances.

### 9.5 Rollback Plan

- Kill switch to disable enforcement while retaining metering telemetry.
- Preserve all captured telemetry for postmortem and repricing.

---

## 10) Observability (Dashboards, Alerts, Audit Logs)

### 10.1 Core Dashboards

- **Business:** MRR, credit burn by plan, overage revenue, ARPU.
- **Cost:** provider spend (FAL) vs credited usage, gross margin by operation/model.
- **Ledger health:** txn throughput, idempotency collisions, reconciliation mismatch rate.
- **Ops:** webhook latency/failure, pending settlements aging, refund rate.
- **Risk:** fraud score distribution, chargeback rate, blocked generation attempts.

### 10.2 Alerts (Initial SLOs)

- Reconciliation mismatch > 0.5% of daily txns (critical).
- Provider cost-to-credit margin drops below floor for any major model (critical).
- Webhook failure rate > 2% over 15 min (high).
- Stuck reservations > threshold count/age (high).
- Duplicate capture attempts detected above baseline (medium).

### 10.3 Audit Logs

Must capture:

- Plan changes, entitlement overrides.
- All ledger mutations including actor context.
- Pricing table version activations.
- Admin tool actions with ticket references.

Retention policy aligned to compliance requirements (e.g., 24 months minimum).

---

## 11) Security + Compliance Considerations

### 11.1 Data Classification

- Billing PII and account identifiers: sensitive.
- Payment instrument data: never stored directly if using hosted provider tokenization.
- Ledger and audit data: integrity-critical records.

### 11.2 Compliance Baselines

- PCI scope minimization via hosted checkout + tokenized payment methods.
- GDPR/UK GDPR controls for user data rights (export/delete where legally allowed).
- Financial record retention obligations by jurisdiction.

### 11.3 Access and Integrity

- RBAC + least privilege for billing/ledger systems.
- Encryption in transit and at rest.
- Signed/hashed audit chains for tamper evidence (recommended).

### 11.4 Privacy and Data Minimization

- Avoid storing raw generation prompts in billing logs unless necessary.
- Store only metering parameters required for audit/replay.

---

## 12) Phased Rollout Plan, Risks, Go/No-Go

### 12.1 Rollout Phases

**Phase 0: Foundations (internal only)**
- Ledger, pricing versioning, webhook ingestion, basic dashboarding.

**Phase 1: Shadow Metering**
- Compute credits + projected margin without charging.
- Validate estimation error and model economics.

**Phase 2: Paid Plan Launch + Visible Credits**
- Subscription plans active, balances visible, top-up checkout live.

**Phase 3: Soft Enforcement**
- Credit authorization on selected expensive operations.

**Phase 4: Full Enforcement + Overage**
- End-to-end settlement/refund/reconciliation controls fully active.

### 12.2 Key Risks

- Provider pricing changes outpace table updates.
- Webhook outages causing delayed grants/settlement.
- Incorrect idempotency handling leading to double charge/refund.
- User backlash if migration communication is weak.

### 12.3 Mitigations

- Daily provider price sync + anomaly detection.
- Queue-backed webhook processing + DLQ tooling.
- Ledger invariants and reconciliation gates.
- Progressive rollout with cohorting and kill switches.

### 12.4 Go/No-Go Criteria

Go to full enforcement only if all are met for 14 consecutive days:

- Reconciliation mismatch < 0.1% of txns.
- Duplicate financial side effects = 0 sev-1 incidents.
- Gross margin at/above policy floor on top 90% spend operations.
- Support ticket rate for billing confusion below threshold.
- Refund/reversal automation success > 99%.

---

## 13) Open Questions + Assumptions

### 13.1 Open Questions

1. Which billing provider is final (Stripe/Paddle/other) and what regions/currencies at launch?
2. Exact FAL pricing source of truth: API endpoint, refresh cadence, and fallback if unavailable?
3. Should monthly subscription credits roll over partially for paid plans?
4. Overage model preference: direct metered billing vs auto top-up packs?
5. Are team/shared credits required at launch or phase 2?
6. Do refunds return credits, money, or both depending on scenario?
7. Is negative balance allowed for all paid tiers or only vetted accounts?
8. Required legal copy for pricing transparency and estimate disclaimers?

### 13.2 Assumptions

- Credits are a virtual unit with fixed internal conversion policy, not a stored-value wallet.
- FAL is primary generation provider at launch; system remains provider-agnostic in interfaces.
- Hosted payment pages are used to reduce PCI burden.
- Monthly billing cycle default; annual plans out of initial scope.
- Product can tolerate short eventual consistency windows for dashboard display, but not for ledger correctness.

---

## 14) Acceptance Criteria (PRD Sign-off)

This PRD is considered execution-ready when stakeholders (Product, Engineering, Finance, Risk, Support) agree that:

1. Plan catalog and entitlement matrix are finalized.
2. Pricing/margin policy and buffer values are approved.
3. Ledger transaction taxonomy and idempotency strategy are accepted.
4. Webhook contracts and failure handling runbooks are documented.
5. Migration messaging and grace policy are approved.
6. Phase gates and go/no-go metrics are baselined in dashboards.

---

## 15) Appendix A — Suggested Reason Codes

### Credit Adjustments
- `GOODWILL_CREDIT`
- `SLA_COMPENSATION`
- `BILLING_ERROR_CORRECTION`
- `PROMO_CAMPAIGN`
- `FRAUD_REVERSAL`

### Generation Settlement Outcomes
- `SETTLED_SUCCESS`
- `SETTLED_PARTIAL`
- `FAILED_PROVIDER`
- `FAILED_TIMEOUT`
- `CANCELLED_BY_USER`

---

## 16) Appendix B — Ledger Invariants

1. No ledger mutation without actor/system context.
2. Every capture must reference a prior authorization/reservation or explicit policy exception.
3. Sum of bucket balances must equal aggregate account balance snapshot.
4. Reversal/refund transactions must reference original txn IDs.
5. Idempotency key uniqueness is enforced globally (or by scoped namespace with strict rules).

---

## 17) Appendix C — Minimal Event Schema Requirements

For all billing/metering events:

- `event_id`
- `event_type`
- `occurred_at`
- `account_id`
- `workspace_id` (nullable for personal accounts)
- `source` (clerk/provider/internal)
- `idempotency_key`
- `payload_version`
- `payload`

This ensures replayability, compatibility, and audit readiness across evolutions.
