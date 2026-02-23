import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { isBillingAdmin } from '@/lib/billing/admin';
import { runBillingReconciliation } from '@/lib/billing/reconciliation';
import { emitBillingMetric } from '@/lib/observability/billing-metrics';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { repairEnabled?: boolean };

  const result = await runBillingReconciliation({ repairEnabled: body.repairEnabled === true });

  emitBillingMetric({
    event: 'reconciliation_run',
    actorUserId: actorResult.actor.user.id,
    metadata: result,
    level: result.mismatchCount > 0 ? 'warn' : 'info',
  });

  return NextResponse.json({ ok: true, ...result });
}
