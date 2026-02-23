import 'server-only';

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { getDatabaseAsync } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as { workspaceId?: string };
  const activeWorkspace = resolveActorWorkspace(actorResult.actor, body.workspaceId);

  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  if (activeWorkspace.role !== 'owner') {
    return NextResponse.json({ error: 'Only workspace owners can cancel plans' }, { status: 403 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);
  const db = await getDatabaseAsync();

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      status: 'canceled',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.billingAccountId, account.id),
        eq(subscriptions.status, 'active')
      )
    );

  return NextResponse.json({ ok: true });
}
