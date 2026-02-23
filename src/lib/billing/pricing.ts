import 'server-only';

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { getDatabaseAsync } from '@/lib/db';
import { costRules, pricingVersions } from '@/lib/db/schema';
import { estimateCreditsFromRuleMath } from '@/lib/billing/pricing-math';

export type MeteringOperation = 'image.generate' | 'video.generate';

export interface PricingRule {
  id: string;
  provider: 'fal';
  operationType: MeteringOperation;
  modelRef: string;
  baseCredits: number;
  perSecondCredits?: number;
  resolutionMultiplier?: Record<string, number>;
  tierMultiplier?: number;
}

export interface EstimateCreditsInput {
  provider?: 'fal';
  operationType: MeteringOperation;
  modelRef: string;
  imageCount?: number;
  durationSeconds?: number;
  resolution?: string;
}

export const DEFAULT_PRICING_VERSION_CODE = 'pricing-v1-fal';

const BUILTIN_RULES: PricingRule[] = [
  {
    id: 'fal-image-standard',
    provider: 'fal',
    operationType: 'image.generate',
    modelRef: 'flux-schnell',
    baseCredits: 8,
    tierMultiplier: 1,
    resolutionMultiplier: { default: 1, '2K': 1.5, '4K': 2 },
  },
  {
    id: 'fal-image-premium',
    provider: 'fal',
    operationType: 'image.generate',
    modelRef: 'flux-pro',
    baseCredits: 14,
    tierMultiplier: 1.2,
    resolutionMultiplier: { default: 1, '2K': 1.5, '4K': 2 },
  },
  {
    id: 'fal-image-nanobanana',
    provider: 'fal',
    operationType: 'image.generate',
    modelRef: 'nanobanana-pro',
    baseCredits: 16,
    tierMultiplier: 1.2,
    resolutionMultiplier: { default: 1, '2K': 1.75, '4K': 2.2 },
  },
  {
    id: 'fal-video-standard',
    provider: 'fal',
    operationType: 'video.generate',
    modelRef: 'kling-2.6-t2v',
    baseCredits: 6,
    perSecondCredits: 20,
    resolutionMultiplier: { default: 1, '720p': 1, '1080p': 1.4 },
  },
  {
    id: 'fal-video-premium',
    provider: 'fal',
    operationType: 'video.generate',
    modelRef: 'veo-3',
    baseCredits: 10,
    perSecondCredits: 35,
    resolutionMultiplier: { default: 1.1, '720p': 1.2, '1080p': 1.5 },
  },
];

function resolveRule(rules: PricingRule[], input: EstimateCreditsInput): PricingRule {
  const exact = rules.find(
    (rule) => rule.operationType === input.operationType && rule.modelRef === input.modelRef
  );

  if (exact) return exact;

  const byOperation = rules.find((rule) => rule.operationType === input.operationType);
  if (byOperation) return byOperation;

  throw new Error(`No pricing rule for operation ${input.operationType}`);
}

export function estimateCreditsFromRule(rule: PricingRule, input: EstimateCreditsInput) {
  return estimateCreditsFromRuleMath(rule, input);
}

export async function ensureDefaultPricingSeed() {
  const db = await getDatabaseAsync();

  const [existingVersion] = await db
    .select()
    .from(pricingVersions)
    .where(eq(pricingVersions.versionCode, DEFAULT_PRICING_VERSION_CODE))
    .limit(1);

  if (existingVersion) {
    return existingVersion;
  }

  const now = new Date();
  const versionId = randomUUID();

  await db.transaction(async (tx: any) => {
    await tx.insert(pricingVersions).values({
      id: versionId,
      versionCode: DEFAULT_PRICING_VERSION_CODE,
      status: 'active',
      effectiveFrom: now,
      effectiveTo: null,
      createdAt: now,
    });

    for (const rule of BUILTIN_RULES) {
      await tx.insert(costRules).values({
        id: rule.id,
        pricingVersionId: versionId,
        provider: rule.provider,
        operationType: rule.operationType,
        modelRef: rule.modelRef,
        ruleJson: JSON.stringify(rule),
        createdAt: now,
      });
    }
  });

  const [created] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, versionId)).limit(1);
  if (!created) {
    throw new Error('Failed to seed pricing version');
  }

  return created;
}

export async function getActivePricingRules() {
  const db = await getDatabaseAsync();
  const now = new Date();

  const [activeVersion] = await db
    .select()
    .from(pricingVersions)
    .where(
      and(
        eq(pricingVersions.status, 'active'),
        lte(pricingVersions.effectiveFrom, now),
        or(isNull(pricingVersions.effectiveTo), gte(pricingVersions.effectiveTo, now))
      )
    )
    .orderBy(desc(pricingVersions.effectiveFrom))
    .limit(1);

  if (!activeVersion) {
    await ensureDefaultPricingSeed();
    return { pricingVersionId: DEFAULT_PRICING_VERSION_CODE, rules: BUILTIN_RULES };
  }

  const rows = await db
    .select()
    .from(costRules)
    .where(eq(costRules.pricingVersionId, activeVersion.id));

  if (rows.length === 0) {
    return { pricingVersionId: activeVersion.id, rules: BUILTIN_RULES };
  }

  const parsedRules = rows.map((row: { ruleJson: string }) => JSON.parse(row.ruleJson) as PricingRule);
  return {
    pricingVersionId: activeVersion.id,
    rules: parsedRules,
  };
}

export async function estimateCredits(input: EstimateCreditsInput) {
  const active = await getActivePricingRules();
  const rule = resolveRule(active.rules, input);
  const estimatedCredits = estimateCreditsFromRule(rule, input);

  return {
    estimatedCredits,
    pricingVersionId: active.pricingVersionId,
    costRuleId: rule.id,
    provider: 'fal' as const,
  };
}
