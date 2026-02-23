import 'server-only';

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { getCreditBalance } from '@/lib/billing/ledger';
import { ensurePlanCatalogSeed } from '@/lib/billing/subscriptions';
import { getDatabaseAsync } from '@/lib/db';
import { plans, subscriptions, workspaceMembers, workspaces } from '@/lib/db/schema';
import type { BillingOverviewResponse } from '@/lib/billing/types';

function mapSubscriptionStatus(status: string): BillingOverviewResponse['plan']['status'] {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'payment_failed';
    case 'canceled':
      return 'canceled';
    case 'expired':
      return 'expired';
    default:
      return 'active';
  }
}

export async function GET(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  await ensurePlanCatalogSeed();

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

  const billingAccount = await ensureBillingAccountForWorkspace(workspaceRow.workspaceId);
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.billingAccountId, billingAccount.id))
    .limit(1);

  const [plan] = subscription
    ? await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1)
    : await db.select().from(plans).where(eq(plans.planCode, 'free')).limit(1);

  const balance = await getCreditBalance(billingAccount.id);

  const isOwner = workspaceRow.membershipRole === 'owner';
  const monthlyCredits = plan?.monthlyCredits ?? 100;
  const response: BillingOverviewResponse = {
    workspaceId: workspaceRow.workspaceId,
    workspaceName: workspaceRow.workspaceName,
    role: workspaceRow.membershipRole ?? 'viewer',
    isOwner,
    ownerNotice: isOwner ? undefined : 'Only workspace owners can manage billing. Contact your workspace owner.',
    plan: {
      code: (plan?.planCode as BillingOverviewResponse['plan']['code']) ?? 'free',
      name: plan?.displayName ?? 'Free',
      interval: 'month',
      priceLabel: `$${((plan?.priceMinor ?? 0) / 100).toFixed(0)} / month`,
      currency: plan?.currency ?? 'USD',
      renewalDate: subscription?.currentPeriodEnd?.toISOString() ?? null,
      status: subscription ? mapSubscriptionStatus(subscription.status) : 'active',
      trialEndsAt: null,
      canceledAt: subscription?.cancelAtPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    },
    usage: [
      {
        key: 'credits',
        label: 'Monthly credits',
        used: Math.max(0, monthlyCredits - Math.max(0, balance.availableCredits)),
        limit: monthlyCredits,
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
