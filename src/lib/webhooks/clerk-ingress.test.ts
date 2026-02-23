import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import test from 'node:test';

import { detectClerkWebhookIngressKind, handleClerkWebhookIngress } from './clerk-ingress';

function sign(payload: string, ts: number, secret: string) {
  const digest = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${digest}`;
}

test('detectClerkWebhookIngressKind detects webhook format by signature headers', () => {
  const authHeaders = new Headers({
    'svix-id': 'msg_1',
    'svix-timestamp': '1700000000',
    'svix-signature': 'v1,test',
  });
  assert.equal(detectClerkWebhookIngressKind(authHeaders), 'auth');

  const billingHeaders = new Headers({
    'x-billing-signature': 't=1700000000,v1=abc',
  });
  assert.equal(detectClerkWebhookIngressKind(billingHeaders), 'billing');

  const ambiguousHeaders = new Headers({
    'svix-id': 'msg_1',
    'x-billing-signature': 't=1700000000,v1=abc',
  });
  assert.equal(detectClerkWebhookIngressKind(ambiguousHeaders), 'ambiguous');

  assert.equal(detectClerkWebhookIngressKind(new Headers()), 'unknown');
});

test('handleClerkWebhookIngress rejects unknown webhook formats', async () => {
  const request = new Request('http://localhost/api/webhooks/clerk', {
    method: 'POST',
    body: JSON.stringify({ id: 'evt_unknown' }),
  });

  const response = await handleClerkWebhookIngress(request);
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? '', /Unsupported webhook format/);
});

test('handleClerkWebhookIngress preserves strict billing signature validation', async () => {
  const prevSecret = process.env.BILLING_WEBHOOK_SIGNING_SECRET;
  process.env.BILLING_WEBHOOK_SIGNING_SECRET = 'billing_secret';

  try {
    const payload = JSON.stringify({ id: 'evt_1', type: 'subscription.updated', data: {} });
    const ts = Math.floor(Date.now() / 1000);
    const invalidSignature = sign(payload, ts, 'wrong_secret');

    const request = new Request('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'x-billing-signature': invalidSignature,
      },
      body: payload,
    });

    const response = await handleClerkWebhookIngress(request);
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Invalid signature');
  } finally {
    if (typeof prevSecret === 'undefined') {
      delete process.env.BILLING_WEBHOOK_SIGNING_SECRET;
    } else {
      process.env.BILLING_WEBHOOK_SIGNING_SECRET = prevSecret;
    }
  }
});

test('legacy billing endpoint mode rejects auth-formatted events', async () => {
  const request = new Request('http://localhost/api/webhooks/billing/clerk', {
    method: 'POST',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,test',
    },
    body: '{}',
  });

  const response = await handleClerkWebhookIngress(request, {
    allowAuth: false,
    allowBilling: true,
  });
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? '', /not accepted on this endpoint/);
});
