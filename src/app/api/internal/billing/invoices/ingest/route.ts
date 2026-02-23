import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { isBillingAdmin } from '@/lib/billing/admin';
import { logBillingAdminAction } from '@/lib/billing/admin-audit';
import { ingestBillingInvoice, ingestBillingInvoiceSchema } from '@/lib/billing/invoices';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsedBody = ingestBillingInvoiceSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid invoice ingestion payload', details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const row = await ingestBillingInvoice(parsedBody.data);

  await logBillingAdminAction({
    actorUserId: actorResult.actor.user.id,
    action: 'invoice_ingest',
    metadata: {
      actionType: 'invoice_ingest',
      invoiceId: row.id,
      authority: row.authority,
      authorityInvoiceId: row.authorityInvoiceId,
    },
  });

  return NextResponse.json({ ok: true, invoice: row });
}
