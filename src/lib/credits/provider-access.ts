export const SEEDANCE_BILLING_REQUIRED_MESSAGE =
  'Seedance generation requires a paid plan. Add a paid subscription before using this provider.';

const SEEDANCE_MODEL_PREFIX = 'seedance-';
const SEEDANCE_ALLOWED_PLAN_KEYS = new Set(['basic_user', 'pro_user', 'pro_plus_user']);

export function isSeedanceModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith(SEEDANCE_MODEL_PREFIX);
}

export function canUseSeedance(planKey: string): boolean {
  return SEEDANCE_ALLOWED_PLAN_KEYS.has(planKey);
}

export function seedanceBillingRequiredPayload() {
  return {
    error: 'BILLING_REQUIRED',
    code: 'BILLING_REQUIRED',
    message: SEEDANCE_BILLING_REQUIRED_MESSAGE,
    provider: 'seedance',
  };
}
