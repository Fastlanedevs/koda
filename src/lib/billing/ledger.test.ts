import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSettlement } from './settlement';

test('computeSettlement captures and releases within reservation', () => {
  const result = computeSettlement(100, 80);
  assert.equal(result.capture, 80);
  assert.equal(result.release, 20);
  assert.equal(result.overflow, 0);
});

test('computeSettlement records overflow when actual exceeds reserve', () => {
  const result = computeSettlement(100, 145);
  assert.equal(result.capture, 100);
  assert.equal(result.release, 0);
  assert.equal(result.overflow, 45);
});

test('computeSettlement clamps negative values to zero', () => {
  const result = computeSettlement(-50, -10);
  assert.deepEqual(result, {
    reserved: 0,
    actual: 0,
    capture: 0,
    release: 0,
    overflow: 0,
  });
});
