# SPEC: Subscription & Payment Plan Management UI (Settings)

- **Status:** Draft
- **Owner:** Product + Design + Frontend
- **Date:** 2026-02-23
- **Surface:** `/settings` (new Billing/Subscription surface)
- **Auth Context:** Clerk-backed identity/session
- **Design Baseline:** Koda guidelines (non-flashy, neutral surfaces, single blue accent `#3b82f6`, no gradients/glow)
- **Deliverable Type:** UX/UI specification only (no implementation code)

---

## 0) Objective

Design a clear, trustworthy, and low-friction subscription management experience inside Settings that allows eligible users to:

1. Understand their current plan and billing status
2. Monitor usage against plan limits
3. Upgrade, downgrade, cancel, or resume (as allowed)
4. Manage payment method
5. Access invoice history and receipts
6. Resolve billing issues (failed payment, grace period, expiry)

This spec must work for both individual and workspace-based usage, align with Clerk-auth session behavior, and respect role-based permissions.

---

## 1) Scope, assumptions, and non-goals

## 1.1 In scope

- New Settings information architecture (IA) placement for subscription management
- Billing/Subscription page layout and interaction model
- UX states for lifecycle: trial, active, grace period, payment failed, canceled, expired
- Role/permission behavior (owner vs member, with explicit workspace role handling)
- Empty/loading/error/skeleton designs
- Responsive behavior (mobile + desktop)
- Copy and trust/safety messaging guidance
- Event instrumentation contract (analytics + audit)
- Definition of Done and acceptance checklist

## 1.2 Assumptions

- Clerk remains source of truth for authenticated user identity and session.
- Billing provider exists or will exist behind an API abstraction (provider-agnostic in this spec).
- Workspace context exists for collaborative plans (owner/admin/editor/viewer model currently documented).
- Current Settings has a left tab rail and content panel pattern; this spec extends that pattern.

## 1.3 Out of scope

- Backend billing engine implementation
- Payment processor migration decisions
- Tax/legal implementation detail
- Entitlement enforcement logic implementation
- Email template implementation

---

## 2) Information Architecture (IA) placement and navigation

## 2.1 Settings taxonomy proposal

Introduce a dedicated top-level settings tab:

- **Billing & Plans** (recommended label)

Placement in existing settings tab order:

1. Profile
2. Billing & Plans  ← **new**
3. Invites (if enabled)
4. API Keys
5. Generation Defaults
6. Generation History
7. Canvas Preferences
8. Appearance
9. Keyboard Shortcuts
10. Storage & Data

Rationale:
- Account and money-related actions should be high-discoverability and near Profile.
- Billing should not be buried beneath technical settings.

## 2.2 URL and deep-link model

Use the existing query-tab pattern:

- `/settings?tab=billing`

Optional in-page anchor/deep-links:

- `/settings?tab=billing&section=usage`
- `/settings?tab=billing&section=invoices`
- `/settings?tab=billing&section=payment-method`

## 2.3 Cross-surface entry points

Provide links to Billing tab from:

- Usage limit warning banners on dashboard/canvas
- Payment failure toasts
- Trial-ending banners
- Workspace invite acceptance success page (if plan restrictions are relevant)

All such links should resolve to `/settings?tab=billing` and preserve workspace context.

## 2.4 Navigation behavior

- Preserve tab state in URL for refresh/back-forward support.
- If user lacks billing permission, show read-only summary with disabled actions and explanatory copy (not a hard 404), unless user lacks workspace access entirely.
- If workspace is unresolved, show recovery state with retry and context.

---

## 3) Subscription page layout

## 3.1 Layout structure (desktop)

Desktop container uses existing Koda settings shell:

- Left: Settings tab nav
- Right: Billing content card stack

Billing content sections (top to bottom):

1. **Current Plan Summary Card**
2. **Usage & Limits Card**
3. **Plan Actions Card** (upgrade/downgrade/cancel/resume)
4. **Payment Method Card**
5. **Invoices & Billing History Card**
6. **Support & Safety Footer Block**

## 3.2 Section details

### A) Current Plan Summary

Required fields:
- Plan name (e.g., Free, Pro, Team)
- Billing interval (monthly/annual)
- Price and currency
- Seat count / workspace scope indicator
- Renewal date or end date
- Status badge (trial, active, grace, payment failed, canceled, expired)

Actions:
- `Change plan` (primary for upgrade-eligible)
- `Manage seats` (if seat-based)
- `Cancel plan` or `Resume plan` depending on state

Design notes:
- Use neutral card with subtle border.
- Status badges should be semantic but muted (avoid alert fatigue).

### B) Usage & Limits

Display usage metrics relevant to entitlements, e.g.:
- Monthly generations used / included
- Storage used / quota
- Team seats used / available
- Optional API/compute credits if applicable

