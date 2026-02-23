import 'server-only';

import { NextResponse } from 'next/server';
import {
  parseBillingSubscriptionWebhookPayload,
  validateBillingWebhookRequest,
} from '@/lib/billing/webhook-validation';
import { processSubscriptionLifecycleWebhook } from '@/lib/billing/subscriptions';

export async function POST(request: Request) {
  const payload = await request.text();
  const signatureHeader = request.headers.get('x-billing-signature');

  const validation = validateBillingWebhookRequest({
    payload,
    signatureHeader,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  const parsedBody = parseBillingSubscriptionWebhookPayload(payload);
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error, details: parsedBody.details }, { status: parsedBody.status });
  }

  const body = parsedBody.payload;

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
    payload: body as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, ...result });
}
