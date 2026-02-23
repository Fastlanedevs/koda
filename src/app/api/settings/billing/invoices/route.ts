import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { listBillingInvoicesForAccount } from '@/lib/billing/invoices';
import type { BillingInvoiceRow } from '@/lib/billing/types';

function toInvoiceStatus(status: string): BillingInvoiceRow['status'] {
  if (status === 'paid' || status === 'open' || status === 'failed' || status === 'refunded') {
    return status;
  }

  return 'open';
}

function toInvoiceRow(row: {
  id: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
  status: string;
  invoiceDate: Date;
  receiptUrl: string | null;
}): BillingInvoiceRow {
  return {
    id: row.id,
    number: row.invoiceNumber,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: toInvoiceStatus(row.status),
    invoiceDate: row.invoiceDate.toISOString(),
    receiptUrl: row.receiptUrl ?? undefined,
  };
}

export async function GET(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const { searchParams } = new URL(request.url);
  const requestedWorkspaceId = searchParams.get('workspaceId');

  const actor = actorResult.actor;
  const activeMembership = requestedWorkspaceId
    ? actor.memberships.find((membership: { workspaceId: string }) => membership.workspaceId === requestedWorkspaceId)
    : actor.memberships.find((membership: { role: string }) => membership.role === 'owner') ?? actor.memberships[0];

  if (!activeMembership) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const account = await ensureBillingAccountForWorkspace(activeMembership.workspaceId);
  const rows = await listBillingInvoicesForAccount(account.id, 100);

  let invoices = rows.map(toInvoiceRow);

  if (invoices.length === 0 && process.env.BILLING_DEMO_INVOICES === 'true') {
    invoices = [
      {
        id: 'inv_demo_1',
        number: 'INV-2026-0001',
        amountMinor: 1900,
        currency: 'USD',
        status: 'paid',
        invoiceDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
      },
    ];
  }

  return NextResponse.json({ invoices });
}
