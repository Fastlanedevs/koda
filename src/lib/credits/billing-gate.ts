import { NextResponse } from 'next/server';

export const BILLING_REQUIRED_ERROR = 'BILLING_REQUIRED';
export const BILLING_REQUIRED_MESSAGE =
  'Add a payment method to start your free trial and continue generating.';

export function isBillingRequiredForGeneration(planKey: string): boolean {
  return planKey === 'free_user';
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
