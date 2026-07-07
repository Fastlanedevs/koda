import test from 'node:test';
import assert from 'node:assert/strict';

import { canUseSeedance, isSeedanceModel, seedanceBillingRequiredPayload } from './provider-access';

test('isSeedanceModel identifies Seedance models', () => {
  assert.equal(isSeedanceModel('seedance-2.0-t2v'), true);
  assert.equal(isSeedanceModel(' Seedance-2.0-fast-i2v '), true);
  assert.equal(isSeedanceModel('veo-3.1-fast-i2v'), false);
});

test('canUseSeedance only allows paid plans', () => {
  assert.equal(canUseSeedance('free_user'), false);
  assert.equal(canUseSeedance('free_plan'), false);
  assert.equal(canUseSeedance('basic_user'), true);
  assert.equal(canUseSeedance('pro_user'), true);
  assert.equal(canUseSeedance('pro_plus_user'), true);
});

test('seedanceBillingRequiredPayload returns a billing error payload', () => {
  assert.equal(seedanceBillingRequiredPayload().code, 'BILLING_REQUIRED');
  assert.equal(seedanceBillingRequiredPayload().provider, 'seedance');
});
