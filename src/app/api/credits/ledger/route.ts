import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { listLedgerEntries } from '@/lib/billing/ledger';

export async function GET(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  const limit = Number.parseInt(searchParams.get('limit') ?? '50', 10);

  const activeWorkspace = resolveActorWorkspace(actorResult.actor, workspaceId);
  if (!activeWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);
  const entries = await listLedgerEntries(account.id, limit);

  return NextResponse.json({
    workspaceId: activeWorkspace.workspaceId,
    billingAccountId: account.id,
    entries,
  });
}