Visual style:
- Numeric value + progress bar + small helper text
- Progress bar uses solid blue fill for normal, warning/destructive tones only near/exceeding limits

Actions:
- `View usage details` (optional)
- `Upgrade plan` CTA when near limits

### C) Plan Actions (Upgrade / Downgrade / Cancel / Resume)

Primary interaction model:
- Compare available plans in compact rows/cards
- Current plan clearly labeled
- Delta summary before confirmation (price, effective date, proration behavior)

Required sub-states:
- Upgrade immediate vs next-cycle logic explanation
- Downgrade effective date explanation
- Cancellation confirmation with date and retained access window
- Resume action when canceled-but-active-until-period-end

Safeguards:
- Explicit confirmation modal for cancellation/downgrade to lower tier
- Clear consequence statement (features/limits change)

### D) Payment Method

Display:
- Card brand + masked last4
- Expiry month/year
- Billing contact email (if distinct)

Actions:
- `Update payment method`
- `Remove` (only if alternative valid method exists OR on free plan)

Safety constraints:
- Never expose full PAN/CVC
- Link to secure provider-hosted update flow where required

### E) Invoices & Billing History

Table/list fields:
- Invoice date
- Invoice number
- Amount
- Status (paid/open/failed/refunded)
- Download receipt (PDF)

Behavior:
- Default sort newest first
- Pagination or “Load more” for long history
- Empty state for no invoices yet

### F) Support & Safety Footer

Include:
- “Need help with billing?” support CTA
- Data/privacy reassurance copy
- Link to refund/cancellation policy (if available)

---

## 4) UX lifecycle states

All lifecycle states should be represented by:
- A status badge
- A short explanatory headline
- A clear primary action
- A secondary help/reassurance action

## 4.1 Trial

UI:
- Badge: `Trial`
- Headline: “Trial ends in X days”
- CTA: `Choose a plan`
- Secondary: “What happens when trial ends?” tooltip/link

Behavior:
- Show countdown in days, then hours in final 24h.

## 4.2 Active

UI:
- Badge: `Active`
- Headline: “Your plan renews on <date>”
- CTA: `Change plan`
- Secondary: `View invoices`

## 4.3 Grace period

UI:
- Badge: `Action needed`
- Headline: “We couldn’t renew your plan. Access remains until <date>.”
- CTA: `Update payment method`
- Secondary: `Retry payment`

Behavior:
- Persistent warning at top of billing page until resolved.

## 4.4 Payment failed

UI:
- Badge: `Payment failed`
- Headline: “Payment attempt failed on <date>”
- CTA: `Fix payment method`
- Secondary: `Contact support`

Behavior:
- Show concise reason category when available (insufficient funds, card expired, bank declined), avoiding raw processor jargon.

## 4.5 Canceled (scheduled end)

UI:
- Badge: `Canceled`
- Headline: “Plan ends on <date>”
- CTA: `Resume plan`
- Secondary: `Compare plans`

Behavior:
- Keep invoice/payment history accessible.

## 4.6 Expired

UI:
- Badge: `Expired`
- Headline: “Your paid plan has ended”
- CTA: `Reactivate plan`
- Secondary: `See current limits`

Behavior:
- Explain which features are now restricted while preserving access to billing history.

---

## 5) Team/workspace edge cases and permissions

## 5.1 Permission principles

Billing actions are workspace-sensitive.

- **Owner:** full billing control
- **Admin:** optional billing control (depends on policy toggle; default recommended = read-only unless explicitly granted)
- **Editor/Viewer (members):** read-only summary, no billing mutations

Given current role model docs, owner-only for highest-risk actions is the safe baseline.

## 5.2 Owner vs member behavior (required)

### Owner
Can:
- Change plan
- Update payment method
- Cancel/resume subscription
- Download invoices
- Manage seats (if applicable)

### Member (non-owner)
Can:
- View plan and usage summary (if policy allows visibility)
- View invoice list (optional, policy-dependent)
- Cannot mutate billing configuration

Must see message:
- “Only workspace owners can manage billing. Contact <owner_email_or_name>.”

## 5.3 Multi-workspace context switching

If user belongs to multiple workspaces:
- Billing page must clearly display active workspace name at top.
- Switching workspace updates billing context and permissions instantly.
- Prevent accidental cross-workspace action via strong context header.

## 5.4 No workspace / bootstrap failure

If workspace context fails to resolve:
- Show non-destructive error state with `Retry` and “Return to dashboard”
- Do not show stale billing data from previous workspace context

## 5.5 Pending ownership transfer

If ownership transfer is pending:
- Show info banner: “Ownership transfer pending; billing actions may be restricted until accepted.”
- Disable conflicting billing mutations with tooltip rationale.

---

