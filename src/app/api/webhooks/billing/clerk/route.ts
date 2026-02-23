import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { processSubscriptionLifecycleWebhook } from '@/lib/billing/subscriptions';

function verifyWebhookSignature(payload: string, signature: string | null) {
  const secret = process.env.BILLING_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const digest = createHmac('sha256', secret).update(payload).digest('hex');
  const expected = Buffer.from(digest);
  const received = Buffer.from(signature);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get('x-billing-signature');

  if (!verifyWebhookSignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(payload) as {
    id?: string;
    type?: string;
    data?: {
      billingAccountId?: string;
      subscriptionId?: string;
      planCode?: string;
      status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd?: boolean;
      cycleStart?: string;
      cycleEnd?: string;
      grantCredits?: number;
    };
  };

  if (!body.id || !body.type || !body.data?.billingAccountId || !body.data.subscriptionId || !body.data.planCode) {
    return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 });
  }

  const result = await processSubscriptionLifecycleWebhook({
    authority: 'clerk',
    authorityEventId: body.id,
    eventType: body.type,
    billingAccountId: body.data.billingAccountId,
    subscriptionId: body.data.subscriptionId,
    planCode: body.data.planCode,
    status: body.data.status ?? 'active',
    currentPeriodStart: body.data.currentPeriodStart ?? new Date().toISOString(),
    currentPeriodEnd:
      body.data.currentPeriodEnd ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    cancelAtPeriodEnd: body.data.cancelAtPeriodEnd,
    grantCredits: body.data.grantCredits,
    cycleStart: body.data.cycleStart,
    cycleEnd: body.data.cycleEnd,
    payload: body as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, ...result });
}
