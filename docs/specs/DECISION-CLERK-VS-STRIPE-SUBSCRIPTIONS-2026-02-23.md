# Architecture Decision: Clerk-managed Subscriptions vs Direct Stripe Integration

- **Document ID:** DECISION-CLERK-VS-STRIPE-SUBSCRIPTIONS-2026-02-23
- **Date:** 2026-02-23
- **Project:** `spaces-clone`
- **Related docs:**
  - `docs/specs/PRD-BILLING-PLANS-CREDITS-2026-02-23.md`
  - `docs/specs/SPEC-SUBSCRIPTION-MANAGEMENT-UI-2026-02-23.md`
- **Decision type:** Near-term architecture decision for hosted roadmap (plans + credits metering)

---

## 0) Decision summary

We should **start with Clerk-managed subscriptions for v1** (to reduce implementation overhead and ship faster), while designing billing domain boundaries so we can **migrate to direct Stripe Billing** when advanced requirements become mandatory.

### Final verdict

## ✅ **GO Hybrid**

- **Now (0–90 days):** Clerk-managed subscriptions + internal credits ledger/metering.
- **Later (trigger-based):** Move subscription authority to direct Stripe when tax/VAT, multi-currency, advanced invoicing, or complex usage/contract pricing become launch-critical.

This gives the fastest path to market **without** locking the credits architecture to Clerk.

---

## 1) Capability comparison table (Clerk-managed vs direct Stripe)

> Notes: “Clerk-managed” means Clerk Billing as subscription system of record, with Stripe primarily as payment rail under Clerk. “Direct Stripe” means Stripe Billing is the subscription system of record.

| Capability Area | Clerk-managed subscriptions | Direct Stripe Billing integration |
|---|---|---|
| **Time-to-first-launch (plans + checkout + basic lifecycle)** | **Fastest**. Prebuilt pricing/profile components and subscription lifecycle handling in Clerk. | Slower. Requires designing products/prices/subscriptions/webhooks and app-side orchestration. |
| **Auth + entitlement coupling** | **Excellent** for this stack. Plan/feature checks close to Clerk auth model (`has()`/protect checks). | Good but custom mapping required (Stripe customer/subscription ↔ Clerk user/org/workspace). |
| **Subscription lifecycle events** | Good for common SaaS flows (create/upgrade/downgrade/cancel). | **Best-in-class**, deep event model and long-term flexibility. |
| **Billing flexibility (tiers, hybrids, enterprise contracts)** | Moderate. Good for common SaaS plans, less flexible for complex bespoke contracts. | **High**. Rich primitives for tiered, metered, negotiated, and hybrid models. |
| **Usage-based/overage billing sophistication** | Limited compared to direct Stripe feature depth. Better to keep usage metering internal anyway. | **Strong** for advanced usage-based billing workflows and contract complexity. |
| **Tax/VAT handling** | Current limitations (per Clerk docs: no built-in tax/VAT in current state). | **Strong** ecosystem and products for tax/compliance workflows. |
| **Currency coverage** | Current Clerk docs indicate USD-only billing in current state. | Broad multi-currency/global support. |
| **Refund workflow** | Clerk docs indicate refunds are performed in Stripe and are not fully reflected in Clerk billing metrics. | **Native** billing/refund lifecycle under one source of truth. |
| **3DS / advanced payment auth flows** | Clerk docs note limits on additional factor payment auth in current state. | **Stronger** support across payment auth scenarios. |
| **Vendor lock-in risk** | Medium (if business logic binds directly to Clerk billing states). | Lower lock-in to one app-layer auth vendor; Stripe is broadly portable billing backbone. |
| **Operational complexity** | **Lower** initially (fewer moving parts). | Higher initially (more systems/webhooks/data mapping to maintain). |
| **Best fit for current roadmap** | **Good fit for fast v1** subscriptions + credit grants. | Better fit once finance/compliance complexity increases. |

---

## 2) Engineering overhead analysis (implementation + operations)

## 2.1 Clerk-managed (v1 speed path)

### Implementation overhead
- Lower integration complexity in app layer.
- Faster UI integration with existing Clerk-auth-centered settings model.
- Fewer initial billing domain objects to build/maintain.
- Can focus engineering effort on the harder part: **credits metering + ledger correctness**.

### Operational overhead
- Fewer webhook classes and reconciliation streams in v1.
- Simpler incident surface area.
- Lower ongoing maintenance for subscription UX and customer self-serve lifecycle.

### Hidden costs
- Potential rework when requirements outgrow Clerk Billing constraints.
- Migration planning needed to avoid tight coupling of credits logic to Clerk-specific subscription state.

## 2.2 Direct Stripe (flexibility path)

### Implementation overhead
- Build and maintain:
  - Stripe product/price/subscription modeling
  - Checkout and customer portal orchestration
  - Webhook ingestion/retries/idempotency handling
  - Mapping layer from Stripe identities to Clerk user/org/workspace
- More backend and QA surface before first launch.

### Operational overhead
- More operational playbooks (invoice failures, disputes, payment method state, dunning).
- More observability work and on-call runbooks from day one.

### Payoff
- Better long-term control over pricing experimentation, international billing, invoicing depth, and enterprise billing patterns.

## 2.3 Practical conclusion on overhead

Given Aman’s concern (“direct Stripe may add overhead”) and current roadmap scope, **Clerk-first is materially lower effort to ship in 90 days**.

