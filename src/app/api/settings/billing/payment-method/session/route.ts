import 'server-only';

import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';

export async function POST() {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  return NextResponse.json({
    ok: true,
    mode: 'provider_hosted',
    redirectUrl: '/settings?tab=billing&section=payment-method',
  });
}
