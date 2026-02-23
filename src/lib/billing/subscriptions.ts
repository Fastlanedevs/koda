import 'server-only';

import { createHash, randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabaseAsync } from '@/lib/db';
import {
  entitlementPolicies,
  externalBillingEvents,
  plans,
  subscriptions,
  subscriptionCycleGrants,
} from '@/lib/db/schema';
import { appendLedgerEntry } from '@/lib/billing/ledger';

const PLAN_CATALOG = [
  { code: 'free', name: 'Free', priceMinor: 0, monthlyCredits: 100 },
  { code: 'starter', name: 'Starter', priceMinor: 1900, monthlyCredits: 2500 },
  { code: 'pro', name: 'Pro', priceMinor: 4900, monthlyCredits: 8000 },
  { code: 'team', name: 'Team', priceMinor: 19900, monthlyCredits: 40000 },
] as const;

export async function ensurePlanCatalogSeed() {
  const db = await getDatabaseAsync();
  const now = new Date();

  for (const item of PLAN_CATALOG) {
    const [existing] = await db.select().from(plans).where(eq(plans.planCode, item.code)).limit(1);

    const planId = existing?.id ?? randomUUID();

    await db
      .insert(plans)
      .values({
        id: planId,
        planCode: item.code,
        displayName: item.name,
        billingInterval: 'month',
        priceMinor: item.priceMinor,
        currency: 'USD',
        monthlyCredits: item.monthlyCredits,
        active: true,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: plans.planCode,
        set: {
          displayName: item.name,
          priceMinor: item.priceMinor,
          monthlyCredits: item.monthlyCredits,
          active: true,
        },
      });

    const [policy] = await db
      .select()
      .from(entitlementPolicies)
      .where(and(eq(entitlementPolicies.planId, planId), eq(entitlementPolicies.version, 1)))
      .limit(1);

    if (!policy) {
      await db.insert(entitlementPolicies).values({
        id: randomUUID(),
        planId,
        version: 1,
        effectiveFrom: now,
        effectiveTo: null,
        policyJson: JSON.stringify({
          max_concurrent_jobs: item.code === 'free' ? 1 : item.code === 'starter' ? 2 : 4,
          allowed_model_tiers: item.code === 'free' ? ['standard'] : ['standard', 'premium'],
          max_video_duration_seconds: item.code === 'free' ? 6 : 12,
          overage_allowed: item.code !== 'free',
        }),
        createdAt: now,
      });
    }
  }
}

export async function listPlanCatalog() {
  await ensurePlanCatalogSeed();
  const db = await getDatabaseAsync();
  return db.select().from(plans).where(eq(plans.active, true));
}

export async function getActiveSubscriptionForBillingAccount(billingAccountId: string) {
  const db = await getDatabaseAsync();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.billingAccountId, billingAccountId))
    .limit(1);

  return row ?? null;
}

export interface WebhookLifecycleEvent {
  authority: 'clerk' | 'stripe';
  authorityEventId: string;
  eventType: string;
  billingAccountId: string;
  subscriptionId: string;
  planCode: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd?: boolean;
  grantCredits?: number;
  cycleStart?: string;
  cycleEnd?: string;
  payload: Record<string, unknown>;
}

function payloadHash(payload: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function processSubscriptionLifecycleWebhook(event: WebhookLifecycleEvent) {
  await ensurePlanCatalogSeed();
  const db = await getDatabaseAsync();
  const now = new Date();

  const [existingEvent] = await db
    .select()
    .from(externalBillingEvents)
    .where(
      and(
        eq(externalBillingEvents.authority, event.authority),
        eq(externalBillingEvents.authorityEventId, event.authorityEventId)
      )
    )
    .limit(1);

  if (existingEvent) {
    return { deduped: true, eventId: existingEvent.id };
  }

  const [plan] = await db.select().from(plans).where(eq(plans.planCode, event.planCode)).limit(1);
  if (!plan) {
    throw new Error(`Unknown plan code: ${event.planCode}`);
  }

  const externalEventId = randomUUID();
  await db.insert(externalBillingEvents).values({
    id: externalEventId,
    authority: event.authority,
    authorityEventId: event.authorityEventId,
    eventType: event.eventType,
    billingAccountId: event.billingAccountId,
    payloadHash: payloadHash(event.payload),
    payloadJson: JSON.stringify(event.payload),
    status: 'received',
    errorCode: null,
    receivedAt: now,
    processedAt: null,
  });

  await db
    .insert(subscriptions)
    .values({
      id: event.subscriptionId,
      billingAccountId: event.billingAccountId,
      planId: plan.id,
      authority: event.authority,
      authoritySubscriptionId: event.subscriptionId,
      status: event.status,
      currentPeriodStart: new Date(event.currentPeriodStart),
      currentPeriodEnd: new Date(event.currentPeriodEnd),
      cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.id,
      set: {
        planId: plan.id,
        status: event.status,
        currentPeriodStart: new Date(event.currentPeriodStart),
        currentPeriodEnd: new Date(event.currentPeriodEnd),
        cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
        updatedAt: now,
      },
    });

  if (event.grantCredits && event.grantCredits > 0 && event.cycleStart && event.cycleEnd) {
    const [existingGrant] = await db
      .select()
      .from(subscriptionCycleGrants)
      .where(
        and(
          eq(subscriptionCycleGrants.subscriptionId, event.subscriptionId),
          eq(subscriptionCycleGrants.cycleStart, new Date(event.cycleStart)),
          eq(subscriptionCycleGrants.cycleEnd, new Date(event.cycleEnd))
        )
      )
      .limit(1);

    if (!existingGrant) {
      const ledger = await appendLedgerEntry({
        billingAccountId: event.billingAccountId,
        txnType: 'credit_grant_subscription',
        amountCredits: event.grantCredits,
        idempotencyKey: `billing:grant:${event.subscriptionId}:${event.authorityEventId}:v1`,
        referenceType: 'subscription_cycle',
        referenceId: `${event.subscriptionId}:${event.cycleStart}`,
        metadata: {
          planCode: event.planCode,
          cycleStart: event.cycleStart,
          cycleEnd: event.cycleEnd,
        },
      });

      await db.insert(subscriptionCycleGrants).values({
        id: randomUUID(),
        subscriptionId: event.subscriptionId,
        cycleStart: new Date(event.cycleStart),
        cycleEnd: new Date(event.cycleEnd),
        grantedCredits: event.grantCredits,
        grantLedgerTxnId: ledger.id,
        createdAt: now,
      });
    }
  }

  await db
    .update(externalBillingEvents)
    .set({
      status: 'processed',
      processedAt: now,
    })
    .where(eq(externalBillingEvents.id, externalEventId));

  return { deduped: false, eventId: externalEventId };
}
