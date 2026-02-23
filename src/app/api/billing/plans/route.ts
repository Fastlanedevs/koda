import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { listPlanCatalog } from '@/lib/billing/subscriptions';

export async function GET() {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const plans = await listPlanCatalog();
  return NextResponse.json({ plans });
}
