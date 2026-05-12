import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVideoModelOptions,
  resolveVideoModel,
} from './types';

test('resolveVideoModel routes auto video requests to direct Veo models by input context', () => {
  assert.equal(resolveVideoModel('auto'), 'veo-3');
  assert.equal(
    resolveVideoModel('auto', { referenceUrl: 'https://cdn.example.com/reference.png' }),
    'veo-3.1-fast-i2v'
  );
});

test('resolveVideoModel keeps direct Seedance 2.0 ids enabled', () => {
  assert.equal(resolveVideoModel('seedance-2.0-fast-t2v'), 'seedance-2.0-fast-t2v');
  assert.equal(resolveVideoModel('seedance-2.0-fast-i2v'), 'seedance-2.0-fast-i2v');
  assert.equal(resolveVideoModel('seedance-2.0-t2v'), 'seedance-2.0-t2v');
  assert.equal(resolveVideoModel('seedance-2.0-i2v'), 'seedance-2.0-i2v');
});

test('normalizeVideoModelOptions snaps unsupported values to a valid Veo configuration', () => {
  const normalized = normalizeVideoModelOptions('veo-3', {
    aspectRatio: '4:3',
    duration: 8,
  });

  assert.deepEqual(normalized, {
    aspectRatio: '16:9',
    duration: 8,
    resolution: '720p',
  });
});

test('normalizeVideoModelOptions constrains LTX 2.3 Fast and Grok to the priced tiers', () => {
  const ltx = normalizeVideoModelOptions('ltx-2.3-fast-t2v', {
    aspectRatio: '1:1',
    duration: 15,
    resolution: '720p',
  });

  assert.deepEqual(ltx, {
    aspectRatio: '16:9',
    duration: 12,
    resolution: '1080p',
  });

  const seedance = normalizeVideoModelOptions('seedance-2.0-fast-t2v', {
    aspectRatio: '1:1',
    duration: 6,
    resolution: '480p',
  });

  assert.deepEqual(seedance, {
    aspectRatio: '1:1',
    duration: 6,
  });
});