## 6) Empty, loading, error, and skeleton states

## 6.1 Loading strategy

Initial load:
- Show page-level skeleton blocks matching final section geometry:
  - Plan summary skeleton
  - Usage bars skeleton
  - 2-row action skeleton
  - Payment method skeleton
  - Invoice list skeleton (3 rows)

Rules:
- Avoid spinner-only full page for >500ms loads.
- Preserve layout stability (no major reflow).

## 6.2 Empty states

### No subscription yet
- Headline: “You’re on the Free plan”
- Body: concise limit summary
- CTA: `Upgrade to Pro`

### No payment method on file
- Headline: “No payment method added”
- CTA: `Add payment method`

### No invoices
- Headline: “No invoices yet”
- Body: “Invoices appear here after your first successful payment.”

## 6.3 Error states

### Fetch error
- Message: “We couldn’t load billing details.”
- Actions: `Retry` + `Contact support`

### Action failure (mutation)
- Inline error near affected card
- Preserve prior known-good data
- Include support fallback for repeated failures

### Partial data error
- Show available sections
- Isolate failed section with local retry

## 6.4 Offline/latency behavior

- Detect offline and surface non-blocking banner: “You’re offline. Billing data may be outdated.”
- Disable mutation actions while offline.

---

## 7) Responsive behavior (mobile + desktop)

## 7.1 Breakpoint behavior

- **Desktop (>=1024px):** two-column settings shell, full section cards
- **Tablet (768–1023px):** narrower nav + content; optional collapsible settings rail
- **Mobile (<768px):** single-column flow; settings tabs become horizontal scroll chips or select menu

## 7.2 Mobile content order

On mobile, order is:
1. Status/Plan summary
2. Primary action (upgrade/fix payment/reactivate)
3. Usage
4. Payment method
5. Invoices
6. Secondary/destructive actions in a separate “Plan controls” block

## 7.3 Mobile interaction constraints

- Touch targets >= 44px height
- Invoice rows become stacked cards (date/amount/status + download)
- Long plan comparison content moves to modal/drawer
- Sticky primary CTA allowed only for urgent states (payment failed/grace)

## 7.4 Responsiveness quality bar

- No horizontal scrolling in primary content
- Status + CTA visible above fold in urgent states
- Typography and spacing consistent with existing Koda settings rhythm

---

## 8) Copy guidance + trust/safety messaging

## 8.1 Tone

- Calm, direct, non-alarmist
- Human and actionable
- Avoid finance jargon unless necessary

## 8.2 Copy rules

Do:
- Explain what happened, what it means, and what to do next.
- Use explicit dates and local timezone formatting.
- Use user-safe language for destructive actions.

Don’t:
- Blame users (“Your card failed because…”)
- Expose processor internals/raw error codes in UI
- Use urgency language unless access risk is real

## 8.3 Suggested microcopy snippets

- Renewal: “Renews on 14 Mar 2026.”
- Grace: “Payment issue detected. Update your payment method to avoid interruption.”
- Member restriction: “Only workspace owners can manage billing settings.”
- Cancel confirm: “Your paid features remain active until 14 Mar 2026.”

## 8.4 Trust/safety content requirements

Billing page must include:
- Secure payment reassurance: “Payments are processed securely by our payment partner.”
- Privacy cue: “Full card details are never displayed in Koda.”
- Policy links: refund/cancellation terms and support route
- Security escalation path for suspected unauthorized billing activity

---

## 9) Event instrumentation specification

## 9.1 Tracking principles

Track user intent, friction, and outcomes across the billing journey, without collecting sensitive payment data.

Do not track:
- Full card number
- CVC
- Raw payment processor payloads containing sensitive fields

## 9.2 Core events

1. `billing_page_viewed`
   - props: `workspace_id`, `user_id`, `role`, `plan_status`, `plan_name`

2. `billing_plan_change_clicked`
   - props: `workspace_id`, `from_plan`, `to_plan`, `interval`, `role`

3. `billing_plan_change_confirmed`
   - props: `workspace_id`, `from_plan`, `to_plan`, `effective_timing` (immediate|next_cycle), `role`

4. `billing_plan_change_failed`
   - props: `workspace_id`, `from_plan`, `to_plan`, `error_category`, `role`

5. `billing_cancel_initiated`
   - props: `workspace_id`, `plan_name`, `role`, `days_remaining`

6. `billing_cancel_confirmed`
   - props: `workspace_id`, `plan_name`, `end_date`, `role`

7. `billing_resume_clicked`
   - props: `workspace_id`, `plan_name`, `role`

8. `billing_payment_method_update_started`
   - props: `workspace_id`, `role`, `entry_point`

9. `billing_payment_method_update_succeeded`
   - props: `workspace_id`, `card_brand`, `expiry_month`, `expiry_year`

