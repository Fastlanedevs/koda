import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import {
  parseBillingSubscriptionWebhookPayload,
  validateBillingWebhookRequest,
} from '@/lib/billing/webhook-validation';

type ClerkWebhookEvent = {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string | null;
  };
};

export type ClerkWebhookIngressKind = 'auth' | 'billing' | 'unknown' | 'ambiguous';

interface HandleClerkWebhookIngressOptions {
  allowAuth?: boolean;
  allowBilling?: boolean;
}

async function emitAuthWebhookMetric(input: {
  metric: 'signup_completion' | 'activation_signup';
  status: 'success' | 'error';
  source: 'webhook';
  errorCode?: string;
  metadata?: Record<string, unknown>;
}) {
  const { emitLaunchMetric } = await import('@/lib/observability/launch-metrics');
  emitLaunchMetric(input);
}

function getPrimaryEmail(data: ClerkWebhookEvent['data']) {
  if (!data.email_addresses?.length) return null;

  if (data.primary_email_address_id) {
    const primary = data.email_addresses.find((email) => email.id === data.primary_email_address_id);

    if (primary?.email_address) return primary.email_address;
  }

  return data.email_addresses[0]?.email_address ?? null;
}

function getSvixHeaders(requestHeaders: Headers) {
  return {
    svixId: requestHeaders.get('svix-id'),
    svixTimestamp: requestHeaders.get('svix-timestamp'),
    svixSignature: requestHeaders.get('svix-signature'),
  };
}

export function detectClerkWebhookIngressKind(requestHeaders: Headers): ClerkWebhookIngressKind {
  const { svixId, svixTimestamp, svixSignature } = getSvixHeaders(requestHeaders);
  const hasAnySvixHeader = Boolean(svixId || svixTimestamp || svixSignature);
  const hasBillingSignature = Boolean(requestHeaders.get('x-billing-signature'));

  if (hasAnySvixHeader && hasBillingSignature) {
    return 'ambiguous';
  }

  if (hasAnySvixHeader) {
    return 'auth';
  }

  if (hasBillingSignature) {
    return 'billing';
  }

  return 'unknown';
}

async function handleAuthWebhook(payload: string, requestHeaders: Headers) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!signingSecret) {
    await emitAuthWebhookMetric({
      metric: 'signup_completion',
      status: 'error',
      source: 'webhook',
      errorCode: 'missing_webhook_secret',
    });
    return NextResponse.json({ error: 'Missing CLERK_WEBHOOK_SIGNING_SECRET' }, { status: 500 });
  }

  const { svixId, svixTimestamp, svixSignature } = getSvixHeaders(requestHeaders);

  if (!svixId || !svixTimestamp || !svixSignature) {
    await emitAuthWebhookMetric({
      metric: 'signup_completion',
      status: 'error',
      source: 'webhook',
      errorCode: 'missing_svix_headers',
    });
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const wh = new Webhook(signingSecret);

  let evt: ClerkWebhookEvent;

  try {
    evt = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch (error) {
    await emitAuthWebhookMetric({
      metric: 'signup_completion',
      status: 'error',
      source: 'webhook',
      errorCode: 'invalid_webhook_signature',
      metadata: { message: String(error) },
    });
    return NextResponse.json(
      { error: 'Invalid webhook signature', details: String(error) },
      { status: 400 }
    );
  }

  const { getDatabaseAsync } = await import('@/lib/db');
  const { users } = await import('@/lib/db/schema');

  const db = await getDatabaseAsync();
  const now = new Date();

  if (evt.type === 'user.deleted') {
    await db.delete(users).where(eq(users.clerkUserId, evt.data.id));
    return NextResponse.json({ ok: true, action: 'deleted' });
  }

  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const email = getPrimaryEmail(evt.data);

    if (!email) {
      await emitAuthWebhookMetric({
        metric: 'signup_completion',
        status: 'error',
        source: 'webhook',
        errorCode: 'missing_email',
        metadata: { eventType: evt.type },
      });
      return NextResponse.json({ error: 'User payload missing email' }, { status: 400 });
    }

    await db
      .insert(users)
      .values({
        id: randomUUID(),
        clerkUserId: evt.data.id,
        email,
        firstName: evt.data.first_name ?? null,
        lastName: evt.data.last_name ?? null,
        imageUrl: evt.data.image_url ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: {
          email,
          firstName: evt.data.first_name ?? null,
          lastName: evt.data.last_name ?? null,
          imageUrl: evt.data.image_url ?? null,
          updatedAt: now,
        },
      });

    if (evt.type === 'user.created') {
      await emitAuthWebhookMetric({
        metric: 'signup_completion',
        status: 'success',
        source: 'webhook',
        metadata: { userId: evt.data.id },
      });
      await emitAuthWebhookMetric({
        metric: 'activation_signup',
        status: 'success',
        source: 'webhook',
        metadata: { userId: evt.data.id },
      });
    }

    return NextResponse.json({ ok: true, action: 'upserted' });
  }

  return NextResponse.json({ ok: true, action: 'ignored' });
}

async function handleBillingWebhook(payload: string, requestHeaders: Headers) {
  const signatureHeader = requestHeaders.get('x-billing-signature');

  const validation = validateBillingWebhookRequest({
    payload,
    signatureHeader,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  const parsedBody = parseBillingSubscriptionWebhookPayload(payload);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.error, details: parsedBody.details },
      { status: parsedBody.status }
    );
  }

  const body = parsedBody.payload;

  const { processSubscriptionLifecycleWebhook } = await import('@/lib/billing/subscriptions');

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
      body.data.currentPeriodEnd ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    cancelAtPeriodEnd: body.data.cancelAtPeriodEnd,
    grantCredits: body.data.grantCredits,
    cycleStart: body.data.cycleStart,
    cycleEnd: body.data.cycleEnd,
    payload: body as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function handleClerkWebhookIngress(
  request: Request,
  options: HandleClerkWebhookIngressOptions = {}
) {
  const allowAuth = options.allowAuth ?? true;
  const allowBilling = options.allowBilling ?? true;
  const payload = await request.text();
  const ingressKind = detectClerkWebhookIngressKind(request.headers);

  if (ingressKind === 'ambiguous') {
    return NextResponse.json(
      { error: 'Ambiguous webhook signature headers (multiple formats present)' },
      { status: 400 }
    );
  }

  if (ingressKind === 'unknown') {
    return NextResponse.json(
      {
        error:
          'Unsupported webhook format. Expected svix headers for auth events or x-billing-signature for billing events.',
      },
      { status: 400 }
    );
  }

  if (ingressKind === 'auth') {
    if (!allowAuth) {
      return NextResponse.json({ error: 'Auth webhook events are not accepted on this endpoint' }, { status: 400 });
    }

    return handleAuthWebhook(payload, request.headers);
  }

  if (!allowBilling) {
    return NextResponse.json({ error: 'Billing webhook events are not accepted on this endpoint' }, { status: 400 });
  }

  return handleBillingWebhook(payload, request.headers);
}
