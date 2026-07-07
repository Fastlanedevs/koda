import 'server-only';

import { requireActor } from '@/lib/auth/actor';
import { isDevAuthBypassEnabled } from '@/lib/auth/dev-bypass';
import { getOrCreateBalance } from '@/lib/db/credit-queries';
import { billingRequiredResponse, isBillingRequiredForGeneration, resolvePlanKey } from './server-balance';

export async function requirePaidGenerationAccess(): Promise<
  | { ok: true; userId: string; planKey: string }
  | { ok: false; response: Response }
> {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult;

  const userId = actorResult.actor.user.id;
  const planKey = await resolvePlanKey();

  await getOrCreateBalance(userId, planKey);

  if (!isDevAuthBypassEnabled() && isBillingRequiredForGeneration(planKey)) {
    return { ok: false, response: billingRequiredResponse() };
  }

  return { ok: true, userId, planKey };
}