---

## 3) Limits and risks by option

## 3.1 Clerk-managed risks

1. **Billing flexibility ceiling**
   - Complex pricing experiments (advanced usage contracts, nuanced enterprise structures) may hit limits sooner.

2. **Tax/invoicing constraints**
   - Current Clerk docs indicate no native tax/VAT support in present state.
   - Refund handling/metrics split across systems can complicate finance reporting.

3. **Global coverage limits**
   - Current docs indicate USD-first limitations; may block international go-to-market patterns.

4. **Webhook and reconciliation split**
   - You still need robust internal ledgers for credits; Clerk reduces but does not remove finance-grade reconciliation needs.

5. **Beta/experimental risk**
   - Clerk Billing APIs are documented as beta/experimental, implying potential change risk.

## 3.2 Direct Stripe risks

1. **Higher delivery risk in near term**
   - More integration work can delay launch of monetization and credits rollout.

2. **More operational burden now**
   - Webhooks, disputes, dunning, retries, and accounting flows need mature handling earlier.

3. **Scope creep risk**
   - Team may spend cycles building billing infrastructure instead of core generation metering correctness and UX.

4. **Complexity in auth/billing boundaries**
   - Must maintain clean identity and permission mapping between Clerk + Stripe + workspace model.

---

## 4) Impact on planned credits system architecture

The PRD’s credit system (metering engine + immutable ledger + reconciliation) should remain **provider-agnostic** and independent from subscription vendor.

### Architecture impact if Clerk-first

- Treat subscription events as **credit grant triggers** only.
- Keep canonical credit logic in internal domain:
  - `authorize` (reserve)
  - `settle` (capture/release)
  - ledger idempotency
  - reconciliation
- Do **not** encode Clerk plan identifiers deeply in generation logic.
- Introduce stable internal concepts now:
  - `BillingAccount`
  - `PlanEntitlementSnapshot`
  - `SubscriptionCycleGrant`
  - `ExternalBillingEvent`

### Why this matters

If credits are internal and deterministic (as PRD intends), switching subscription authority later (Clerk → Stripe) mostly changes **event ingress and mapping**, not metering math or ledger invariants.

---

## 5) Recommended decision now + 90-day path

## 5.1 Recommended now

Use **Clerk-managed subscriptions** for initial launch scope while implementing a **strict billing adapter boundary**.

## 5.2 90-day execution path

### Days 0–30 (Foundation)
- Finalize plan catalog + entitlements.
- Implement billing provider adapter interface (even if only Clerk implementation is active).
- Build credits ledger + idempotency + reservation/capture/release lifecycle.
- Wire Clerk subscription lifecycle events to monthly credit grants.

### Days 31–60 (Visible rollout)
- Launch billing settings UX and lifecycle states per existing spec.
- Enable visible balances + usage statements.
- Run reconciliation jobs (invoice/payment events ↔ credit grants; generation jobs ↔ captures).
- Shadow overage calculations before charging.

### Days 61–90 (Enforcement + readiness)
- Soft enforce credits on expensive operations.
- Establish migration readiness artifacts:
  - canonical internal billing event schema
  - event replay tooling
  - crosswalk table for external subscription identifiers
- Define Stripe cutover triggers and run a tabletop migration drill.

### Cutover triggers (if any are true)
- Need tax/VAT support for launch regions.
- Need non-USD billing in production.
- Need advanced invoice/revenue workflows beyond Clerk capability.
- Need enterprise/contract pricing beyond Clerk model.

---

## 6) Migration / escape hatch (Clerk now → Stripe later)

## 6.1 Non-negotiable design rules now

1. **Internal billing abstraction layer**
   - `BillingProviderAdapter` with normalized operations/events.
2. **No Clerk IDs as primary business keys**
   - Store Clerk IDs as external references; use internal billing account IDs for ledger relations.
3. **Canonical internal event model**
   - Normalize `subscription_created|updated|canceled`, `invoice_paid|failed`, `refund` events independent of source.
4. **Entitlement snapshots**
   - Materialize plan entitlements in internal records consumed by generation admission checks.

## 6.2 Migration steps

1. Run Stripe integration in shadow mode while Clerk remains active authority.
2. Build account mapping: `workspace/user ↔ stripe_customer_id`.
3. Compare lifecycle parity for one full billing cycle (no customer-facing changes).
4. Freeze new plan changes briefly during cutover window.
5. Switch authority flag to Stripe for new and renewing subscriptions.
6. Keep Clerk event ingestion read-only for rollback period.
7. Validate reconciliation and support ticket impact; then deprecate old pathway.

## 6.3 Rollback plan

- Feature flag to restore Clerk as authority within one cycle if parity breaks.
- Preserve immutable credits ledger; never rewrite historical credit transactions.
- Replay canonical events to rebuild entitlement read models if needed.

---

## 7) Final recommendation

For `spaces-clone` current priorities (ship subscriptions + credits metering with low overhead), the best decision is:

## ✅ **GO Hybrid**

- **Primary path now:** Clerk-managed subscriptions (speed + lower engineering/ops overhead).
- **Strategic guardrail:** keep credits ledger/metering and billing domain provider-agnostic from day one.
- **Planned evolution:** migrate subscription authority to direct Stripe only when clear trigger conditions are met.

This maximizes delivery speed now while preserving long-term billing flexibility and reducing migration risk later.
