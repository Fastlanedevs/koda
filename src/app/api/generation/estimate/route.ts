import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { estimateCredits, type EstimateCreditsInput } from '@/lib/billing/pricing';

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  const body = (await request.json()) as EstimateCreditsInput;

  if (!body.operationType || !body.modelRef) {
    return NextResponse.json(
      { error: 'operationType and modelRef are required' },
      { status: 400 }
    );
  }

  try {
    const result = await estimateCredits(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Estimate failed' },
      { status: 500 }
    );
  }
}
