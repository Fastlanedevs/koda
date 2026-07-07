import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_REQUIRED_ERROR,
  BILLING_REQUIRED_MESSAGE,
  billingRequiredResponse,
  coercePaidPlanOverride,
  isBillingRequiredForGeneration,
} from './billing-gate';

test('isBillingRequiredForGeneration requires a non-free Clerk plan', () => {
  assert.equal(isBillingRequiredForGeneration('free_user'), true);
  assert.equal(isBillingRequiredForGeneration('free_plan'), true);
  assert.equal(isBillingRequiredForGeneration('basic_user'), false);
  assert.equal(isBillingRequiredForGeneration('pro_user'), false);
  assert.equal(isBillingRequiredForGeneration('pro_plus_user'), false);
});

test('coercePaidPlanOverride only accepts paid plan keys', () => {
  assert.equal(coercePaidPlanOverride('basic_user'), 'basic_user');
  assert.equal(coercePaidPlanOverride(' pro_user '), 'pro_user');
  assert.equal(coercePaidPlanOverride('free_user'), null);
  assert.equal(coercePaidPlanOverride('free_plan'), null);
  assert.equal(coercePaidPlanOverride('unknown'), null);
  assert.equal(coercePaidPlanOverride(null), null);
});

test('billingRequiredResponse returns a billing prompt payload', async () => {
  const response = billingRequiredResponse();
  assert.equal(response.status, 402);

  const payload = await response.json();
  assert.equal(payload.error, BILLING_REQUIRED_ERROR);
  assert.equal(payload.message, BILLING_REQUIRED_MESSAGE);
});
