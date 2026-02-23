import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { releaseReservation } from '@/lib/billing/ledger';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as {
    workspaceId?: string;
    jobId?: string;
    idempotencyKeyPrefix?: string;
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
  const reservation = await releaseReservation({
    billingAccountId: account.id,
    jobId: body.jobId,
    idempotencyKeyPrefix: body.idempotencyKeyPrefix,
  });

  return NextResponse.json({
    ok: true,
    workspaceId: activeWorkspace.workspaceId,
    billingAccountId: account.id,
    reservation,
  });
}
