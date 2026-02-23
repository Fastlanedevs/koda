import { NextResponse } from 'next/server';
import { finalizeAsyncSettlement, finalizeAsyncSettlementIfExpired } from '@/lib/billing/async-settlement';
import { xskillQueryTask } from '@/lib/xskill';
import { saveGeneratedVideo } from '@/lib/video-storage';

export async function POST(request: Request) {
  try {
    const { taskId, model, prompt, canvasId, nodeId } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const timeoutResult = await finalizeAsyncSettlementIfExpired({ provider: 'xskill', externalTaskId: taskId });
    if (timeoutResult?.status === 'timed_out') {
      return NextResponse.json({
        status: 'failed',
        error: 'Video generation timed out',
      });
    }

    const result = await xskillQueryTask(taskId);

    if (result.status === 'completed' && result.videoUrl) {
      // Save video to configured asset storage
      const savedUrl = await saveGeneratedVideo(result.videoUrl, {
        prompt: prompt || '',
        model: model || 'xskill',
        canvasId,
        nodeId,
      });

      await finalizeAsyncSettlement({
        provider: 'xskill',
        externalTaskId: taskId,
        outcome: 'success',
      });

      return NextResponse.json({
        status: 'completed',
        videoUrl: savedUrl,
        originalUrl: result.videoUrl,
      });
    }

    if (result.status === 'failed') {
      await finalizeAsyncSettlement({
        provider: 'xskill',
        externalTaskId: taskId,
        outcome: 'failed',
        failureReason: result.error || 'FAILED_PROVIDER',
      });

      return NextResponse.json({
        status: 'failed',
        error: result.error || 'Video generation failed',
      });
    }

    // pending or processing
    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Poll failed' },
      { status: 500 }
    );
  }
}
