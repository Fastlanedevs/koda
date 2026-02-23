import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import test from 'node:test';

import {
  parseBillingSubscriptionWebhookPayload,
  validateBillingWebhookRequest,
} from './webhook-validation';

function sign(payload: string, ts: number, secret: string) {
  const digest = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${digest}`;
}

test('validateBillingWebhookRequest verifies signed payload', () => {
  process.env.BILLING_WEBHOOK_SIGNING_SECRET = 'test_secret';
  const payload = JSON.stringify({ id: 'evt_1' });
  const ts = 1_700_000_000;

  const result = validateBillingWebhookRequest({
    payload,
    signatureHeader: sign(payload, ts, 'test_secret'),
    nowEpochSeconds: ts,
  });

  assert.equal(result.ok, true);
});

test('validateBillingWebhookRequest rejects stale replay timestamp', () => {
  process.env.BILLING_WEBHOOK_SIGNING_SECRET = 'test_secret';
  process.env.BILLING_WEBHOOK_REPLAY_WINDOW_SECONDS = '60';
  const payload = JSON.stringify({ id: 'evt_1' });
  const ts = 1_700_000_000;

  const result = validateBillingWebhookRequest({
    payload,
    signatureHeader: sign(payload, ts, 'test_secret'),
    nowEpochSeconds: ts + 120,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
  }
});

test('parseBillingSubscriptionWebhookPayload enforces strict contract', () => {
  const validPayload = JSON.stringify({
    id: 'evt_1',
    type: 'subscription.updated',
    data: {
      billingAccountId: 'acct_1',
      subscriptionId: 'sub_1',
      planCode: 'pro',
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 1000).toISOString(),
    },
  });

  const valid = parseBillingSubscriptionWebhookPayload(validPayload);
  assert.equal(valid.ok, true);

  const invalid = parseBillingSubscriptionWebhookPayload(
    JSON.stringify({
      id: 'evt_2',
      type: 'subscription.updated',
      data: {
        billingAccountId: 'acct_1',
        subscriptionId: 'sub_1',
        planCode: 'pro',
        status: 'active',
        unexpected: 'field',
      },
    })
  );

  assert.equal(invalid.ok, false);
});
