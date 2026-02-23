import 'server-only';

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { getDatabaseAsync } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';
import { ensurePlanCatalogSeed } from '@/lib/billing/subscriptions';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as {
    workspaceId?: string;
    planCode?: string;
  };

  if (!body.planCode) {
    return NextResponse.json({ error: 'planCode is required' }, { status: 400 });
  }

  const activeWorkspace = resolveActorWorkspace(actorResult.actor, body.workspaceId);
  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  if (activeWorkspace.role !== 'owner') {
    return NextResponse.json({ error: 'Only workspace owners can change plans' }, { status: 403 });
  }

  await ensurePlanCatalogSeed();
  const db = await getDatabaseAsync();
  const [plan] = await db.select().from(plans).where(eq(plans.planCode, body.planCode)).limit(1);

  if (!plan) {
    return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);
  const now = new Date();

  const [existingSubscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.billingAccountId, account.id))
    .limit(1);

  if (existingSubscription) {
    await db
      .update(subscriptions)
      .set({
        planId: plan.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, existingSubscription.id));
  } else {
    await db.insert(subscriptions).values({
      id: randomUUID(),
      billingAccountId: account.id,
      planId: plan.id,
      authority: 'clerk',
      authoritySubscriptionId: randomUUID(),
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true, planCode: body.planCode });
}
