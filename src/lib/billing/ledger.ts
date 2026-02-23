import 'server-only';

import { randomUUID } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getDatabaseAsync } from '@/lib/db';
import { creditLedgerEntries, creditReservations } from '@/lib/db/schema';
import { computeSettlement } from '@/lib/billing/settlement';

export type LedgerTxnType =
  | 'credit_grant_subscription'
  | 'credit_grant_topup'
  | 'credit_grant_promo'
  | 'credit_reserve'
  | 'credit_capture'
  | 'credit_release'
  | 'credit_refund'
  | 'credit_reversal'
  | 'credit_adjustment_admin'
  | 'debt_recorded';

export interface LedgerAppendInput {
  billingAccountId: string;
  txnType: LedgerTxnType;
  amountCredits: number;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  requestId?: string;
  reasonCode?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  bucketId?: string;
}

export interface CreditBalance {
  availableCredits: number;
  reservedCredits: number;
  totalCredits: number;
}

export interface ReserveCreditsInput {
  billingAccountId: string;
  jobId: string;
  amountCredits: number;
  pricingVersionId: string;
  idempotencyKey: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SettleReservationInput {
  billingAccountId: string;
  jobId: string;
  actualCredits: number;
  idempotencyKeyPrefix: string;
  metadata?: Record<string, unknown>;
}

function toJsonString(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value ?? {});
}

export async function appendLedgerEntry(input: LedgerAppendInput) {
  const db = await getDatabaseAsync();

  const [existing] = await db
    .select()
    .from(creditLedgerEntries)
    .where(
      and(
        eq(creditLedgerEntries.idempotencyKey, input.idempotencyKey),
        eq(creditLedgerEntries.referenceType, input.referenceType),
        eq(creditLedgerEntries.referenceId, input.referenceId)
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();
  const created = {
    id: randomUUID(),
    billingAccountId: input.billingAccountId,
    bucketId: input.bucketId ?? null,
    txnType: input.txnType,
    amountCredits: Math.trunc(input.amountCredits),
    idempotencyKey: input.idempotencyKey,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    requestId: input.requestId ?? null,
    reasonCode: input.reasonCode ?? null,
    metadataJson: toJsonString(input.metadata),
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  };

  await db.insert(creditLedgerEntries).values(created);

  const [row] = await db.select().from(creditLedgerEntries).where(eq(creditLedgerEntries.id, created.id)).limit(1);
  if (!row) {
    throw new Error('Failed to append ledger entry');
  }
  return row;
}

export async function getCreditBalance(billingAccountId: string): Promise<CreditBalance> {
  const db = await getDatabaseAsync();
  const ledgerRows = await db
    .select({ amountCredits: creditLedgerEntries.amountCredits })
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.billingAccountId, billingAccountId));

  const totalCredits = ledgerRows.reduce(
    (sum: number, row: { amountCredits: number }) => sum + row.amountCredits,
    0
  );

  const reservations = await db
    .select({ reserved: creditReservations.reservedCredits, captured: creditReservations.capturedCredits, released: creditReservations.releasedCredits })
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.billingAccountId, billingAccountId),
        eq(creditReservations.status, 'active')
      )
    );

  const reservedCredits = reservations.reduce(
    (sum: number, row: { reserved: number; captured: number; released: number }) => {
      const open = row.reserved - row.captured - row.released;
      return sum + Math.max(0, open);
    },
    0
  );

  const availableCredits = totalCredits - reservedCredits;

  return {
    totalCredits,
    reservedCredits,
    availableCredits,
  };
}

export async function reserveCredits(input: ReserveCreditsInput) {
  const db = await getDatabaseAsync();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 1000 * 60 * 30));

  const [existing] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.jobId, input.jobId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const balance = await getCreditBalance(input.billingAccountId);
  if (balance.availableCredits < input.amountCredits) {
    const error = new Error('Insufficient credits');
    error.name = 'INSUFFICIENT_CREDITS';
    throw error;
  }

  const reservation = {
    id: randomUUID(),
    billingAccountId: input.billingAccountId,
    jobId: input.jobId,
    pricingVersionId: input.pricingVersionId,
    reservedCredits: Math.trunc(input.amountCredits),
    capturedCredits: 0,
    releasedCredits: 0,
    status: 'active',
    expiresAt,
    createdAt: now,
    updatedAt: now,
  } as const;

  await db.transaction(async (tx: any) => {
    await tx.insert(creditReservations).values(reservation);

    await tx.insert(creditLedgerEntries).values({
      id: randomUUID(),
      billingAccountId: input.billingAccountId,
      bucketId: null,
      txnType: 'credit_reserve',
      amountCredits: 0,
      idempotencyKey: input.idempotencyKey,
      referenceType: 'job',
      referenceId: input.jobId,
      requestId: null,
      reasonCode: null,
      metadataJson: toJsonString({ reservedCredits: input.amountCredits, ...(input.metadata ?? {}) }),
      occurredAt: now,
      createdAt: now,
    });
  });

  return reservation;
}

