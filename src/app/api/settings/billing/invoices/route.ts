import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import type { BillingInvoiceRow } from '@/lib/billing/types';

export async function GET() {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const demoEnabled = process.env.BILLING_DEMO_INVOICES === 'true';

  const invoices: BillingInvoiceRow[] = demoEnabled
    ? [
        {
          id: 'inv_demo_1',
          number: 'INV-2026-0001',
          amountMinor: 1900,
          currency: 'usd',
          status: 'paid',
          invoiceDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        },
      ]
    : [];

  return NextResponse.json({ invoices });
}
