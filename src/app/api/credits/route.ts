import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireActor } from '@/lib/auth/actor';
import { getOrCreateBalance } from '@/lib/db/credit-queries';
import { PLAN_KEYS } from '@/lib/credits/costs';

async function resolvePlanKey(): Promise<string> {
  const { has } = await auth();
  if (!has) return 'free_user';

  for (const plan of PLAN_KEYS) {
    if (plan === 'free_user') continue;
    if (has({ plan })) return plan;
  }
  return 'free_user';
}

export async function GET() {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const userId = actorResult.actor.user.id;
  const planKey = await resolvePlanKey();
  const balance = await getOrCreateBalance(userId, planKey);

  return NextResponse.json({
    balance: balance.balance,
    planKey: balance.planKey,
    creditsPerMonth: balance.creditsPerMonth,
    lifetimeUsed: balance.lifetimeUsed,
    periodStart: balance.periodStart,
  });
}
