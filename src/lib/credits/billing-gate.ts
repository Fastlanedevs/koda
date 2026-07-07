import { NextResponse } from 'next/server';

export const BILLING_REQUIRED_ERROR = 'BILLING_REQUIRED';
export const BILLING_REQUIRED_MESSAGE =
  'Choose a paid plan to continue generating.';

const FREE_PLAN_KEYS = new Set(['free_user', 'free_plan']);

export function isBillingRequiredForGeneration(planKey: string): boolean {
  return FREE_PLAN_KEYS.has(planKey);
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
