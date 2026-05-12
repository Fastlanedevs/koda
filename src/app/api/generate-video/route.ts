import { NextResponse } from 'next/server';
import {
  normalizeVideoModelOptions,
  resolveVideoModel,
  type VideoAspectRatio,
  type VideoModelType,
  type VideoResolution,
} from '@/lib/types';
import { saveGeneratedVideo, saveGeneratedVideoBuffer } from '@/lib/video-storage';
import { getAssetStorageType, getExtensionFromUrl, type AssetStorageProvider } from '@/lib/assets';
import { withCredits } from '@/lib/credits/with-credits';

export const maxDuration = 600;

type DirectVideoProvider = 'gemini' | 'ltx' | 'byteplus';

interface MediaInputs {
  referenceUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceUrls?: string[];
  videoUrl?: string;
  audioUrl?: string;
}

interface InlineMedia {
  mimeType: string;
  base64Data: string;
}

interface GeminiOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: unknown;
}

function sanitizeEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getGeminiApiKey(): string {
  const apiKey = sanitizeEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) || sanitizeEnv(process.env.GEMINI_API_KEY);
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is not configured');
  return apiKey;
}

function getLtxApiKey(): string {
  const apiKey = sanitizeEnv(process.env.LTX_API_KEY) || sanitizeEnv(process.env.LTXV_API_KEY);
  if (!apiKey) throw new Error('LTX_API_KEY or LTXV_API_KEY is not configured');
  return apiKey;
}

function getBytePlusApiKey(): string {
  const apiKey =
    sanitizeEnv(process.env.BYTEPLUS_ARK_API_KEY) ||
    sanitizeEnv(process.env.ARK_API_KEY) ||
    sanitizeEnv(process.env.VOLCENGINE_ARK_API_KEY);
  if (!apiKey) throw new Error('BYTEPLUS_ARK_API_KEY, ARK_API_KEY, or VOLCENGINE_ARK_API_KEY is not configured');
  return apiKey;
}

function getVideoProvider(model: VideoModelType): DirectVideoProvider {
  if (model.startsWith('veo-3')) return 'gemini';
  if (model.startsWith('ltx-2.3')) return 'ltx';
  if (model.startsWith('seedance-2.0')) return 'byteplus';
  throw new Error(`Unsupported video model "${model}". Use Gemini Veo, LTX 2.3, or Seedance 2.0.`);
}

