# QA Report — Billing/Credits Phases #57–#63

**Date:** 2026-02-23  
**Repo:** `/Users/amanrawat/Desktop/work_2026/spaces-clone`  
**Branch:** `feat/billing-credits-phase0-foundation-2026-02-23`  
**Scope:** #57 docs consistency, #58 billing UI/gating, #59 ledger invariants, #60 pricing/metering, #61 subscription+webhooks, #62 enforcement modes, #63 admin/reconciliation/observability, caveat fixes validation.

---

## Executive Verdict

# **FAIL**

Release is **not QA-pass** for billing foundation due to two **SEV-1** defects:

1. **Critical billing APIs throw 500** (`Transaction function cannot return a promise`) on core credit/pricing paths in local SQLite runtime.
2. **Billing webhook endpoint is auth-blocked by middleware** unless dev-bypass header is present, which breaks real provider ingress.

There are also **SEV-2** product/consistency gaps (subscription grant path consistency + billing deep-link UX parity).

---

## What was executed

### Build/quality checks
- `npm run lint` ✅ (warnings only)  
  Evidence: `docs/screenshots/qa-billing-phases-57-63-2026-02-23/01-lint.txt`
- `npm run build` ✅  
  Evidence: `docs/screenshots/qa-billing-phases-57-63-2026-02-23/02-build.txt`
- Billing/auth targeted tests ✅ (18/18 pass):
  - `src/lib/billing/admin.test.ts`
  - `src/lib/billing/async-settlement.test.ts`
  - `src/lib/billing/invoices.test.ts`
  - `src/lib/billing/ledger.test.ts`
  - `src/lib/billing/pricing-math.test.ts`
  - `src/lib/billing/webhook-validation.test.ts`
  - `src/lib/auth/dev-bypass.test.ts`
  Evidence: `docs/screenshots/qa-billing-phases-57-63-2026-02-23/03-billing-tests.txt`

### Runtime/API smoke
- DB migration + isolated QA DB setup ✅  
  Evidence: `04-db-migrate.txt`
- Workspace bootstrap + owner/member state mutation ✅  
  Evidence: `05-bootstrap-owner.json`, `06-db-seed-state.txt`
- Billing/credits endpoint smoke executed (owner/member/admin/webhook) with captured HTTP transcripts ✅  
  Evidence: `07`–`57` files under evidence directory.

### Browser smoke
- Settings → Billing & Plans UI loaded in browser harness and correctly rendered error state when billing payload failed for that session context.  
  Evidence: `58-browser-settings-billing-error.png`

---

## Severity-tagged findings

## SEV-1 — F1: Core credit/pricing APIs return 500 due to async transaction callback usage

**Scope impact:** #59, #60, #62, #63 (ledger reserve/settle/release + pricing version management)

### Symptoms
- `POST /api/credits/authorize` → `500` with `{"error":"Transaction function cannot return a promise"}`
  - Evidence: `51-credits-authorize-success.http`
- `POST /api/credits/settle` → `500` same root cause
  - Evidence: `52-credits-settle-success.http`
- `POST /api/credits/release` → `500` same root cause (stack trace in dev logs)
  - Evidence: process log + `54-credits-release-success.http`
- `GET/POST /api/internal/pricing/versions` → `500` same root cause
  - Evidence: `42-pricing-versions-list.http`, `43-pricing-versions-create.http`

### Root cause (code audit)
Use of `db.transaction(async (tx) => {...})` against better-sqlite3 path, which rejects promise-returning transaction callbacks.

Key locations:
- `src/lib/billing/ledger.ts` (reserve/settle/release)
- `src/lib/billing/pricing.ts` (default seed)
- `src/app/api/internal/pricing/versions/route.ts`
- `src/app/api/internal/pricing/versions/[id]/activate/route.ts`

Discovery evidence list:
- `57-transaction-async-usage.txt`

### Repro steps
1. Run app with local sqlite DB.
2. Call `POST /api/credits/authorize` with valid workspace, jobId, idempotencyKey.
3. Observe HTTP 500 and message above.

### Expected vs Actual
- **Expected:** 200/402 with deterministic reserve behavior.
- **Actual:** 500 runtime exception, breaking billing flow.

---

## SEV-1 — F2: Billing webhook endpoint blocked by auth middleware (not publicly reachable)

**Scope impact:** #61 subscription lifecycle + webhook correctness

### Symptoms
- `POST /api/webhooks/billing/clerk` **without** dev bypass header returns `401 Unauthorized` before signature validation flow.
  - Evidence: `17-webhook-valid.http`
- Same signed payload **with** dev bypass header reaches handler and succeeds (`200`, dedupe works).
  - Evidence: `17b-webhook-valid-with-bypass.http`, `18b-webhook-replay-dedup-with-bypass.http`

### Root cause (code audit)
`src/middleware.ts` public route allowlist includes `/api/webhooks/clerk` but **does not include** `/api/webhooks/billing/clerk`.

### Security checks around webhook hardening
- Signature validation rejects invalid signature ✅ (`16-webhook-invalid-signature.http`)
- Replay-window timestamp protection rejects stale signed event ✅ (`19b-webhook-stale-with-bypass.http`)
- Idempotent replay handling works ✅ (`18b-webhook-replay-dedup-with-bypass.http`)

### Repro steps
1. Send validly signed payload to `/api/webhooks/billing/clerk` without auth/dev-bypass headers.
2. Receive 401 Unauthorized.

