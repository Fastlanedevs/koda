import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateImageCompareModels,
  estimateVideoCompareModels,
  normalizeImageCompareModels,
  normalizeVideoCompareModels,
} from './estimate';

test('normalizeImageCompareModels dedupes and caps the compare set', () => {
  const models = normalizeImageCompareModels([
    'gpt-image-2',
    'gpt-image-2',
    'gemini-3.1-flash-image-preview',
    'gpt-image-2',
    'gemini-3.1-flash-image-preview',
    'gpt-image-2',
  ]);

  assert.deepEqual(models, ['gpt-image-2', 'gemini-3.1-flash-image-preview']);
});

test('normalizeImageCompareModels rejects removed image models', () => {
  assert.throws(
    () => normalizeImageCompareModels(['flux-pro']),
    /Unsupported image compare model: flux-pro/
  );
});

test('normalizeVideoCompareModels rejects auto', () => {
  assert.throws(
    () => normalizeVideoCompareModels(['auto', 'veo-3.1-i2v']),
    /Unsupported video compare model: auto/
  );
});

test('estimateImageCompareModels sums per-model credits', () => {
  const estimate = estimateImageCompareModels(['gpt-image-2', 'gemini-3.1-flash-image-preview']);

  assert.deepEqual(estimate.items, [
    { model: 'gpt-image-2', estimatedCredits: 3 },
    { model: 'gemini-3.1-flash-image-preview', estimatedCredits: 3 },
  ]);
  assert.equal(estimate.totalCredits, 6);
});

test('estimateVideoCompareModels respects duration and audio pricing', () => {
  const estimate = estimateVideoCompareModels(['veo-3.1-fast-i2v', 'seedance-2.0-fast-t2v'], 10, true);

  assert.deepEqual(estimate.items, [
    { model: 'veo-3.1-fast-i2v', estimatedCredits: 46 },
    { model: 'seedance-2.0-fast-t2v', estimatedCredits: 3 },
  ]);
  assert.equal(estimate.totalCredits, 49);
});