function normalizeMediaUrl(value: unknown, request: Request): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (!trimmed.startsWith('/')) {
    return trimmed;
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return trimmed;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}${trimmed}`;
}

function normalizeMediaUrls(value: unknown, request: Request): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value
    .map((item) => normalizeMediaUrl(item, request))
    .filter((url): url is string => !!url);
  return urls.length > 0 ? urls : undefined;
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

function defaultExtensionFor(type: 'image' | 'video' | 'audio'): string {
  if (type === 'image') return 'png';
  if (type === 'video') return 'mp4';
  return 'mp3';
}

function isAlreadyPublicAssetUrl(url: string): boolean {
  const prefixes = [
    process.env.R2_PUBLIC_URL,
    process.env.S3_PUBLIC_URL,
    process.env.ASSET_BASE_URL,
  ]
    .map((value) => value?.trim().replace(/\/+$/, ''))
    .filter((v): v is string => !!v);
  return prefixes.some((prefix) => url.startsWith(prefix));
}

async function rehostForDirectProvider(
  url: string | undefined,
  type: 'image' | 'video' | 'audio',
  request: Request,
  meta: { model: string; nodeId?: string; canvasId?: string }
): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
  if (isAlreadyPublicAssetUrl(url)) return url;

  const storageType = getAssetStorageType();
  if (storageType === 'local' && !process.env.ASSET_STORAGE) {
    return url;
  }

  try {
    const provider = await getProvider();
    const extension = getExtensionFromUrl(url) || defaultExtensionFor(type);
    const asset = await provider.saveFromUrl(url, {
      type,
      extension,
      metadata: {
        mimeType: `${type}/${extension}`,
        model: meta.model,
        nodeId: meta.nodeId,
        canvasId: meta.canvasId,
      },
    });
    return normalizeMediaUrl(asset.url, request) || asset.url;
  } catch (err) {
    console.warn('[generate-video] Failed to rehost media URL, using original:', err);
    return url;
  }
}

async function rehostMediaInputs(
  media: MediaInputs,
  request: Request,
  meta: { model: string; nodeId?: string; canvasId?: string }
): Promise<MediaInputs> {
  const referenceUrl = await rehostForDirectProvider(media.referenceUrl, 'image', request, meta);
  const firstFrameUrl = await rehostForDirectProvider(media.firstFrameUrl, 'image', request, meta);
  const lastFrameUrl = await rehostForDirectProvider(media.lastFrameUrl, 'image', request, meta);
  const videoUrl = await rehostForDirectProvider(media.videoUrl, 'video', request, meta);
  const audioUrl = await rehostForDirectProvider(media.audioUrl, 'audio', request, meta);

  const referenceUrls = media.referenceUrls?.length
    ? (await Promise.all(
        media.referenceUrls.map((url) => rehostForDirectProvider(url, 'image', request, meta))
      )).filter((url): url is string => !!url)
    : undefined;

  return {
    referenceUrl,
    firstFrameUrl,
    lastFrameUrl,
    referenceUrls: referenceUrls && referenceUrls.length > 0 ? referenceUrls : undefined,
    videoUrl,
    audioUrl,
  };
}

function parseDataUrl(value: string, prefix: string): InlineMedia | undefined {
  const escaped = prefix.replace('/', '\\/');
  const match = value.match(new RegExp(`^data:(${escaped}\\/[a-z0-9.+-]+);base64,(.+)$`, 'i'));
  if (!match) return undefined;
  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];
  if (!mimeType.startsWith(`${prefix}/`) || !base64Data) return undefined;
  return { mimeType, base64Data };
}

async function fetchMediaAsInline(url: string, prefix: 'image' | 'video' | 'audio'): Promise<InlineMedia> {
  const inline = parseDataUrl(url, prefix);
  if (inline) return inline;

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Could not fetch ${prefix} reference (${response.status})`);
  }

  const mimeType = (response.headers.get('content-type') || `${prefix}/${defaultExtensionFor(prefix)}`)
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!mimeType.startsWith(`${prefix}/`)) {
    throw new Error(`Reference URL is not a ${prefix} asset`);
  }

  return {
    mimeType,
    base64Data: Buffer.from(await response.arrayBuffer()).toString('base64'),
  };
}

function geminiModelId(model: VideoModelType): string {
  if (model === 'veo-3.1-fast-i2v' || model === 'veo-3.1-fast-flf') {
    return sanitizeEnv(process.env.GEMINI_FAST_VIDEO_MODEL) || 'veo-3.1-fast-generate-preview';
  }
  return sanitizeEnv(process.env.GEMINI_VIDEO_MODEL) || 'veo-3.1-generate-preview';
}

function geminiOperationUrl(operationName: string, apiKey: string): string {
  if (operationName.startsWith('http://') || operationName.startsWith('https://')) {
    const url = new URL(operationName);
    url.searchParams.set('key', apiKey);
    return url.toString();
  }
  return `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;
}

function getNestedValue(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractGeminiVideoUri(response: unknown): string | undefined {
  const candidates = [
    ['generateVideoResponse', 'generatedSamples', '0', 'video', 'uri'],
    ['generateVideoResponse', 'generatedSamples', '0', 'video', 'url'],
    ['generatedVideos', '0', 'video', 'uri'],
    ['generatedVideos', '0', 'video', 'url'],
    ['videos', '0', 'uri'],
    ['videos', '0', 'url'],
    ['video', 'uri'],
    ['video', 'url'],
  ];

  for (const path of candidates) {
    const value = getNestedValue(response, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

async function downloadGeminiVideo(uri: string, apiKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const buildUrls = (): string[] => {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const url = new URL(uri);
      url.searchParams.set('key', apiKey);
      return [url.toString(), uri];
    }
    return [
      `https://generativelanguage.googleapis.com/v1beta/${uri}:download?key=${encodeURIComponent(apiKey)}`,
      `https://generativelanguage.googleapis.com/v1beta/${uri}?key=${encodeURIComponent(apiKey)}`,
    ];
  };

  for (const url of buildUrls()) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) continue;
    const contentType = (response.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase();
    if (contentType.includes('json')) continue;
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType || 'video/mp4',
    };
  }

  throw new Error('Gemini video was generated, but the video file could not be downloaded');
}

