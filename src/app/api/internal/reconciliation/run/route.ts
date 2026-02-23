import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/lib/auth/actor';
import { isBillingAdmin } from '@/lib/billing/admin';
import { logBillingAdminAction } from '@/lib/billing/admin-audit';
import { runBillingReconciliation } from '@/lib/billing/reconciliation';
import { emitBillingMetric } from '@/lib/observability/billing-metrics';

const reconciliationBodySchema = z
  .object({
    repairEnabled: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsedBody = reconciliationBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const repairEnabled = parsedBody.data.repairEnabled === true;
  const result = await runBillingReconciliation({ repairEnabled });

  await logBillingAdminAction({
    actorUserId: actorResult.actor.user.id,
    action: 'reconciliation_trigger',
    metadata: {
      repairEnabled,
      ...result,
    },
  });

  emitBillingMetric({
    event: 'reconciliation_run',
    actorUserId: actorResult.actor.user.id,
    metadata: result,
    level: result.mismatchCount > 0 ? 'warn' : 'info',
  });

  return NextResponse.json({ ok: true, ...result });
}