### Expected vs Actual
- **Expected:** webhook route publicly accessible, then signature/rule validation decides acceptance.
- **Actual:** blocked by auth middleware pre-check.

---

## SEV-2 — F3: Subscription mutation path can create active subscription with missing cycle grant

**Scope impact:** #61 + #63 reconciliation

### Symptoms
- Owner plan change/cancel/resume endpoints return 200 and mutate subscription rows.
  - Evidence: `31-change-plan-owner.http`, `32-cancel-owner.http`, `33-resume-owner.http`, `34-subscription-owner.http`
- Reconciliation run reports `missing_subscription_grant` SEV-1 item for active subscription.
  - Evidence: `45-reconciliation-run-success.http`, `49-db-reconciliation-runs.txt`, `50-db-reconciliation-items.txt`

### Why this matters
Subscription lifecycle path used by settings route can leave account active without corresponding cycle grant record, relying on later external webhook/reconciliation/manual processes.

### Repro steps
1. Bootstrap owner workspace.
2. Change plan via `/api/billing/subscription/change-plan`.
3. Run `/api/internal/reconciliation/run` with admin access.
4. Observe mismatch item `missing_subscription_grant`.

### Expected vs Actual
- **Expected:** active subscription state and credit grant lifecycle remain internally consistent.
- **Actual:** mismatch detected immediately; repair is manual_review.

---

## SEV-2 — F4: Billing deep-link section UX parity gap (`section=` ignored)

**Scope impact:** #58 Settings Billing/Plans UX

### Observation
Spec documents deep links like:
- `/settings?tab=billing&section=usage`
- `/settings?tab=billing&section=invoices`
- `/settings?tab=billing&section=payment-method`

In implementation, `SettingsContent` parses only `tab`; no section routing/state handling is implemented.

Code reference:
- `src/components/settings/SettingsContent.tsx`
- `src/components/settings/sections/BillingPlansSection.tsx`

### Expected vs Actual
- **Expected:** section-aware deep link behavior and navigable subsections.
- **Actual:** single billing panel; `section` query is inert.

---

## Passed checks / positive results

1. **Owner/member gating works for billing mutations** ✅
   - Member overview returns read-only owner notice (`isOwner:false`) and mutation endpoints return 403.
   - Evidence: `27-overview-member.http`, `28-change-plan-member-forbidden.http`, `29-cancel-member-forbidden.http`, `30-resume-member-forbidden.http`

2. **Admin route protection works** ✅
   - Non-admin blocked for internal/admin billing routes.
   - Evidence: `35-admin-adjust-forbidden.http`, `36-internal-pricing-get-forbidden.http`, `37-internal-recon-forbidden.http`, `38-invoice-ingest-forbidden.http`

3. **Admin actions + audit log persistence works** ✅
   - Admin credit adjustment succeeds and creates audit entries.
   - Evidence: `39-admin-adjust-success.http`, `48-db-admin-audit-logs.txt`

4. **Invoice ingestion persistence + idempotent upsert behavior works** ✅
   - Invoice ingested and retrievable from settings invoices endpoint.
   - Re-ingest of same `(authority, authorityInvoiceId)` returns same invoice id.
   - Evidence: `40b-invoice-ingest-success.http`, `41b-invoice-ingest-idempotent.http`, `46-invoices-after-ingest.http`, `47-db-invoices.txt`

5. **Webhook validation hardening (signature + replay + dedupe) works at handler layer** ✅
   - Evidence: `16-webhook-invalid-signature.http`, `18b-webhook-replay-dedup-with-bypass.http`, `19b-webhook-stale-with-bypass.http`

---

## Scope-by-scope status

- **#57 Docs foundation sanity vs implementation:** ⚠️ **Partial** (major alignments exist, but runtime transaction behavior + webhook ingress/public-route mismatch break intended architecture behavior).
- **#58 Billing/Plans UI states + owner/member gating UX:** ⚠️ **Partial** (gating passes; deep-link section behavior missing).
- **#59 Ledger invariants:** ❌ **Fail** (core reserve/settle/release API reliability broken by transaction callback runtime error).
- **#60 Pricing/metering correctness (FAL-first, versioning):** ❌ **Fail** (pricing version API unavailable due same transaction error).
- **#61 Subscription lifecycle + webhook correctness:** ❌ **Fail** (webhook route auth-gated; lifecycle path can yield missing grant mismatch).
- **#62 Enforcement modes:** ⚠️ **Partial** (insufficient-credit path observed 402; full runtime reliability blocked by transaction defect on reserve/settle/release).
- **#63 Admin controls/reconciliation/observability:** ⚠️ **Partial** (RBAC and audit/metrics work; reconciliation detects mismatches but core pricing API still broken).
- **Caveat fixes validation:** ⚠️ **Partial**
  - Async settle path code exists and tests pass.
  - RBAC/audit hardening validated.
  - Webhook signature/replay hardening validated at handler.
  - Invoice ingestion persistence validated.
  - But webhook ingress auth and transaction failures remain blockers.

---

## Recommended disposition

**Do not mark phase as QA-pass yet.**

Minimum blockers to clear before re-audit:
1. Fix transaction callback usage on sqlite-backed runtime for billing-critical flows.
2. Make `/api/webhooks/billing/clerk` publicly reachable (while preserving strict signature/replay checks).

After fixes, rerun this exact audit matrix plus a clean browser session with authenticated owner/member accounts.

---

## Evidence directory

All artifacts for this audit:
- `docs/screenshots/qa-billing-phases-57-63-2026-02-23/`
