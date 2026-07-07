import { NextResponse } from 'next/server';
import {
  extractExplicitAspectRatioFromPrompt,
  normalizeAspectRatio,
  resolveAutoModel,
  type AspectRatio,
  type ImageModelType,
  type ImagePortRole,
  type NanoBananaResolution,
} from '@/lib/types';
import { getAssetStorageType, getExtensionFromMime, getExtensionFromUrl, type AssetStorageProvider } from '@/lib/assets';
import { generatePresignedGetUrl, type S3Config } from '@/lib/assets/s3-signing';
import { withCredits } from '@/lib/credits/with-credits';

export const maxDuration = 300;

type DirectImageModelType = 'gpt-image-2' | 'gemini-3.1-flash-image-preview';
const MAX_IMAGE_PROMPT_CHARS = 8000;

interface InlineImagePart {
  mimeType: string;
  base64Data: string;
}

interface GeneratedImageBuffer {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
  };
}

async function getProvider(): Promise<AssetStorageProvider> {
  const storageType = getAssetStorageType();

  if (storageType === 'r2' || storageType === 's3') {
    const { getS3AssetProvider } = await import('@/lib/assets/s3-provider');
    return getS3AssetProvider(storageType);
  }

  const { getLocalAssetProvider } = await import('@/lib/assets/local-provider');
  return getLocalAssetProvider();
}

function sanitizeEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function getGeminiApiKey(): string {
  const apiKey = sanitizeEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || sanitizeEnv(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is not configured');
  }
  return apiKey;
}

function getOpenAIApiKey(): string {
  const apiKey = sanitizeEnv(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return apiKey;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map((part) => Number(part));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function extractAssetKeyFromProxyPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/api/assets/key/')) return undefined;
  const encodedKey = pathname.slice('/api/assets/key/'.length);
  if (!encodedKey) return undefined;
  try {
    const key = encodedKey
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
      .replace(/^\/+|\/+$/g, '');
    return key || undefined;
  } catch {
    return undefined;
  }
}

function getS3ConfigForAssetReads(): S3Config | undefined {
  const storageType = getAssetStorageType();

  if (storageType === 'r2') {
    const accountId = sanitizeEnv(process.env.R2_ACCOUNT_ID);
    const accessKeyId = sanitizeEnv(process.env.R2_ACCESS_KEY_ID);
    const secretAccessKey = sanitizeEnv(process.env.R2_SECRET_ACCESS_KEY);
    const bucket = sanitizeEnv(process.env.R2_BUCKET_NAME);
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined;

    const endpoint = trimTrailingSlashes(
      sanitizeEnv(process.env.R2_ENDPOINT) || `https://${accountId}.r2.cloudflarestorage.com`
    );
    const publicUrl = sanitizeEnv(process.env.R2_PUBLIC_URL);

    return {
      type: 'r2',
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      region: 'auto',
      endpoint,
      publicUrl: publicUrl ? trimTrailingSlashes(publicUrl) : undefined,
    };
  }

  if (storageType === 's3') {
    const accessKeyId = sanitizeEnv(process.env.S3_ACCESS_KEY_ID);
    const secretAccessKey = sanitizeEnv(process.env.S3_SECRET_ACCESS_KEY);
    const bucket = sanitizeEnv(process.env.S3_BUCKET_NAME);
    const region = sanitizeEnv(process.env.S3_REGION) || 'us-east-1';
    if (!accessKeyId || !secretAccessKey || !bucket) return undefined;

    const publicUrl = sanitizeEnv(process.env.S3_PUBLIC_URL);
    return {
      type: 's3',
      accessKeyId,
      secretAccessKey,
      bucket,
      region,
      publicUrl: publicUrl ? trimTrailingSlashes(publicUrl) : undefined,
    };
  }

  return undefined;
}

async function getProviderReachableAssetUrl(key: string): Promise<string | undefined> {
  const config = getS3ConfigForAssetReads();
  if (!config) return undefined;

  if (config.publicUrl) {
    return `${config.publicUrl}/${key}`;
  }

  return generatePresignedGetUrl(config, key, 3600);
}

function parseDataImageUrl(value: string): InlineImagePart | undefined {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return undefined;
  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];
  if (!mimeType.startsWith('image/') || !base64Data) return undefined;
  return { mimeType, base64Data };
}

