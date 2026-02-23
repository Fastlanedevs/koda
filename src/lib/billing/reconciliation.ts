import 'server-only';

import { randomUUID } from 'crypto';
import { and, eq, lt } from 'drizzle-orm';
import { finalizeTimedOutAsyncSettlements } from '@/lib/billing/async-settlement';
import { getDatabaseAsync } from '@/lib/db';
import {
  creditReservations,
  reconciliationItems,
  reconciliationRuns,
  subscriptions,
  subscriptionCycleGrants,
} from '@/lib/db/schema';

export async function runBillingReconciliation(options?: { repairEnabled?: boolean }) {
  const db = await getDatabaseAsync();
  const now = new Date();
  const runId = randomUUID();
  let mismatchCount = 0;
  let repairCount = 0;

  await db.insert(reconciliationRuns).values({
    id: runId,
    jobName: 'daily_billing_reconciliation',
    windowStart: new Date(now.getTime() - 1000 * 60 * 60 * 24),
    windowEnd: now,
    status: 'ok',
    mismatchCount: 0,
    repairCount: 0,
    startedAt: now,
    finishedAt: null,
  });

  const staleReservations = await db
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.status, 'active'), lt(creditReservations.expiresAt, now)));

  for (const reservation of staleReservations) {
    mismatchCount += 1;

    await db.insert(reconciliationItems).values({
      id: randomUUID(),
      runId,
      itemKey: `reservation:${reservation.id}`,
      severity: 'SEV-2',
      category: 'stale_reservation',
      detailsJson: JSON.stringify({
        reservationId: reservation.id,
        expiresAt: reservation.expiresAt.toISOString(),
      }),
      repairAction: options?.repairEnabled ? 'expire_reservation' : 'none',
      repairStatus: options?.repairEnabled ? 'completed' : 'skipped',
      createdAt: now,
    });

    if (options?.repairEnabled) {
      await db
        .update(creditReservations)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(creditReservations.id, reservation.id));
      repairCount += 1;
    }
  }

  if (options?.repairEnabled) {
    const asyncSweep = await finalizeTimedOutAsyncSettlements(500);
    if (asyncSweep.scanned > 0) {
      mismatchCount += asyncSweep.scanned;
      repairCount += asyncSweep.processed;

      await db.insert(reconciliationItems).values({
        id: randomUUID(),
        runId,
        itemKey: `async-timeout:${runId}`,
        severity: asyncSweep.processed > 0 ? 'SEV-2' : 'SEV-3',
        category: 'async_settlement_timeout',
        detailsJson: JSON.stringify(asyncSweep),
        repairAction: 'release_reservation',
        repairStatus: asyncSweep.processed > 0 ? 'completed' : 'skipped',
        createdAt: now,
      });
    }
  }

  const subs = await db.select().from(subscriptions);
  for (const subscription of subs) {
    const [grant] = await db
      .select()
      .from(subscriptionCycleGrants)
      .where(eq(subscriptionCycleGrants.subscriptionId, subscription.id))
      .limit(1);

    if (!grant && subscription.status === 'active') {
      mismatchCount += 1;
      await db.insert(reconciliationItems).values({
        id: randomUUID(),
        runId,
        itemKey: `grant:${subscription.id}`,
        severity: 'SEV-1',
        category: 'missing_subscription_grant',
        detailsJson: JSON.stringify({ subscriptionId: subscription.id }),
        repairAction: 'manual_review',
        repairStatus: 'pending',
        createdAt: now,
      });
    }
  }

  await db
    .update(reconciliationRuns)
    .set({
      status: mismatchCount > 0 ? 'warn' : 'ok',
      mismatchCount,
      repairCount,
      finishedAt: new Date(),
    })
    .where(eq(reconciliationRuns.id, runId));

  return {
    runId,
    mismatchCount,
    repairCount,
  };
}
