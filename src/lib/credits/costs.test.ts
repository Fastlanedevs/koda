import test from 'node:test';
import assert from 'node:assert/strict';

import { FREE_TIER_CREDITS, getInitialFreeCredits, getPlanCredits } from './costs';

test('free plans do not receive monthly or initial credits', () => {
  assert.equal(FREE_TIER_CREDITS, 0);
  assert.equal(getPlanCredits('free_user'), 0);
  assert.equal(getPlanCredits('free_plan'), 0);
  assert.equal(getInitialFreeCredits(), 0);
});

test('paid plans still receive monthly credits', () => {
  assert.equal(getPlanCredits('basic_user'), 100);
  assert.equal(getPlanCredits('pro_user'), 300);
  assert.equal(getPlanCredits('pro_plus_user'), 800);
});