async function fetchReferenceAsInlineImage(referenceUrl: string): Promise<InlineImagePart | undefined> {
  const inline = parseDataImageUrl(referenceUrl);
  if (inline) return inline;

  try {
    const response = await fetch(referenceUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return undefined;

    const mimeType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) return undefined;

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      mimeType,
      base64Data: bytes.toString('base64'),
    };
  } catch {
    return undefined;
  }
}

async function fetchReferenceAsOpenAIFile(referenceUrl: string, index: number): Promise<File | undefined> {
  const inline = parseDataImageUrl(referenceUrl);
  if (inline) {
    const extension = getExtensionFromMime(inline.mimeType);
    return new File(
      [Buffer.from(inline.base64Data, 'base64')],
      `reference-${index}.${extension === 'bin' ? 'png' : extension}`,
      { type: inline.mimeType }
    );
  }

  try {
    const response = await fetch(referenceUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return undefined;

    const mimeType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) return undefined;

    const extension = getExtensionFromMime(mimeType);
    return new File(
      [Buffer.from(await response.arrayBuffer())],
      `reference-${index}.${extension === 'bin' ? 'png' : extension}`,
      { type: mimeType }
    );
  } catch {
    return undefined;
  }
}

function extractGeminiImages(payload: GeminiGenerateContentResponse): GeneratedImageBuffer[] {
  const result: GeneratedImageBuffer[] = [];

  for (const candidate of payload.candidates || []) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      const camel = part.inlineData;
      const snake = part.inline_data;
      const mimeType = (camel?.mimeType || snake?.mime_type || '').toLowerCase();
      const data = camel?.data || snake?.data || '';
      if (!mimeType.startsWith('image/') || !data) continue;

      try {
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length === 0) continue;

        const extension = getExtensionFromMime(mimeType);
        result.push({
          buffer,
          mimeType,
          extension: extension === 'bin' ? 'png' : extension,
        });
      } catch {
        // Skip invalid inline payloads.
      }
    }
  }

  return result;
}

function openAIImageSize(aspectRatio: AspectRatio): string {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
    case '3:2':
      return '1536x1024';
    case '9:16':
    case '3:4':
    case '2:3':
      return '1024x1536';
    case '1:1':
      return '1024x1024';
    default:
      return 'auto';
  }
}

function withImageInstructions(prompt: string, aspectRatio: AspectRatio, resolution?: NanoBananaResolution): string {
  const instructions: string[] = [prompt];
  if (aspectRatio !== 'auto') {
    instructions.push(`Use aspect ratio ${aspectRatio}.`);
  }
  if (resolution) {
    instructions.push(`Target ${resolution} output quality where supported.`);
  }
  return instructions.join('\n');
}

async function generateWithGemini(options: {
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  resolution?: NanoBananaResolution;
  referenceUrls: string[];
  numImages: number;
}): Promise<GeneratedImageBuffer[]> {
  const apiKey = getGeminiApiKey();
  const inlineReferences = await Promise.all(
    options.referenceUrls.slice(0, 14).map(fetchReferenceAsInlineImage)
  );
  const validReferences = inlineReferences.filter((item): item is InlineImagePart => !!item);

  if (options.referenceUrls.length > 0 && validReferences.length === 0) {
    throw new Error('Gemini could not read any reference images');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = withImageInstructions(options.prompt, options.aspectRatio, options.resolution);
  const images: GeneratedImageBuffer[] = [];

  for (let i = 0; i < options.numImages; i += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              ...validReferences.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.base64Data,
                },
              })),
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const payload = (await response.json().catch(() => ({}))) as GeminiGenerateContentResponse;
    if (!response.ok) {
      throw new Error(`Gemini API ${response.status}: ${payload.error?.message || response.statusText}`);
    }

    images.push(...extractGeminiImages(payload));
  }

  if (images.length === 0) {
    throw new Error('Gemini returned no images');
  }

  return images.slice(0, options.numImages);
}

