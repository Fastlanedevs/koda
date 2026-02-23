import 'server-only';

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { isBillingAdmin } from '@/lib/billing/admin';
import { logBillingAdminAction } from '@/lib/billing/admin-audit';
import { appendLedgerEntry } from '@/lib/billing/ledger';
import { emitBillingMetric } from '@/lib/observability/billing-metrics';

const adminAdjustBodySchema = z
  .object({
    workspaceId: z.string().min(1),
    amountCredits: z.number().int(),
    reasonCode: z.string().min(2),
    note: z.string().max(2000).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsedBody = adminAdjustBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'workspaceId, amountCredits, and reasonCode are required' },
      { status: 400 }
    );
  }

  const body = parsedBody.data;
  const account = await ensureBillingAccountForWorkspace(body.workspaceId);

  const idempotencyKey =
    body.idempotencyKey ?? `admin:${actorResult.actor.user.id}:${randomUUID()}:v1`;

  const entry = await appendLedgerEntry({
    billingAccountId: account.id,
    txnType: 'credit_adjustment_admin',
    amountCredits: Math.trunc(body.amountCredits),
    idempotencyKey,
    referenceType: 'admin_adjustment',
    referenceId: body.workspaceId,
    reasonCode: body.reasonCode,
    metadata: {
      note: body.note ?? null,
      actorUserId: actorResult.actor.user.id,
    },
  });

  await logBillingAdminAction({
    actorUserId: actorResult.actor.user.id,
    action: 'manual_credit_adjustment',
    workspaceId: body.workspaceId,
    metadata: {
      billingAccountId: account.id,
      amountCredits: body.amountCredits,
      reasonCode: body.reasonCode,
      entryId: entry.id,
    },
  });

  emitBillingMetric({
    event: 'admin_credit_adjustment',
    workspaceId: body.workspaceId,
    billingAccountId: account.id,
    actorUserId: actorResult.actor.user.id,
    metadata: {
      amountCredits: body.amountCredits,
      reasonCode: body.reasonCode,
    },
  });

  return NextResponse.json({ ok: true, entry });
}
