import assert from 'node:assert/strict';
import test from 'node:test';

import { toAsyncSettlementStatus } from './async-settlement-policy';

test('toAsyncSettlementStatus maps success to settled', () => {
  assert.equal(toAsyncSettlementStatus('success'), 'settled');
});

test('toAsyncSettlementStatus maps failed/timed_out to release states', () => {
  assert.equal(toAsyncSettlementStatus('failed'), 'released');
  assert.equal(toAsyncSettlementStatus('timed_out'), 'timed_out');
});
