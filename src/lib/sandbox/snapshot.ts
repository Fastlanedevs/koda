/**
 * Snapshot Factory
 *
 * Returns the appropriate SnapshotProvider based on SNAPSHOT_STORAGE env var.
 * Default: local (disk). Alternatives: r2 (Cloudflare R2) or s3 (AWS S3).
 */

import { LocalSnapshotProvider } from './local-snapshot-provider';
import type { SnapshotProvider } from './snapshot-provider';

let instance: SnapshotProvider | null = null;

export function getSnapshotProvider(): SnapshotProvider {
  if (!instance) {
    const storage = process.env.SNAPSHOT_STORAGE || 'local';
    if (storage === 'r2') {
      // Lazy import to avoid loading cloud provider when not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { R2SnapshotProvider } = require('./r2-snapshot-provider');
      instance = new R2SnapshotProvider() as SnapshotProvider;
    } else if (storage === 's3') {
      // Lazy import to avoid loading cloud provider when not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { S3SnapshotProvider } = require('./r2-snapshot-provider');
      instance = new S3SnapshotProvider('s3') as SnapshotProvider;
    } else {
      const basePath = process.env.SNAPSHOT_PATH || './data/snapshots';
      instance = new LocalSnapshotProvider(basePath);
    }
  }
  return instance;
}
