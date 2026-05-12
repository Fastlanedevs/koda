import { NextResponse } from 'next/server';
import { saveGeneratedVideo } from '@/lib/video-storage';

function sanitizeEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getBytePlusApiKey(): string {
  const apiKey =
    sanitizeEnv(process.env.BYTEPLUS_ARK_API_KEY) ||
    sanitizeEnv(process.env.ARK_API_KEY) ||
    sanitizeEnv(process.env.VOLCENGINE_ARK_API_KEY);
  if (!apiKey) throw new Error('BYTEPLUS_ARK_API_KEY, ARK_API_KEY, or VOLCENGINE_ARK_API_KEY is not configured');
  return apiKey;
}

function bytePlusBaseUrl(): string {
  return (
    sanitizeEnv(process.env.BYTEPLUS_ARK_BASE_URL) ||
    sanitizeEnv(process.env.ARK_BASE_URL) ||
    'https://ark.ap-southeast.bytepluses.com/api/v3'
  ).replace(/\/+$/, '');
}

function getNestedValue(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function queryBytePlusSeedanceTask(taskId: string): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}> {
  const apiKey = getBytePlusApiKey();
  const response = await fetch(`${bytePlusBaseUrl()}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`BytePlus Seedance poll ${response.status}: ${JSON.stringify(payload)}`);
  }

  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const statusValue = String(data.status || data.task_status || root.status || '').toLowerCase();
  const videoUrlCandidates = [
    getNestedValue(data, ['content', 'video_url']),
    getNestedValue(data, ['result', 'video_url']),
    getNestedValue(data, ['result', 'url']),
    getNestedValue(data, ['output', 'video_url']),
    getNestedValue(data, ['output', 'url']),
    data.video_url,
    data.url,
  ];
  const videoUrl = videoUrlCandidates.find((value): value is string =>
    typeof value === 'string' && value.trim().length > 0
  );

  if (videoUrl) return { status: 'completed', videoUrl };
  if (['succeeded', 'success', 'completed', 'done'].includes(statusValue)) {
    return { status: 'completed' };
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(statusValue)) {
    const error = data.error || data.message || root.error || root.message;
    return { status: 'failed', error: typeof error === 'string' ? error : JSON.stringify(error || payload) };
  }
  if (['running', 'processing', 'in_progress'].includes(statusValue)) {
    return { status: 'processing' };
  }
  return { status: 'pending' };
}

export async function POST(request: Request) {
  try {
    const { taskId, model, prompt, canvasId, nodeId } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const result = await queryBytePlusSeedanceTask(taskId);

    if (result.status === 'completed' && result.videoUrl) {
      const savedUrl = await saveGeneratedVideo(result.videoUrl, {
        prompt: prompt || '',
        model: model || 'byteplus/seedance-2.0',
        canvasId,
        nodeId,
      });

      return NextResponse.json({
        status: 'completed',
        videoUrl: savedUrl,
        originalUrl: result.videoUrl,
      });
    }

    if (result.status === 'completed') {
      return NextResponse.json({
        status: 'failed',
        error: 'BytePlus Seedance completed but returned no video URL',
      });
    }

    if (result.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: result.error || 'Video generation failed',
      });
    }

    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Poll failed' },
      { status: 500 }
    );
  }
}
