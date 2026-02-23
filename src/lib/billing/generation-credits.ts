import 'server-only';

import { randomUUID } from 'crypto';
import { requireActor } from '@/lib/auth/actor';
import { ensureBillingAccountForWorkspace } from '@/lib/billing/accounts';
import { resolveActorWorkspace } from '@/lib/billing/context';
import { estimateCredits } from '@/lib/billing/pricing';
import { releaseReservation, reserveCredits, settleReservation } from '@/lib/billing/ledger';
import { getCreditsEnforcementMode, isBillingEnabled, isCreditsMeteringEnabled } from '@/lib/flags';

export interface GenerationCreditContext {
  enabled: boolean;
  enforced: boolean;
  reservationJobId: string;
  billingAccountId?: string;
  estimatedCredits?: number;
  pricingVersionId?: string;
  idempotencyBase?: string;
}

export async function authorizeGenerationCredits(input: {
  workspaceId?: string;
  operationType: 'image.generate' | 'video.generate';
  modelRef: string;
  imageCount?: number;
  durationSeconds?: number;
  resolution?: string;
  metadata?: Record<string, unknown>;
}): Promise<GenerationCreditContext> {
  const mode = getCreditsEnforcementMode();
  const meteringEnabled = isBillingEnabled() && isCreditsMeteringEnabled() && mode !== 'off';

  const reservationJobId = `job_${randomUUID()}`;

  if (!meteringEnabled) {
    return {
      enabled: false,
      enforced: false,
      reservationJobId,
    };
  }

  const actorResult = await requireActor();
  if (!actorResult.ok) {
    if (mode === 'hard') {
      throw new Error('Unauthorized for credit-checked generation');
    }

    return {
      enabled: true,
      enforced: false,
      reservationJobId,
    };
  }

  const activeWorkspace = resolveActorWorkspace(actorResult.actor, input.workspaceId ?? null);
  if (!activeWorkspace) {
    throw new Error('Workspace not found for metering');
  }

  const account = await ensureBillingAccountForWorkspace(activeWorkspace.workspaceId);
  const estimate = await estimateCredits({
    operationType: input.operationType,
    modelRef: input.modelRef,
    imageCount: input.imageCount,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
  });

  const enforced = mode === 'soft' || mode === 'hard';
  const idempotencyBase = `credits:reserve:${reservationJobId}:${randomUUID()}`;

  if (enforced) {
    await reserveCredits({
      billingAccountId: account.id,
      jobId: reservationJobId,
      amountCredits: estimate.estimatedCredits,
      pricingVersionId: estimate.pricingVersionId,
      idempotencyKey: `${idempotencyBase}:v1`,
      metadata: {
        operationType: input.operationType,
        modelRef: input.modelRef,
        ...(input.metadata ?? {}),
      },
    });
  }

  return {
    enabled: true,
    enforced,
    reservationJobId,
    billingAccountId: account.id,
    estimatedCredits: estimate.estimatedCredits,
    pricingVersionId: estimate.pricingVersionId,
    idempotencyBase,
  };
}

export async function settleGenerationCredits(input: {
  context: GenerationCreditContext;
  actualCredits?: number;
  metadata?: Record<string, unknown>;
}) {
  if (!input.context.enabled || !input.context.enforced) {
    return null;
  }

  if (!input.context.billingAccountId || !input.context.idempotencyBase) {
    return null;
  }

  return settleReservation({
    billingAccountId: input.context.billingAccountId,
    jobId: input.context.reservationJobId,
    actualCredits: input.actualCredits ?? input.context.estimatedCredits ?? 0,
    idempotencyKeyPrefix: input.context.idempotencyBase,
    metadata: input.metadata,
  });
}

export async function releaseGenerationCredits(input: { context: GenerationCreditContext }) {
  if (!input.context.enabled || !input.context.enforced) {
    return null;
  }

  if (!input.context.billingAccountId || !input.context.idempotencyBase) {
    return null;
  }

  return releaseReservation({
    billingAccountId: input.context.billingAccountId,
    jobId: input.context.reservationJobId,
    idempotencyKeyPrefix: input.context.idempotencyBase,
  });
}