10. `billing_payment_method_update_failed`
    - props: `workspace_id`, `error_category`, `role`

11. `billing_invoice_download_clicked`
    - props: `workspace_id`, `invoice_id`, `invoice_status`, `amount`, `currency`

12. `billing_permission_block_shown`
    - props: `workspace_id`, `role`, `attempted_action`

13. `billing_state_banner_shown`
    - props: `workspace_id`, `state` (trial|active|grace|payment_failed|canceled|expired)

14. `billing_retry_payment_clicked`
    - props: `workspace_id`, `attempt_count`, `state`

## 9.3 Funnel views

Primary funnel:
- `billing_page_viewed` → `billing_plan_change_clicked` → `billing_plan_change_confirmed`

Recovery funnel:
- `billing_state_banner_shown(state=payment_failed|grace)` → `billing_payment_method_update_started` → `billing_payment_method_update_succeeded`

## 9.4 Audit and observability hooks

For sensitive mutations, log server-side audit events with actor/workspace context:
- plan changed
- subscription canceled/resumed
- payment method updated (metadata only)

---

## 10) Definition of Done (DoD)

This spec is complete when all are true:

- [ ] Billing & Plans appears in Settings IA with URL-addressable tab state
- [ ] Page includes: current plan, usage, upgrade/downgrade controls, invoices, payment method
- [ ] Lifecycle states (trial/active/grace/payment failed/canceled/expired) each have explicit UX treatment
- [ ] Owner vs member permission behavior is visible and enforced in UX
- [ ] Empty/loading/error/skeleton states are fully defined and non-blocking
- [ ] Mobile and desktop responsive behaviors are documented and QA-verifiable
- [ ] Copy and trust/safety messaging standards are defined and applied
- [ ] Event instrumentation list is complete and privacy-safe
- [ ] Acceptance checklist passes without unresolved critical items

---

## 11) Acceptance checklist (QA + Product + Design)

## 11.1 IA and navigation
- [ ] Billing tab discoverable in Settings near Profile/account surfaces
- [ ] Deep links to billing sections work
- [ ] Back/forward navigation preserves billing state

## 11.2 Core layout
- [ ] Plan summary card has status, renewal/end date, and actions
- [ ] Usage card shows current vs limit for each metered category
- [ ] Plan actions include upgrade/downgrade with consequence copy
- [ ] Payment method card supports secure update flow
- [ ] Invoices list supports download and status visibility

## 11.3 State coverage
- [ ] Trial UI and countdown present
- [ ] Active state renewal messaging clear
- [ ] Grace + payment failed recovery path clear
- [ ] Canceled and expired states differentiate correctly

## 11.4 Permissions and workspace behavior
- [ ] Owner has full billing controls
- [ ] Member sees restricted UI with clear owner-contact guidance
- [ ] Multi-workspace context is explicit and safe

## 11.5 Reliability states
- [ ] Skeletons match final layout and avoid jumpiness
- [ ] Empty states are actionable
- [ ] Error states provide retry and support paths
- [ ] Offline mode disables mutations safely

## 11.6 Responsive quality
- [ ] Works at 320/375/768/1024/1440 widths
- [ ] No horizontal overflow in billing content
- [ ] Primary urgent CTA remains easy to reach on mobile

## 11.7 Content, trust, and compliance cues
- [ ] User-facing billing copy is concise and non-technical
- [ ] Security/privacy reassurance is present
- [ ] Policy and support links are visible and valid

## 11.8 Instrumentation
- [ ] All specified events fire with correct required props
- [ ] Sensitive payment details are never tracked
- [ ] Permission-block and error-category events present for debugging

---

## 12) Explicit open questions (to resolve before implementation)

1. **Billing authority:** Should `admin` users have billing mutation rights, or should billing remain strictly owner-only in v1?
2. **Plan model:** What are the exact initial plans, limits, and interval options (Free/Pro/Team, monthly/annual, seat-based vs usage-based)?
3. **Proration policy:** For upgrades/downgrades, should changes apply immediately with proration or at next billing cycle?
4. **Invoice visibility:** Should non-owner members be allowed to view/download invoices, or only owners/admins?
5. **Payment update flow:** Is payment method management fully provider-hosted (redirect/modal) or in-app embedded elements?
6. **Grace-period duration:** What exact grace window should UX assume (e.g., 3/7/14 days)?
7. **Cancellation policy copy:** What legal/finance-approved wording and policy links must be shown for refunds/cancellations?
8. **Seat management:** Is seat assignment/true-up in scope for this surface now, or deferred to a separate Team Billing section?
9. **Tax display:** Should billing UI show tax/VAT breakdown per invoice in v1?
10. **Support routing:** Preferred support channel for billing issues (email, in-app chat, ticket form) and SLA promise copy?

