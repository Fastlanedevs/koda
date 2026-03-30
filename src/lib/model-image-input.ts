import 'server-only';

import { createHash } from 'node:crypto';

import { getAssetStorageType, getExtensionFromMime, type AssetStorageProvider } from '@/lib/assets';
import {
  MAX_MODEL_IMAGE_BYTES,
  prepareModelImageBuffer,
} from '@/lib/model-image';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateIpv4Hostname(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  const [a, b] = hostname.split('.').map((part) => Number(part));
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isExternallyFetchableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (LOCAL_HOSTNAMES.has(parsed.hostname)) return false;
    if (parsed.hostname.endsWith('.local')) return false;
    if (isPrivateIpv4Hostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function getAssetProvider(): Promise<AssetStorageProvider | null> {
  const storageType = getAssetStorageType();

  if (storageType === 'r2' || storageType === 's3') {
    const { getS3AssetProvider } = await import('@/lib/assets/s3-provider');
    return getS3AssetProvider(storageType);
  }

  return null;
}

function buildDerivedAssetId(sourceUrl: string, buffer: Buffer): string {
  const digest = createHash('sha1')
    .update(sourceUrl)
    .update(buffer)
    .digest('hex')
    .slice(0, 16);

  return `img_model_${digest}`;
}

export interface ResolvedModelImagePart {
  type: 'image';
  image: string;
  mimeType?: string;
}

/**
 * Resolve a reference image into a model-safe image part.
 * Prefers externally fetchable hosted URLs, but if the remote asset exceeds
 * model limits it uploads a compressed derivative and returns the hosted
 * derivative URL instead. Falls back to base64 only when a hosted derivative
 * URL cannot be produced.
 */
export async function resolveModelImagePart(
  url: string,
  requestUrl: string,
  opts?: { nodeId?: string; canvasId?: string }
): Promise<ResolvedModelImagePart | null> {
  try {
    let resolvedUrl = url;
    if (!url.startsWith('data:')) {
      resolvedUrl = /^https?:\/\//i.test(url) ? url : new URL(url, requestUrl).toString();
    }

    let sourceBuffer: Buffer;
    let sourceMediaType: string;

    if (resolvedUrl.startsWith('data:')) {
      const match = resolvedUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      sourceMediaType = match[1];
      sourceBuffer = Buffer.from(match[2], 'base64');
    } else {
      const res = await fetch(resolvedUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return null;
      }
      sourceMediaType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      sourceBuffer = Buffer.from(await res.arrayBuffer());
    }

    const canUseOriginalUrl =
      isExternallyFetchableUrl(resolvedUrl) &&
      sourceBuffer.byteLength <= MAX_MODEL_IMAGE_BYTES;

    if (canUseOriginalUrl) {
      return {
        type: 'image',
        image: resolvedUrl,
      };
    }

    const prepared = await prepareModelImageBuffer(sourceBuffer, sourceMediaType);
    const provider = await getAssetProvider();

    if (provider) {
      const extension = getExtensionFromMime(prepared.mediaType);
      const derivedAsset = await provider.saveFromBuffer(prepared.buffer, {
        id: buildDerivedAssetId(resolvedUrl, prepared.buffer),
        type: 'image',
        extension,
        metadata: {
          mimeType: prepared.mediaType,
          sizeBytes: prepared.buffer.byteLength,
          nodeId: opts?.nodeId,
          canvasId: opts?.canvasId,
          extra: {
            sourceUrl: resolvedUrl,
            purpose: 'model-reference-derivative',
          },
        },
      });

      if (isExternallyFetchableUrl(derivedAsset.url)) {
        return {
          type: 'image',
          image: derivedAsset.url,
        };
      }
    }

    return {
      type: 'image',
      image: prepared.base64,
      mimeType: prepared.mediaType,
    };
  } catch {
    return null;
  }
}
