import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_REQUIRED_ERROR,
  BILLING_REQUIRED_MESSAGE,
  billingRequiredResponse,
  isBillingRequiredForGeneration,
} from './billing-gate';

test('isBillingRequiredForGeneration requires a non-free Clerk plan', () => {
  assert.equal(isBillingRequiredForGeneration('free_user'), true);
  assert.equal(isBillingRequiredForGeneration('free_plan'), true);
  assert.equal(isBillingRequiredForGeneration('basic_user'), false);
  assert.equal(isBillingRequiredForGeneration('pro_user'), false);
  assert.equal(isBillingRequiredForGeneration('pro_plus_user'), false);
});

test('billingRequiredResponse returns a billing prompt payload', async () => {
  const response = billingRequiredResponse();
  assert.equal(response.status, 402);

  const payload = await response.json();
  assert.equal(payload.error, BILLING_REQUIRED_ERROR);
  assert.equal(payload.message, BILLING_REQUIRED_MESSAGE);
});
