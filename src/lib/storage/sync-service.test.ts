import test from 'node:test';
import assert from 'node:assert/strict';

import { isSQLiteEnabled, mergeCanvases } from './sync-service';

test('isSQLiteEnabled follows runtime probe mode instead of backend/env assumptions', async (t) => {
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        mode: 'local-only',
        backend: 'sqlite',
        reason: 'runtime_features_disabled',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )) as typeof fetch;

  const enabled = await isSQLiteEnabled();
  assert.equal(enabled, false);
});

test('mergeCanvases repairs inflated local timestamps when content matches server', () => {
  const merged = mergeCanvases(
    [
      {
        id: 'canvas-1',
        name: 'Demo',
        nodes: [{ id: 'node-1' }] as never[],
        edges: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_999_999,
      },
    ],
    [
      {
        id: 'canvas-1',
        name: 'Demo',
        nodes: [{ id: 'node-1' }] as never[],
        edges: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      },
    ]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.updatedAt, 1_700_000_100_000);
});
