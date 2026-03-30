import sharp from 'sharp';

export const MAX_MODEL_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_DIMENSION_STEPS = [2048, 1600, 1280, 1024, 768, 512];
const JPEG_QUALITY_STEPS = [82, 72, 62, 52, 42];

export interface PreparedModelImage {
  buffer: Buffer;
  base64: string;
  mediaType: string;
}

function normalizeMimeType(mediaType: string | undefined): string {
  if (!mediaType) return 'image/jpeg';
  if (mediaType === 'image/jpg') return 'image/jpeg';
  return mediaType;
}

export async function prepareModelImageBuffer(
  input: Buffer,
  mediaType?: string,
): Promise<PreparedModelImage> {
  const normalizedMimeType = normalizeMimeType(mediaType);

  if (
    input.byteLength <= MAX_MODEL_IMAGE_BYTES
    && SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)
  ) {
    return {
      buffer: input,
      base64: input.toString('base64'),
      mediaType: normalizedMimeType,
    };
  }

  const metadata = await sharp(input, { failOn: 'none', animated: false }).metadata();
  const sourceMaxDimension = Math.max(metadata.width ?? 0, metadata.height ?? 0);

  let smallestResult: Buffer | null = null;

  for (const targetDimension of MAX_DIMENSION_STEPS) {
    for (const quality of JPEG_QUALITY_STEPS) {
      let pipeline = sharp(input, { failOn: 'none', animated: false }).rotate();

      if (sourceMaxDimension > targetDimension) {
        pipeline = pipeline.resize({
          width: targetDimension,
          height: targetDimension,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const result = await pipeline
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (!smallestResult || result.byteLength < smallestResult.byteLength) {
        smallestResult = result;
      }

      if (result.byteLength <= MAX_MODEL_IMAGE_BYTES) {
        return {
          buffer: result,
          base64: result.toString('base64'),
          mediaType: 'image/jpeg',
        };
      }
    }
  }

  throw new Error(
    `Unable to prepare image under ${MAX_MODEL_IMAGE_BYTES} bytes (smallest result: ${smallestResult?.byteLength ?? input.byteLength} bytes)`
  );
}
