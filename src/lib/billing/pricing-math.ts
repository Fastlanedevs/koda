export interface PricingMathRule {
  baseCredits: number;
  perSecondCredits?: number;
  resolutionMultiplier?: Record<string, number>;
  tierMultiplier?: number;
}

export interface PricingMathInput {
  operationType: 'image.generate' | 'video.generate';
  imageCount?: number;
  durationSeconds?: number;
  resolution?: string;
}

function resolveResolutionMultiplier(rule: PricingMathRule, resolution?: string) {
  if (!rule.resolutionMultiplier) return 1;
  if (resolution && rule.resolutionMultiplier[resolution] !== undefined) {
    return rule.resolutionMultiplier[resolution] ?? 1;
  }
  return rule.resolutionMultiplier.default ?? 1;
}

export function estimateCreditsFromRuleMath(rule: PricingMathRule, input: PricingMathInput) {
  const base = rule.baseCredits;
  const perSecond = rule.perSecondCredits ?? 0;
  const duration = Math.max(1, Math.trunc(input.durationSeconds ?? 1));
  const imageCount = Math.max(1, Math.trunc(input.imageCount ?? 1));
  const resolutionMultiplier = resolveResolutionMultiplier(rule, input.resolution);
  const tierMultiplier = rule.tierMultiplier ?? 1;

  const variable = input.operationType === 'video.generate' ? perSecond * duration : 0;
  const subtotal = (base + variable) * resolutionMultiplier * tierMultiplier;
  const total = input.operationType === 'image.generate' ? subtotal * imageCount : subtotal;

  return Math.max(1, Math.ceil(total));
}
