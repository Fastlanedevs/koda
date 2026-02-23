import 'server-only';

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { getDatabaseAsync } from '@/lib/db';
import { workspaceMembers, workspaces } from '@/lib/db/schema';
import type { BillingOverviewResponse } from '@/lib/billing/types';

function resolveStatus(): BillingOverviewResponse['plan']['status'] {
  const raw = process.env.BILLING_DEMO_STATUS;
  if (
    raw === 'trialing' ||
    raw === 'active' ||
    raw === 'grace' ||
    raw === 'payment_failed' ||
    raw === 'canceled' ||
    raw === 'expired'
  ) {
    return raw;
  }
  return 'active';
}

export async function GET(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const { searchParams } = new URL(request.url);
  const requestedWorkspaceId = searchParams.get('workspaceId');

  const db = await getDatabaseAsync();
  const actor = actorResult.actor;

  const activeMembership = requestedWorkspaceId
    ? actor.memberships.find((membership: { workspaceId: string }) => membership.workspaceId === requestedWorkspaceId)
    : actor.memberships.find((membership: { role: string }) => membership.role === 'owner') ?? actor.memberships[0];

  if (!activeMembership) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const [workspaceRow] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      membershipRole: workspaceMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, actor.user.id))
    )
    .where(eq(workspaces.id, activeMembership.workspaceId));

  if (!workspaceRow) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const isOwner = workspaceRow.membershipRole === 'owner';

  const response: BillingOverviewResponse = {
    workspaceId: workspaceRow.workspaceId,
    workspaceName: workspaceRow.workspaceName,
    role: workspaceRow.membershipRole ?? 'viewer',
    isOwner,
    ownerNotice: isOwner ? undefined : 'Only workspace owners can manage billing. Contact your workspace owner.',
    plan: {
      code: (process.env.BILLING_DEMO_PLAN as BillingOverviewResponse['plan']['code']) || 'free',
      name: process.env.BILLING_DEMO_PLAN_NAME || 'Free',
      interval: 'month',
      priceLabel: process.env.BILLING_DEMO_PLAN_PRICE || '$0 / month',
      currency: 'USD',
      renewalDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      status: resolveStatus(),
      trialEndsAt: null,
      canceledAt: null,
    },
    usage: [
      {
        key: 'credits',
        label: 'Monthly credits',
        used: Number.parseInt(process.env.BILLING_DEMO_CREDITS_USED || '0', 10),
        limit: Number.parseInt(process.env.BILLING_DEMO_CREDITS_LIMIT || '100', 10),
        unit: 'credits',
      },
      {
        key: 'storage',
        label: 'Storage',
        used: Number.parseInt(process.env.BILLING_DEMO_STORAGE_USED_GB || '1', 10),
        limit: Number.parseInt(process.env.BILLING_DEMO_STORAGE_LIMIT_GB || '5', 10),
        unit: 'GB',
      },
      {
        key: 'seats',
        label: 'Seats',
        used: Number.parseInt(process.env.BILLING_DEMO_SEATS_USED || '1', 10),
        limit: Number.parseInt(process.env.BILLING_DEMO_SEATS_LIMIT || '1', 10),
        unit: 'seats',
      },
    ],
    paymentMethod:
      process.env.BILLING_DEMO_PAYMENT_LAST4 && process.env.BILLING_DEMO_PAYMENT_BRAND
        ? {
            brand: process.env.BILLING_DEMO_PAYMENT_BRAND,
            last4: process.env.BILLING_DEMO_PAYMENT_LAST4,
            expMonth: Number.parseInt(process.env.BILLING_DEMO_PAYMENT_EXP_MONTH || '1', 10),
            expYear: Number.parseInt(process.env.BILLING_DEMO_PAYMENT_EXP_YEAR || '2030', 10),
            email: actor.user.email,
          }
        : null,
  };

  return NextResponse.json(response);
}
