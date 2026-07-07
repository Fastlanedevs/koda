import { auth, clerkClient } from '@clerk/nextjs/server';
import { PLAN_KEYS } from './costs';
import { getOrCreateBalance } from '../db/credit-queries';
import {
  coercePaidPlanOverride,
  MANUAL_PLAN_OVERRIDE_METADATA_KEY,
} from './billing-gate';
export {
  BILLING_REQUIRED_ERROR,
  BILLING_REQUIRED_MESSAGE,
  billingRequiredResponse,
  coercePaidPlanOverride,
  isBillingRequiredForGeneration,
  MANUAL_PLAN_OVERRIDE_METADATA_KEY,
} from './billing-gate';

async function resolveManualPlanOverride(clerkUserId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const privateMetadata = user.privateMetadata as Record<string, unknown>;
    const publicMetadata = user.publicMetadata as Record<string, unknown>;

    return (
      coercePaidPlanOverride(privateMetadata[MANUAL_PLAN_OVERRIDE_METADATA_KEY])
      ?? coercePaidPlanOverride(publicMetadata[MANUAL_PLAN_OVERRIDE_METADATA_KEY])
    );
  } catch (error) {
    console.warn('[billing] Failed to resolve manual plan override:', error);
    return null;
  }
}

export async function resolvePlanKey(): Promise<string> {
  const { has, userId } = await auth();
  if (!has) return 'free_user';

  for (const plan of PLAN_KEYS) {
    if (plan === 'free_user' || plan === 'free_plan') continue;
    if (has({ plan })) return plan;
  }

  if (userId) {
    const overridePlan = await resolveManualPlanOverride(userId);
    if (overridePlan) return overridePlan;
  }

  return 'free_user';
}

export async function getCurrentCreditBalance(userId: string) {
  const planKey = await resolvePlanKey();
  return getOrCreateBalance(userId, planKey);
}
