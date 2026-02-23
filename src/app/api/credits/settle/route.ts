import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { settleReservation } from '@/lib/billing/ledger';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as {
    workspaceId?: string;
    jobId?: string;
    actualCredits?: number;
    idempotencyKeyPrefix?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.jobId || !body.idempotencyKeyPrefix) {
    return NextResponse.json(
      { error: 'jobId and idempotencyKeyPrefix are required' },
      { status: 400 }
    );
  }

  const activeWorkspace = resolveActorWorkspace(actorResult.actor, body.workspaceId);
  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);

  try {
    const settlement = await settleReservation({
      billingAccountId: account.id,
      jobId: body.jobId,
      actualCredits: Math.max(0, Math.trunc(body.actualCredits ?? 0)),
      idempotencyKeyPrefix: body.idempotencyKeyPrefix,
      metadata: body.metadata,
    });

    return NextResponse.json({
      ok: true,
      workspaceId: activeWorkspace.workspaceId,
      billingAccountId: account.id,
      settlement,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settlement failed' },
      { status: 500 }
    );
  }
}