export async function settleReservation(input: SettleReservationInput) {
  const db = await getDatabaseAsync();
  const [reservation] = await db
    .select()
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.billingAccountId, input.billingAccountId),
        eq(creditReservations.jobId, input.jobId)
      )
    )
    .limit(1);

  if (!reservation) {
    throw new Error('Reservation not found');
  }

  const settlement = computeSettlement(reservation.reservedCredits, input.actualCredits);
  if (reservation.status !== 'active') {
    return {
      reservation,
      capturedCredits: reservation.capturedCredits,
      releasedCredits: reservation.releasedCredits,
      overflowCredits: settlement.overflow,
    };
  }

  const now = new Date();
  const release = settlement.release;
  const capture = settlement.capture;
  const overflow = settlement.overflow;

  await db.transaction(async (tx: any) => {
    await tx
      .update(creditReservations)
      .set({
        capturedCredits: capture,
        releasedCredits: release,
        status: release > 0 ? 'released' : 'captured',
        updatedAt: now,
      })
      .where(eq(creditReservations.id, reservation.id));

    await tx.insert(creditLedgerEntries).values({
      id: randomUUID(),
      billingAccountId: input.billingAccountId,
      bucketId: null,
      txnType: 'credit_capture',
      amountCredits: -capture,
      idempotencyKey: `${input.idempotencyKeyPrefix}:capture:v1`,
      referenceType: 'job',
      referenceId: input.jobId,
      requestId: null,
      reasonCode: 'SETTLED_SUCCESS',
      metadataJson: toJsonString(input.metadata),
      occurredAt: now,
      createdAt: now,
    });

    if (overflow > 0) {
      await tx.insert(creditLedgerEntries).values({
        id: randomUUID(),
        billingAccountId: input.billingAccountId,
        bucketId: null,
        txnType: 'debt_recorded',
        amountCredits: -overflow,
        idempotencyKey: `${input.idempotencyKeyPrefix}:overflow:v1`,
        referenceType: 'job',
        referenceId: input.jobId,
        requestId: null,
        reasonCode: 'SETTLED_PARTIAL',
        metadataJson: toJsonString({ overflowCredits: overflow, ...(input.metadata ?? {}) }),
        occurredAt: now,
        createdAt: now,
      });
    }

    if (release > 0) {
      await tx.insert(creditLedgerEntries).values({
        id: randomUUID(),
        billingAccountId: input.billingAccountId,
        bucketId: null,
        txnType: 'credit_release',
        amountCredits: 0,
        idempotencyKey: `${input.idempotencyKeyPrefix}:release:v1`,
        referenceType: 'job',
        referenceId: input.jobId,
        requestId: null,
        reasonCode: 'SETTLED_PARTIAL',
        metadataJson: toJsonString({ releasedCredits: release }),
        occurredAt: now,
        createdAt: now,
      });
    }
  });

  const [updated] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, reservation.id))
    .limit(1);

  if (!updated) {
    throw new Error('Reservation settlement failed');
  }

  return {
    reservation: updated,
    capturedCredits: capture,
    releasedCredits: release,
    overflowCredits: overflow,
  };
}

export async function releaseReservation(input: {
  billingAccountId: string;
  jobId: string;
  idempotencyKeyPrefix: string;
}) {
  const db = await getDatabaseAsync();
  const [reservation] = await db
    .select()
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.billingAccountId, input.billingAccountId),
        eq(creditReservations.jobId, input.jobId)
      )
    )
    .limit(1);

  if (!reservation) {
    return null;
  }

  if (reservation.status !== 'active') {
    return reservation;
  }

  const remaining = Math.max(0, reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits);
  const now = new Date();

  await db.transaction(async (tx: any) => {
    await tx
      .update(creditReservations)
      .set({
        releasedCredits: reservation.releasedCredits + remaining,
        status: 'released',
        updatedAt: now,
      })
      .where(eq(creditReservations.id, reservation.id));

    await tx.insert(creditLedgerEntries).values({
      id: randomUUID(),
      billingAccountId: input.billingAccountId,
      bucketId: null,
      txnType: 'credit_release',
      amountCredits: 0,
      idempotencyKey: `${input.idempotencyKeyPrefix}:manual-release:v1`,
      referenceType: 'job',
      referenceId: input.jobId,
      requestId: null,
      reasonCode: 'FAILED_PROVIDER',
      metadataJson: toJsonString({ releasedCredits: remaining }),
      occurredAt: now,
      createdAt: now,
    });
  });

  const [updated] = await db.select().from(creditReservations).where(eq(creditReservations.id, reservation.id)).limit(1);
  return updated ?? null;
}

export async function listLedgerEntries(billingAccountId: string, limit = 50) {
  const db = await getDatabaseAsync();
  return db
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.billingAccountId, billingAccountId))
    .orderBy(asc(creditLedgerEntries.occurredAt))
    .limit(Math.max(1, Math.min(limit, 200)));
}