async function generateWithOpenAI(options: {
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  resolution?: NanoBananaResolution;
  referenceUrls: string[];
  numImages: number;
}): Promise<{ buffers: GeneratedImageBuffer[]; urls: string[] }> {
  const apiKey = getOpenAIApiKey();
  const modelId = sanitizeEnv(process.env.OPENAI_IMAGE_MODEL) || options.modelId;
  const prompt = withImageInstructions(options.prompt, options.aspectRatio, options.resolution);
  const size = openAIImageSize(options.aspectRatio);
  const endpoint = options.referenceUrls.length > 0
    ? 'https://api.openai.com/v1/images/edits'
    : 'https://api.openai.com/v1/images/generations';

  let response: Response;
  if (options.referenceUrls.length > 0) {
    const files = (
      await Promise.all(options.referenceUrls.slice(0, 4).map(fetchReferenceAsOpenAIFile))
    ).filter((item): item is File => !!item);

    if (files.length === 0) {
      throw new Error('OpenAI could not read any reference images');
    }

    const form = new FormData();
    form.append('model', modelId);
    form.append('prompt', prompt);
    form.append('n', String(options.numImages));
    form.append('size', size);
    form.append('quality', 'auto');
    form.append('background', 'auto');
    for (const file of files) {
      form.append('image[]', file, file.name);
    }

    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } else {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        n: options.numImages,
        size,
        quality: 'auto',
        output_format: 'png',
      }),
      signal: AbortSignal.timeout(180_000),
    });
  }

  const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
  if (!response.ok) {
    throw new Error(`OpenAI Images API ${response.status}: ${payload.error?.message || response.statusText}`);
  }

  const buffers: GeneratedImageBuffer[] = [];
  const urls: string[] = [];
  for (const item of payload.data || []) {
    if (item.b64_json) {
      buffers.push({
        buffer: Buffer.from(item.b64_json, 'base64'),
        mimeType: 'image/png',
        extension: 'png',
      });
    } else if (item.url) {
      urls.push(item.url);
    }
  }

  if (buffers.length === 0 && urls.length === 0) {
    throw new Error('OpenAI returned no images');
  }

  return { buffers, urls };
}

async function saveGeneratedImages(
  urls: string[],
  options: { prompt: string; model: string; canvasId?: string; nodeId?: string }
): Promise<string[]> {
  const storageType = getAssetStorageType();

  if (storageType === 'local' && !process.env.ASSET_STORAGE) {
    return urls;
  }

  const provider = await getProvider();
  const savedUrls: string[] = [];

  for (const url of urls) {
    try {
      const extension = getExtensionFromUrl(url) || 'png';
      const asset = await provider.saveFromUrl(url, {
        type: 'image',
        extension,
        metadata: {
          mimeType: `image/${extension}`,
          prompt: options.prompt,
          model: options.model,
          canvasId: options.canvasId,
          nodeId: options.nodeId,
        },
      });
      savedUrls.push(asset.url);
    } catch (error) {
      console.error('Failed to save image asset:', error);
      savedUrls.push(url);
    }
  }

  return savedUrls;
}

async function saveGeneratedImageBuffers(
  images: GeneratedImageBuffer[],
  options: { prompt: string; model: string; canvasId?: string; nodeId?: string }
): Promise<string[]> {
  const provider = await getProvider();
  const savedUrls: string[] = [];

  for (const image of images) {
    try {
      const asset = await provider.saveFromBuffer(image.buffer, {
        type: 'image',
        extension: image.extension,
        metadata: {
          mimeType: image.mimeType,
          prompt: options.prompt,
          model: options.model,
          canvasId: options.canvasId,
          nodeId: options.nodeId,
        },
      });
      savedUrls.push(asset.url);
    } catch (error) {
      console.error('Failed to save generated image buffer:', error);
    }
  }

  return savedUrls;
}

