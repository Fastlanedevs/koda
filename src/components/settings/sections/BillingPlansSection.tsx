'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BillingInvoiceRow, BillingOverviewResponse, BillingStatus } from '@/lib/billing/types';

const statusLabel: Record<BillingStatus, string> = {
  trialing: 'Trial',
  active: 'Active',
  grace: 'Action needed',
  payment_failed: 'Payment failed',
  canceled: 'Canceled',
  expired: 'Expired',
};

const statusHeadline: Record<BillingStatus, string> = {
  trialing: 'Trial ends soon. Choose a plan to keep full access.',
  active: 'Your plan is active and renews automatically.',
  grace: 'We could not renew your plan. Update payment to avoid interruption.',
  payment_failed: 'A recent payment attempt failed. Fix your payment method.',
  canceled: 'Your plan is canceled and will end at the period boundary.',
  expired: 'Your paid plan has ended. Reactivate to restore full limits.',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function percent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

function usageTone(ratio: number) {
  if (ratio >= 100) return 'bg-red-500';
  if (ratio >= 80) return 'bg-amber-500';
  return 'bg-blue-500';
}

function BillingSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2, 3].map((id) => (
        <div key={id} className="animate-pulse rounded-lg border border-border bg-background p-4">
          <div className="mb-2 h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function BillingPlansSection() {
  const [overview, setOverview] = useState<BillingOverviewResponse | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [overviewRes, invoiceRes] = await Promise.all([
          fetch('/api/settings/billing/overview', { cache: 'no-store' }),
          fetch('/api/settings/billing/invoices', { cache: 'no-store' }),
        ]);

        if (!overviewRes.ok) {
          throw new Error('We could not load billing details.');
        }

        const overviewJson = (await overviewRes.json()) as BillingOverviewResponse;
        const invoiceJson = invoiceRes.ok
          ? ((await invoiceRes.json()) as { invoices?: BillingInvoiceRow[] })
          : { invoices: [] };

        if (!mounted) return;
        setOverview(overviewJson);
        setInvoices(invoiceJson.invoices ?? []);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load billing details.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const ctaLabel = useMemo(() => {
    if (!overview) return 'Change plan';

    if (overview.plan.status === 'payment_failed' || overview.plan.status === 'grace') {
      return 'Update payment method';
    }

    if (overview.plan.status === 'expired') {
      return 'Reactivate plan';
    }

    if (overview.plan.status === 'canceled') {
      return 'Resume plan';
    }

    return 'Change plan';
  }, [overview]);

  if (loading) {
    return <BillingSkeleton />;
  }

  if (error || !overview) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm text-foreground">{error ?? 'We could not load billing details.'}</p>
        <p className="mt-2 text-xs text-muted-foreground">Please retry in a moment or contact support.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p>
            <h3 className="text-lg font-semibold text-foreground">{overview.plan.name}</h3>
            <p className="text-sm text-muted-foreground">{overview.plan.priceLabel} · {overview.plan.interval}</p>
            <p className="mt-1 text-sm text-muted-foreground">{statusHeadline[overview.plan.status]}</p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground">
            {statusLabel[overview.plan.status]}
          </span>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Workspace: <span className="text-foreground">{overview.workspaceName}</span></p>
          <p>Renews on: <span className="text-foreground">{formatDate(overview.plan.renewalDate)}</span></p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!overview.isOwner}
          >
            {ctaLabel}
          </button>
          <button
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!overview.isOwner}
          >
            {overview.plan.status === 'canceled' ? 'Compare plans' : 'Cancel plan'}
          </button>
        </div>
        {!overview.isOwner && (
          <p className="mt-3 text-xs text-muted-foreground">
            {overview.ownerNotice ?? 'Only workspace owners can manage billing. Contact your workspace owner.'}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Usage & limits</h3>
        <div className="mt-3 space-y-3">
          {overview.usage.map((item) => {
            const ratio = percent(item.used, item.limit);
            return (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="text-foreground">{item.used.toLocaleString()} / {item.limit.toLocaleString()} {item.unit}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className={`h-2 rounded-full ${usageTone(ratio)}`} style={{ width: `${ratio}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Payment method</h3>
        {overview.paymentMethod ? (
          <div className="mt-2 text-sm text-muted-foreground">
            <p>
              {overview.paymentMethod.brand.toUpperCase()} ending in {overview.paymentMethod.last4}
            </p>
            <p>
              Expires {overview.paymentMethod.expMonth.toString().padStart(2, '0')}/{overview.paymentMethod.expYear}
            </p>
            <p>{overview.paymentMethod.email}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No payment method added yet.</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Invoices & billing history</h3>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No invoices yet. They appear after your first successful payment.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm">
                <div>
                  <p className="text-foreground">{invoice.number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(invoice.invoiceDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-foreground">{(invoice.amountMinor / 100).toFixed(2)} {invoice.currency.toUpperCase()}</p>
                  <p className="text-xs capitalize text-muted-foreground">{invoice.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
        Payments are processed securely by our payment partner. Full card details are never displayed in Koda.
      </div>
    </div>
  );
}
