import test from 'node:test';
import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';

import sharp from 'sharp';

import {
  MAX_MODEL_IMAGE_BASE64_BYTES,
  MAX_MODEL_IMAGE_BYTES,
  prepareModelImageBuffer,
} from './model-image';

test('prepareModelImageBuffer preserves small supported images', async () => {
  const buffer = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: '#3366ff',
    },
  })
    .png()
    .toBuffer();

  const prepared = await prepareModelImageBuffer(buffer, 'image/png');

  assert.equal(prepared.mediaType, 'image/png');
  assert.equal(prepared.buffer.byteLength, buffer.byteLength);
});

test('prepareModelImageBuffer compresses oversized images below the model limit', async () => {
  const width = 1800;
  const height = 1800;
  const raw = Buffer.allocUnsafe(width * height * 3);
  randomFillSync(raw);

  const oversized = await sharp(raw, {
    raw: { width, height, channels: 3 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();

  assert.ok(oversized.byteLength > MAX_MODEL_IMAGE_BYTES);

  const prepared = await prepareModelImageBuffer(oversized, 'image/png');

  assert.equal(prepared.mediaType, 'image/jpeg');
  assert.ok(prepared.buffer.byteLength <= MAX_MODEL_IMAGE_BYTES);
  assert.ok(prepared.base64.length <= MAX_MODEL_IMAGE_BASE64_BYTES);
});
