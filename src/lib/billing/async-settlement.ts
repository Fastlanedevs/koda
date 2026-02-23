import { randomUUID } from 'crypto';
import { and, eq, lte } from 'drizzle-orm';
import { toAsyncSettlementStatus } from '@/lib/billing/async-settlement-policy';
import { releaseReservation, settleReservation } from '@/lib/billing/ledger';
import { getDatabaseAsync } from '@/lib/db';
import { asyncCreditSettlements } from '@/lib/db/schema';

const DEFAULT_ASYNC_SETTLEMENT_TTL_MS = 1000 * 60 * 20;
function parseAsyncSettlementTtlMs() {
  const raw = process.env.BILLING_ASYNC_SETTLEMENT_TIMEOUT_MS;
  if (!raw) return DEFAULT_ASYNC_SETTLEMENT_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ASYNC_SETTLEMENT_TTL_MS;
  return parsed;
}

export async function registerAsyncSettlement(input: {
  provider: string;
  externalTaskId: string;
  billingAccountId: string;
  reservationJobId: string;
  idempotencyKeyPrefix: string;
  estimatedCredits: number;
  metadata?: Record<string, unknown>;
  ttlMs?: number;
}) {
  const db = await getDatabaseAsync();
  const [existing] = await db
    .select()
    .from(asyncCreditSettlements)
    .where(
      and(
        eq(asyncCreditSettlements.provider, input.provider),
        eq(asyncCreditSettlements.externalTaskId, input.externalTaskId)
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();
  const ttlMs = input.ttlMs ?? parseAsyncSettlementTtlMs();
  const created = {
    id: randomUUID(),
    provider: input.provider,
    externalTaskId: input.externalTaskId,
    billingAccountId: input.billingAccountId,
    reservationJobId: input.reservationJobId,
    idempotencyKeyPrefix: input.idempotencyKeyPrefix,
    estimatedCredits: Math.max(0, Math.trunc(input.estimatedCredits)),
    status: 'pending',
    failureReason: null,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    expiresAt: new Date(now.getTime() + ttlMs),
    settledAt: null,
    createdAt: now,
    updatedAt: now,
  } as const;

  await db.insert(asyncCreditSettlements).values(created);
  return created;
}

export async function finalizeAsyncSettlement(input: {
  provider: string;
  externalTaskId: string;
  outcome: 'success' | 'failed' | 'timed_out';
  actualCredits?: number;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDatabaseAsync();
  const [row] = await db
    .select()
    .from(asyncCreditSettlements)
    .where(
      and(
        eq(asyncCreditSettlements.provider, input.provider),
        eq(asyncCreditSettlements.externalTaskId, input.externalTaskId)
      )
    )
    .limit(1);

  if (!row) return null;
  if (row.status !== 'pending') return row;

  const now = new Date();

  if (input.outcome === 'success') {
    await settleReservation({
      billingAccountId: row.billingAccountId,
      jobId: row.reservationJobId,
      actualCredits: input.actualCredits ?? row.estimatedCredits,
      idempotencyKeyPrefix: row.idempotencyKeyPrefix,
      metadata: {
        provider: row.provider,
        externalTaskId: row.externalTaskId,
        ...(input.metadata ?? {}),
      },
    });
  } else {
    await releaseReservation({
      billingAccountId: row.billingAccountId,
      jobId: row.reservationJobId,
      idempotencyKeyPrefix: row.idempotencyKeyPrefix,
    });
  }

  await db
    .update(asyncCreditSettlements)
    .set({
      status: toAsyncSettlementStatus(input.outcome),
      failureReason: input.outcome === 'success' ? null : input.failureReason ?? null,
      settledAt: now,
      updatedAt: now,
      metadataJson: JSON.stringify(input.metadata ?? {}),
    })
    .where(eq(asyncCreditSettlements.id, row.id));

  const [updated] = await db.select().from(asyncCreditSettlements).where(eq(asyncCreditSettlements.id, row.id)).limit(1);
  return updated ?? null;
}

export async function finalizeTimedOutAsyncSettlements(limit = 100) {
  const db = await getDatabaseAsync();
  const now = new Date();
  const rows = await db
    .select()
    .from(asyncCreditSettlements)
    .where(and(eq(asyncCreditSettlements.status, 'pending'), lte(asyncCreditSettlements.expiresAt, now)))
    .limit(Math.max(1, Math.min(limit, 500)));

  let processed = 0;
  for (const row of rows) {
    const result = await finalizeAsyncSettlement({
      provider: row.provider,
      externalTaskId: row.externalTaskId,
      outcome: 'timed_out',
      failureReason: 'ASYNC_TASK_TIMEOUT',
    });
    if (result) processed += 1;
  }

  return { processed, scanned: rows.length };
}

export async function finalizeAsyncSettlementIfExpired(input: { provider: string; externalTaskId: string }) {
  const db = await getDatabaseAsync();
  const now = new Date();
  const [row] = await db
    .select()
    .from(asyncCreditSettlements)
    .where(
      and(
        eq(asyncCreditSettlements.provider, input.provider),
        eq(asyncCreditSettlements.externalTaskId, input.externalTaskId)
      )
    )
    .limit(1);

  if (!row || row.status !== 'pending' || row.expiresAt > now) {
    return row ?? null;
  }

  return finalizeAsyncSettlement({
    provider: input.provider,
    externalTaskId: input.externalTaskId,
    outcome: 'timed_out',
    failureReason: 'ASYNC_TASK_TIMEOUT',
  });
}
