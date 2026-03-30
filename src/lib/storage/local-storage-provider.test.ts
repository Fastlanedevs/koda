import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalStorageProvider } from './local-storage-provider';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

test('local storage provider preserves supplied timestamps', async (t) => {
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  const originalLocalStorage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  const storage = new MemoryStorage();

  (globalThis as typeof globalThis & { window: Window }).window = {} as Window;
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage = storage;

  t.after(() => {
    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }

    if (originalLocalStorage === undefined) {
      delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = originalLocalStorage;
    }
  });

  const provider = new LocalStorageProvider();
  const createdAt = 1_700_000_000_000;
  const updatedAt = 1_700_000_123_456;

  await provider.saveCanvas({
    id: 'canvas_preserve',
    name: 'Preserve Timestamp',
    nodes: [],
    edges: [],
    createdAt,
    updatedAt,
  });

  const canvas = await provider.getCanvas('canvas_preserve');
  assert.ok(canvas);
  assert.equal(canvas.updatedAt, updatedAt);
  assert.equal(canvas.createdAt, createdAt);

  const list = await provider.listCanvases();
  assert.equal(list[0]?.updatedAt, updatedAt);
  assert.equal(list[0]?.createdAt, createdAt);
});
