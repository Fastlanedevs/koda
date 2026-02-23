import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { getActiveSubscriptionForBillingAccount } from '@/lib/billing/subscriptions';

export async function GET(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  const activeWorkspace = resolveActorWorkspace(actorResult.actor, workspaceId);

  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);
  const subscription = await getActiveSubscriptionForBillingAccount(account.id);

  return NextResponse.json({
    workspaceId: activeWorkspace.workspaceId,
    billingAccountId: account.id,
    subscription,
  });
}