export const POST = withCredits(
  { type: 'image' },
  async (request) => {
    try {
      const body = await request.json();
      const {
        prompt,
        model,
        aspectRatio,
        resolution,
        imageCount = 1,
        referenceUrl,
        referenceUrls,
        imageInputs: rawImageInputs,
      } = body;

      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
      }
      if (prompt.length > MAX_IMAGE_PROMPT_CHARS) {
        return NextResponse.json(
          { error: `Prompt must be ${MAX_IMAGE_PROMPT_CHARS} characters or fewer` },
          { status: 400 }
        );
      }

      const normalizeAbsoluteReferenceUrl = async (absolute: URL): Promise<string | undefined> => {
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
          return undefined;
        }

        if (!isPrivateOrLocalHost(absolute.hostname)) {
          return absolute.toString();
        }

        const key = extractAssetKeyFromProxyPath(absolute.pathname);
        if (!key) return undefined;
        return getProviderReachableAssetUrl(key);
      };

      const normalizeReferenceUrl = async (value: unknown): Promise<string | undefined> => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (trimmed.startsWith('data:')) return trimmed;
        try {
          const absolute = new URL(trimmed);
          return await normalizeAbsoluteReferenceUrl(absolute);
        } catch {
          if (trimmed.startsWith('/')) {
            const absolute = new URL(trimmed, request.url);
            return await normalizeAbsoluteReferenceUrl(absolute);
          }
          return undefined;
        }
      };

      const normalizedRefCandidates = await Promise.all([
        normalizeReferenceUrl(referenceUrl),
        ...(Array.isArray(referenceUrls) ? referenceUrls.map(normalizeReferenceUrl) : []),
      ]);
      const normalizedReferences = Array.from(new Set(
        normalizedRefCandidates.filter((url): url is string => !!url)
      ));

      const imageInputLines: string[] = [];
      if (rawImageInputs && typeof rawImageInputs === 'object') {
        const entries = Object.entries(rawImageInputs as Record<string, { role: ImagePortRole; urls: string[]; label: string }>);
        for (const [label, input] of entries) {
          const normalizedUrls = (
            await Promise.all((input.urls || []).map(normalizeReferenceUrl))
          ).filter((url): url is string => !!url);
          normalizedReferences.push(...normalizedUrls);
          if (normalizedUrls.length > 0) {
            imageInputLines.push(`Reference "${input.label || label}" (${input.role || 'reference'}) is attached.`);
          }
        }
      }

      const requestedReferenceCount =
        (typeof referenceUrl === 'string' && referenceUrl.trim() ? 1 : 0) +
        (Array.isArray(referenceUrls) ? referenceUrls.filter((url) => typeof url === 'string' && url.trim()).length : 0);

      if (requestedReferenceCount > 0 && normalizedReferences.length === 0) {
        return NextResponse.json(
          { error: 'Reference images must use publicly reachable URLs, data URLs, or cloud-backed Koda asset URLs.' },
          { status: 400 }
        );
      }

      const modelType = resolveAutoModel(model as ImageModelType) as DirectImageModelType;
      if (modelType !== 'gpt-image-2' && modelType !== 'gemini-3.1-flash-image-preview') {
        return NextResponse.json(
          { error: `Unsupported image model "${modelType}". Use GPT Image 2 or Gemini 3.1 Flash Image Preview.` },
          { status: 400 }
        );
      }

      const requestedAspectRatio = normalizeAspectRatio(aspectRatio);
      const aspectRatioFromPrompt =
        requestedAspectRatio === 'auto'
          ? extractExplicitAspectRatioFromPrompt(prompt)
          : null;
      const resolvedAspectRatio = aspectRatioFromPrompt || requestedAspectRatio;
      const numImages = Math.max(1, Math.min(4, Number(imageCount) || 1));
      const { canvasId, nodeId } = body;
      const promptWithInputLabels = imageInputLines.length > 0
        ? `${imageInputLines.join('\n')}\n${prompt}`
        : prompt;

      let originalUrls: string[] = [];
      let savedUrls: string[] = [];
      let responseModelId: string = modelType;

      if (modelType === 'gemini-3.1-flash-image-preview') {
        const modelId = sanitizeEnv(process.env.GEMINI_IMAGE_MODEL) || modelType;
        responseModelId = `google/${modelId}`;
        const images = await generateWithGemini({
          modelId,
          prompt: promptWithInputLabels,
          aspectRatio: resolvedAspectRatio,
          resolution,
          referenceUrls: Array.from(new Set(normalizedReferences)).slice(0, 14),
          numImages,
        });
        savedUrls = await saveGeneratedImageBuffers(images, {
          prompt,
          model: responseModelId,
          canvasId,
          nodeId,
        });
      } else {
        const modelId = sanitizeEnv(process.env.OPENAI_IMAGE_MODEL) || modelType;
        responseModelId = `openai/${modelId}`;
        const result = await generateWithOpenAI({
          modelId,
          prompt: promptWithInputLabels,
          aspectRatio: resolvedAspectRatio,
          resolution,
          referenceUrls: Array.from(new Set(normalizedReferences)).slice(0, 4),
          numImages,
        });
        originalUrls = result.urls;
        savedUrls = [
          ...(await saveGeneratedImageBuffers(result.buffers, {
            prompt,
            model: responseModelId,
            canvasId,
            nodeId,
          })),
          ...(await saveGeneratedImages(result.urls, {
            prompt,
            model: responseModelId,
            canvasId,
            nodeId,
          })),
        ];
      }

      if (savedUrls.length === 0) {
        throw new Error('Images were generated but could not be saved');
      }

      return NextResponse.json({
        success: true,
        imageUrl: savedUrls[0],
        imageUrls: savedUrls,
        originalUrls,
        model: responseModelId,
      });
    } catch (error) {
      console.error('Generation error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Generation failed' },
        { status: 500 }
      );
    }
  }
);
