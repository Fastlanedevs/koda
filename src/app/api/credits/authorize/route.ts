import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { reserveCredits } from '@/lib/billing/ledger';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as {
    workspaceId?: string;
    jobId?: string;
    estimatedCredits?: number;
    pricingVersionId?: string;
    idempotencyKey?: string;
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  };

  if (!body.jobId || !body.idempotencyKey) {
    return NextResponse.json(
      { error: 'jobId and idempotencyKey are required' },
      { status: 400 }
    );
  }

  const activeWorkspace = resolveActorWorkspace(actorResult.actor, body.workspaceId);
  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);

  try {
    const reservation = await reserveCredits({
      billingAccountId: account.id,
      jobId: body.jobId,
      amountCredits: Math.max(0, Math.trunc(body.estimatedCredits ?? 0)),
      pricingVersionId: body.pricingVersionId ?? 'default-v1',
      idempotencyKey: body.idempotencyKey,
      ttlMs: body.ttlMs,
      metadata: body.metadata,
    });

    return NextResponse.json({
      ok: true,
      reservation,
      billingAccountId: account.id,
      workspaceId: activeWorkspace.workspaceId,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authorization failed' },
      { status: 500 }
    );
  }
}
