import { NextResponse } from 'next/server';
import { PLAN_KEYS } from './costs';

export const BILLING_REQUIRED_ERROR = 'BILLING_REQUIRED';
export const BILLING_REQUIRED_MESSAGE =
  'Choose a paid plan to continue generating.';
export const MANUAL_PLAN_OVERRIDE_METADATA_KEY = 'kodaPlanOverride';

const FREE_PLAN_KEYS = new Set(['free_user', 'free_plan']);

export function isBillingRequiredForGeneration(planKey: string): boolean {
  return FREE_PLAN_KEYS.has(planKey);
}

export function coercePaidPlanOverride(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const planKey = value.trim();
  if (FREE_PLAN_KEYS.has(planKey)) return null;
  return (PLAN_KEYS as readonly string[]).includes(planKey) ? planKey : null;
}

export function billingRequiredResponse(): Response {
  return NextResponse.json(
    {
      error: BILLING_REQUIRED_ERROR,
      message: BILLING_REQUIRED_MESSAGE,
      required: null,
      balance: null,
    },
    { status: 402 }
  );
}