async function generateViaGemini(options: {
  prompt: string;
  model: VideoModelType;
  aspectRatio: VideoAspectRatio;
  duration: number;
  resolution?: VideoResolution;
  referenceUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceUrls?: string[];
  generateAudio?: boolean;
}): Promise<{ buffer: Buffer; mimeType: string; modelId: string }> {
  const apiKey = getGeminiApiKey();
  const modelId = geminiModelId(options.model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;
  const imageUrl = options.firstFrameUrl || options.referenceUrl;
  const instance: Record<string, unknown> = { prompt: options.prompt };

  if (options.model === 'veo-3.1-ref') {
    const urls = options.referenceUrls?.length ? options.referenceUrls : imageUrl ? [imageUrl] : [];
    if (urls.length === 0) throw new Error('Veo 3.1 reference mode requires at least one image reference');
    const referenceImages = await Promise.all(
      urls.slice(0, 3).map(async (url) => {
        const image = await fetchMediaAsInline(url, 'image');
        return {
          image: {
            bytesBase64Encoded: image.base64Data,
            mimeType: image.mimeType,
          },
          referenceType: 'asset',
        };
      })
    );
    instance.referenceImages = referenceImages;
  } else if (options.model === 'veo-3.1-flf' || options.model === 'veo-3.1-fast-flf') {
    const firstFrame = options.firstFrameUrl || options.referenceUrl;
    const lastFrame = options.lastFrameUrl;
    if (!firstFrame || !lastFrame) throw new Error('Veo first-last-frame requires first and last frame images');
    const first = await fetchMediaAsInline(firstFrame, 'image');
    const last = await fetchMediaAsInline(lastFrame, 'image');
    instance.image = { bytesBase64Encoded: first.base64Data, mimeType: first.mimeType };
    instance.lastFrame = { bytesBase64Encoded: last.base64Data, mimeType: last.mimeType };
  } else if (options.model === 'veo-3.1-i2v' || options.model === 'veo-3.1-fast-i2v') {
    if (!imageUrl) throw new Error('Veo image-to-video requires a reference image');
    const image = await fetchMediaAsInline(imageUrl, 'image');
    instance.image = { bytesBase64Encoded: image.base64Data, mimeType: image.mimeType };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: options.aspectRatio,
        durationSeconds: options.duration,
        resolution: options.resolution || '720p',
        personGeneration: 'allow_adult',
        generateAudio: options.generateAudio !== false,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const operation = (await response.json().catch(() => ({}))) as GeminiOperation;
  if (!response.ok) {
    throw new Error(`Gemini Veo API ${response.status}: ${operation.error?.message || response.statusText}`);
  }
  if (!operation.name) {
    throw new Error('Gemini Veo did not return an operation name');
  }

  const deadline = Date.now() + 9 * 60_000;
  let latest = operation;
  while (!latest.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const poll = await fetch(geminiOperationUrl(latest.name || operation.name, apiKey), {
      signal: AbortSignal.timeout(60_000),
    });
    latest = (await poll.json().catch(() => ({}))) as GeminiOperation;
    if (!poll.ok) {
      throw new Error(`Gemini Veo poll ${poll.status}: ${latest.error?.message || poll.statusText}`);
    }
  }

  if (!latest.done) {
    throw new Error(`Gemini Veo task timed out (${operation.name})`);
  }
  if (latest.error?.message) {
    throw new Error(`Gemini Veo task failed: ${latest.error.message}`);
  }

  const videoUri = extractGeminiVideoUri(latest.response);
  if (!videoUri) {
    throw new Error('Gemini Veo completed but returned no video URL');
  }

  const video = await downloadGeminiVideo(videoUri, apiKey);
  return { ...video, modelId };
}

function ltxBaseUrl(): string {
  return (sanitizeEnv(process.env.LTX_API_BASE_URL) || 'https://api.ltx.video/v1').replace(/\/+$/, '');
}

function ltxModelId(model: VideoModelType): string {
  if (model.includes('fast')) {
    return sanitizeEnv(process.env.LTX_FAST_MODEL) || 'ltx-2-3-fast';
  }
  return sanitizeEnv(process.env.LTX_PRO_MODEL) || 'ltx-2-3-pro';
}

function ltxResolution(aspectRatio: VideoAspectRatio, resolution?: VideoResolution): string {
  const longEdge = resolution === '720p' ? 1280 : 1920;
  const pairs: Record<VideoAspectRatio, [number, number]> = {
    '16:9': [longEdge, Math.round(longEdge * 9 / 16)],
    '9:16': [Math.round(longEdge * 9 / 16), longEdge],
    '1:1': [resolution === '720p' ? 720 : 1080, resolution === '720p' ? 720 : 1080],
    '4:3': [Math.round(longEdge * 4 / 4), Math.round(longEdge * 3 / 4)],
    '3:4': [Math.round(longEdge * 3 / 4), Math.round(longEdge * 4 / 4)],
  };
  const [width, height] = pairs[aspectRatio] || pairs['16:9'];
  return `${width}x${height}`;
}

function ltxEndpoint(model: VideoModelType): string {
  if (model === 'ltx-2.3-fast-t2v') return '/text-to-video';
  if (model === 'ltx-2.3-a2v') return '/audio-to-video';
  if (model === 'ltx-2.3-retake-v2v') return '/retake';
  if (model === 'ltx-2.3-extend') return '/extend';
  return '/image-to-video';
}

async function generateViaLtx(options: {
  prompt: string;
  model: VideoModelType;
  aspectRatio: VideoAspectRatio;
  duration: number;
  resolution?: VideoResolution;
  referenceUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  generateAudio?: boolean;
}): Promise<{ buffer?: Buffer; mimeType?: string; videoUrl?: string; modelId: string }> {
  const apiKey = getLtxApiKey();
  const modelId = ltxModelId(options.model);
  const endpoint = ltxEndpoint(options.model);
  const imageUrl = options.firstFrameUrl || options.referenceUrl;
  const body: Record<string, unknown> = {
    model: modelId,
    prompt: options.prompt,
    duration: options.duration,
    resolution: ltxResolution(options.aspectRatio, options.resolution),
    generate_audio: options.generateAudio !== false,
  };

  if (endpoint === '/image-to-video') {
    if (!imageUrl) throw new Error('LTX image-to-video requires a reference image');
    body.image_uri = imageUrl;
    if (options.lastFrameUrl) body.last_frame_uri = options.lastFrameUrl;
  } else if (endpoint === '/retake' || endpoint === '/extend') {
    if (!options.videoUrl) throw new Error('LTX video-to-video requires a video input');
    body.video_uri = options.videoUrl;
  } else if (endpoint === '/audio-to-video') {
    if (!options.audioUrl) throw new Error('LTX audio-to-video requires an audio input');
    body.audio_uri = options.audioUrl;
    if (imageUrl) body.image_uri = imageUrl;
  }

  const response = await fetch(`${ltxBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/octet-stream, application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60_000),
  });

  const contentType = (response.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase();
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`LTX API ${response.status}: ${text || response.statusText}`);
  }

  if (contentType.includes('json')) {
    const payload = await response.json() as { video_url?: string; url?: string; output_url?: string };
    const videoUrl = payload.video_url || payload.output_url || payload.url;
    if (!videoUrl) throw new Error('LTX returned JSON without a video URL');
    return { videoUrl, modelId };
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: contentType || 'video/mp4',
    modelId,
  };
}

function bytePlusBaseUrl(): string {
  return (
    sanitizeEnv(process.env.BYTEPLUS_ARK_BASE_URL) ||
    sanitizeEnv(process.env.ARK_BASE_URL) ||
    'https://ark.ap-southeast.bytepluses.com/api/v3'
  ).replace(/\/+$/, '');
}

function bytePlusModelId(model: VideoModelType): string {
  if (model.includes('fast')) {
    return sanitizeEnv(process.env.BYTEPLUS_SEEDANCE_2_FAST_MODEL) || 'dreamina-seedance-2-0-fast-260128';
  }
  return sanitizeEnv(process.env.BYTEPLUS_SEEDANCE_2_MODEL) || 'dreamina-seedance-2-0-260128';
}

function extractTaskId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined;
  for (const value of [root.id, root.task_id, root.taskId, data?.id, data?.task_id, data?.taskId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function createBytePlusSeedanceTask(options: {
  prompt: string;
  model: VideoModelType;
  aspectRatio: VideoAspectRatio;
  duration: number;
  resolution?: VideoResolution;
  referenceUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceUrls?: string[];
  videoUrl?: string;
  audioUrl?: string;
  generateAudio?: boolean;
}): Promise<{ taskId: string; modelId: string }> {
  const apiKey = getBytePlusApiKey();
  const modelId = bytePlusModelId(options.model);
  const imageUrls = [
    options.firstFrameUrl || options.referenceUrl,
    ...(options.referenceUrls || []),
    options.lastFrameUrl,
  ].filter((url): url is string => !!url);

  if (options.model.includes('i2v') && imageUrls.length === 0) {
    throw new Error('Seedance image-to-video requires a reference image');
  }

  const content: Array<Record<string, unknown>> = [];
  if (options.prompt) content.push({ type: 'text', text: options.prompt });
  for (const url of imageUrls.slice(0, 8)) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }
  if (options.videoUrl) {
    content.push({ type: 'video_url', video_url: { url: options.videoUrl }, role: 'reference_video' });
  }
  if (options.audioUrl) {
    content.push({ type: 'audio_url', audio_url: { url: options.audioUrl }, role: 'reference_audio' });
  }

  const response = await fetch(`${bytePlusBaseUrl()}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      content,
      ratio: options.aspectRatio,
      duration: options.duration,
      generate_audio: options.generateAudio !== false,
      watermark: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`BytePlus Seedance API ${response.status}: ${JSON.stringify(payload)}`);
  }

  const taskId = extractTaskId(payload);
  if (!taskId) {
    throw new Error('BytePlus Seedance did not return a task ID');
  }

  return { taskId, modelId };
}

export const POST = withCredits(
  {
    type: 'video',
    getCostParams: (body) => ({
      model: (body.model as string) || 'veo-3',
      duration: (body.duration as number) || 5,
      generateAudio: (body.generateAudio as boolean) || false,
    }),
  },
  async (request) => {
    try {
      const body = await request.json();
      const {
        prompt,
        model,
        aspectRatio,
        duration,
        resolution,
        referenceUrl,
        firstFrameUrl,
        lastFrameUrl,
        referenceUrls: rawReferenceUrls,
        videoUrl: inputVideoUrl,
        audioUrl: inputAudioUrl,
        generateAudio,
      } = body;

      const normalizedReferenceUrl = normalizeMediaUrl(referenceUrl, request);
      const normalizedFirstFrameUrl = normalizeMediaUrl(firstFrameUrl, request);
      const normalizedLastFrameUrl = normalizeMediaUrl(lastFrameUrl, request);
      const normalizedReferenceUrls = normalizeMediaUrls(rawReferenceUrls, request);
      const normalizedVideoUrl = normalizeMediaUrl(inputVideoUrl, request);
      const normalizedAudioUrl = normalizeMediaUrl(inputAudioUrl, request);
      const modelType = resolveVideoModel(model as VideoModelType, {
        referenceUrl: normalizedReferenceUrl,
        firstFrameUrl: normalizedFirstFrameUrl,
        lastFrameUrl: normalizedLastFrameUrl,
        referenceUrls: normalizedReferenceUrls,
      });
      const provider = getVideoProvider(modelType);
      const normalizedOptions = normalizeVideoModelOptions(modelType, {
        aspectRatio,
        duration,
        resolution,
      });
      const { canvasId, nodeId } = body;

      const media = await rehostMediaInputs(
        {
          referenceUrl: normalizedReferenceUrl,
          firstFrameUrl: normalizedFirstFrameUrl,
          lastFrameUrl: normalizedLastFrameUrl,
          referenceUrls: normalizedReferenceUrls,
          videoUrl: normalizedVideoUrl,
          audioUrl: normalizedAudioUrl,
        },
        request,
        { model: String(modelType), nodeId, canvasId }
      );

      if (
        !prompt &&
        !media.referenceUrl &&
        !media.firstFrameUrl &&
        !media.lastFrameUrl &&
        !media.referenceUrls?.length &&
        !media.videoUrl &&
        !media.audioUrl
      ) {
        return NextResponse.json(
          { error: 'Either prompt or a media reference is required' },
          { status: 400 }
        );
      }

      if (provider === 'byteplus') {
        const { taskId, modelId } = await createBytePlusSeedanceTask({
          prompt: prompt || '',
          model: modelType,
          aspectRatio: normalizedOptions.aspectRatio,
          duration: normalizedOptions.duration,
          referenceUrl: media.referenceUrl,
          firstFrameUrl: media.firstFrameUrl,
          lastFrameUrl: media.lastFrameUrl,
          referenceUrls: media.referenceUrls,
          videoUrl: media.videoUrl,
          audioUrl: media.audioUrl,
          generateAudio,
        });

        return NextResponse.json({
          async: true,
          taskId,
          model: `byteplus/${modelId}`,
        });
      }

      if (provider === 'gemini') {
        const result = await generateViaGemini({
          prompt: prompt || '',
          model: modelType,
          aspectRatio: normalizedOptions.aspectRatio,
          duration: normalizedOptions.duration,
          resolution: normalizedOptions.resolution,
          referenceUrl: media.referenceUrl,
          firstFrameUrl: media.firstFrameUrl,
          lastFrameUrl: media.lastFrameUrl,
          referenceUrls: media.referenceUrls,
          generateAudio,
        });

        const savedUrl = await saveGeneratedVideoBuffer(result.buffer, {
          prompt: prompt || '',
          model: `google/${result.modelId}`,
          canvasId,
          nodeId,
          mimeType: result.mimeType,
          extension: 'mp4',
        });

        return NextResponse.json({
          success: true,
          videoUrl: savedUrl,
          model: `google/${result.modelId}`,
        });
      }

      const result = await generateViaLtx({
        prompt: prompt || '',
        model: modelType,
        aspectRatio: normalizedOptions.aspectRatio,
        duration: normalizedOptions.duration,
        resolution: normalizedOptions.resolution,
        referenceUrl: media.referenceUrl,
        firstFrameUrl: media.firstFrameUrl,
        lastFrameUrl: media.lastFrameUrl,
        videoUrl: media.videoUrl,
        audioUrl: media.audioUrl,
        generateAudio,
      });

      const modelLabel = `ltx/${result.modelId}`;
      const savedUrl = result.buffer
        ? await saveGeneratedVideoBuffer(result.buffer, {
            prompt: prompt || '',
            model: modelLabel,
            canvasId,
            nodeId,
            mimeType: result.mimeType,
            extension: 'mp4',
          })
        : await saveGeneratedVideo(result.videoUrl!, {
            prompt: prompt || '',
            model: modelLabel,
            canvasId,
            nodeId,
          });

      return NextResponse.json({
        success: true,
        videoUrl: savedUrl,
        originalUrl: result.videoUrl,
        model: modelLabel,
      });
    } catch (error) {
      console.error('Video generation error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Video generation failed' },
        { status: 500 }
      );
    }
  }
);
