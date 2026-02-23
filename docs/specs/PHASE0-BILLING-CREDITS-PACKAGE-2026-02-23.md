# Phase 0 Package Index: Billing + Credits Foundation

- **Issue:** #57
- **Date:** 2026-02-23
- **Purpose:** Single-entry index for Phase 0 architecture artifacts

## Included artifacts

1. Product requirements baseline
   - `PRD-BILLING-PLANS-CREDITS-2026-02-23.md`
2. Billing settings UI specification baseline
   - `SPEC-SUBSCRIPTION-MANAGEMENT-UI-2026-02-23.md`
3. Subscription authority decision record
   - `DECISION-CLERK-VS-STRIPE-SUBSCRIPTIONS-2026-02-23.md` (**GO Hybrid**)
4. Phase 0 architecture foundation (canonical model + idempotency/reconciliation/flags/api)
   - `ARCH-PHASE0-BILLING-CREDITS-FOUNDATION-2026-02-23.md`
5. Schema and ERD draft + migration sequencing
   - `SCHEMA-DRAFT-BILLING-CREDITS-PHASE0-2026-02-23.md`

## Ready-for-build outcomes

- Canonical billing + credits domain language is defined.
- Idempotency and reconciliation contracts are implementation-ready.
- Rollout safety model (flags + kill switches) is explicit.
- API draft list exists for Phase #58/#59 execution planning.

## Explicit non-goals for this package

- No broad production code changes.
- No payment provider cutover implementation.
- No final endpoint transport/auth wiring.
