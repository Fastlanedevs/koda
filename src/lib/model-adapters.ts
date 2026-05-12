import type {
  AudioModelType,
  ElevenLabsVoice,
  ImageModelType,
  ImagePortRole,
  MusicDuration,
  NanoBananaResolution,
  AspectRatio,
  VideoAspectRatio,
  VideoDuration,
  VideoModelType,
  VideoResolution,
  SyncLipsyncMode,
  TadaLanguage,
} from './types';
import { DEFAULT_IMAGE_ASPECT_RATIO } from './types';

// Request data passed to image adapters.
export interface GenerateRequest {
  prompt: string;
  model: ImageModelType;
  aspectRatio: AspectRatio;
  resolution?: NanoBananaResolution;
  numImages?: number;
  referenceUrl?: string;
  referenceUrls?: string[];
  imageInputs?: Record<string, { role: ImagePortRole; urls: string[]; label: string }>;
}

export interface ModelAdapter {
  buildInput(request: GenerateRequest): Record<string, unknown>;
  extractImageUrls(result: { data?: { images?: Array<{ url: string }> } }): string[];
  getModelId?(request: GenerateRequest): string;
}

function getConcreteAspectRatio(aspectRatio: AspectRatio): Exclude<AspectRatio, 'auto'> {
  return aspectRatio === 'auto' ? DEFAULT_IMAGE_ASPECT_RATIO : aspectRatio;
}

function getImageInputUrls(request: GenerateRequest): string[] {
  if (request.imageInputs && Object.keys(request.imageInputs).length > 0) {
    return Object.values(request.imageInputs).flatMap((input) => input.urls);
  }
  return request.referenceUrls || (request.referenceUrl ? [request.referenceUrl] : []);
}

class DirectImageAdapter implements ModelAdapter {
  buildInput(request: GenerateRequest): Record<string, unknown> {
    const imageUrls = getImageInputUrls(request);
    return {
      prompt: request.prompt,
      aspect_ratio: getConcreteAspectRatio(request.aspectRatio),
      resolution: request.resolution || '1K',
      num_images: request.numImages || 1,
      ...(imageUrls.length > 0 && { image_urls: imageUrls }),
    };
  }

  extractImageUrls(result: { data?: { images?: Array<{ url: string }> } }): string[] {
    return result.data?.images?.map((img) => img.url) || [];
  }
}

const imageAdapters: Partial<Record<ImageModelType, ModelAdapter>> = {
  auto: new DirectImageAdapter(),
  'gpt-image-2': new DirectImageAdapter(),
  'gemini-3.1-flash-image-preview': new DirectImageAdapter(),
};

export function getModelAdapter(model: ImageModelType): ModelAdapter {
  return imageAdapters[model] || imageAdapters.auto!;
}

// ============================================
// VIDEO MODEL ADAPTERS
// ============================================

export interface VideoGenerateRequest {
  prompt: string;
  model: VideoModelType;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  resolution?: VideoResolution;
  referenceUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceUrls?: string[];
  videoUrl?: string;
  videoId?: string;
  audioUrl?: string;
  generateAudio?: boolean;
  heygenVoice?: string;
  characterIds?: string[];
}

export interface VideoModelAdapter {
  buildInput(request: VideoGenerateRequest): Record<string, unknown>;
  extractVideoUrl(result: Record<string, unknown>): string | undefined;
  extractVideoId?(result: Record<string, unknown>): string | undefined;
}

class DirectVideoAdapter implements VideoModelAdapter {
  buildInput(request: VideoGenerateRequest): Record<string, unknown> {
    return {
      prompt: request.prompt,
      model: request.model,
      aspect_ratio: request.aspectRatio,
      duration: request.duration,
      resolution: request.resolution,
      reference_url: request.referenceUrl,
      first_frame_url: request.firstFrameUrl,
      last_frame_url: request.lastFrameUrl,
      reference_urls: request.referenceUrls,
      video_url: request.videoUrl,
      audio_url: request.audioUrl,
      generate_audio: request.generateAudio,
    };
  }

  extractVideoUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { video?: { url?: string }; video_url?: string } | undefined;
    return data?.video?.url || data?.video_url;
  }
}

const videoAdapters: Partial<Record<VideoModelType, VideoModelAdapter>> = {
  auto: new DirectVideoAdapter(),
  'veo-3': new DirectVideoAdapter(),
  'veo-3.1-i2v': new DirectVideoAdapter(),
  'veo-3.1-fast-i2v': new DirectVideoAdapter(),
  'veo-3.1-ref': new DirectVideoAdapter(),
  'veo-3.1-flf': new DirectVideoAdapter(),
  'veo-3.1-fast-flf': new DirectVideoAdapter(),
  'ltx-2.3-i2v': new DirectVideoAdapter(),
  'ltx-2.3-fast-t2v': new DirectVideoAdapter(),
  'ltx-2.3-fast-i2v': new DirectVideoAdapter(),
  'ltx-2.3-retake-v2v': new DirectVideoAdapter(),
  'ltx-2.3-a2v': new DirectVideoAdapter(),
  'ltx-2.3-extend': new DirectVideoAdapter(),
  'seedance-2.0-t2v': new DirectVideoAdapter(),
  'seedance-2.0-i2v': new DirectVideoAdapter(),
  'seedance-2.0-fast-t2v': new DirectVideoAdapter(),
  'seedance-2.0-fast-i2v': new DirectVideoAdapter(),
};

export function getVideoModelAdapter(model: VideoModelType): VideoModelAdapter {
  return videoAdapters[model] || videoAdapters.auto!;
}

// ============================================
// AUDIO MODEL ADAPTERS
// ============================================

export interface MusicGenerateRequest {
  prompt: string;
  duration: MusicDuration;
  instrumental: boolean;
  guidanceScale: number;
}

export interface SpeechGenerateRequest {
  text: string;
  voice?: ElevenLabsVoice;
  speed?: number;
  stability?: number;
  audioUrl?: string;
  language?: TadaLanguage;
  referenceTranscript?: string;
}

export interface VideoAudioGenerateRequest {
  prompt?: string;
  videoUrl: string;
  audioUrl?: string;
  duration?: number;
  cfgStrength?: number;
  negativePrompt?: string;
  syncMode?: SyncLipsyncMode;
}

export interface AudioModelAdapter {
  buildInput(request: MusicGenerateRequest | SpeechGenerateRequest | VideoAudioGenerateRequest): Record<string, unknown>;
  extractAudioUrl(result: Record<string, unknown>): string | undefined;
}

class AceStepAdapter implements AudioModelAdapter {
  buildInput(request: MusicGenerateRequest): Record<string, unknown> {
    return {
      prompt: request.prompt,
      duration: request.duration,
      instrumental: request.instrumental,
      guidance_scale: request.guidanceScale,
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { audio?: { url: string } } | undefined;
    return data?.audio?.url;
  }
}

class ElevenLabsTTSAdapter implements AudioModelAdapter {
  buildInput(request: SpeechGenerateRequest): Record<string, unknown> {
    return {
      text: request.text,
      voice: request.voice,
      speed: request.speed,
      stability: request.stability,
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { audio?: { url: string } } | undefined;
    return data?.audio?.url;
  }
}

class LuxTTSAdapter implements AudioModelAdapter {
  buildInput(request: SpeechGenerateRequest): Record<string, unknown> {
    if (!request.audioUrl) {
      throw new Error('Lux TTS requires a reference audio clip');
    }

    return {
      prompt: request.text,
      audio_url: request.audioUrl,
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { audio?: { url?: string } } | undefined;
    return data?.audio?.url;
  }
}

class TadaTTSAdapter implements AudioModelAdapter {
  buildInput(request: SpeechGenerateRequest): Record<string, unknown> {
    if (!request.audioUrl) {
      throw new Error('Tada requires a reference audio clip');
    }

    return {
      prompt: request.text,
      audio_url: request.audioUrl,
      language: request.language || 'en',
      speed_up_factor: request.speed || 1,
      output_format: 'mp3',
      ...(request.referenceTranscript?.trim() && { transcript: request.referenceTranscript.trim() }),
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { audio?: { url?: string } } | undefined;
    return data?.audio?.url;
  }
}

class MMAudioV2Adapter implements AudioModelAdapter {
  buildInput(request: VideoAudioGenerateRequest): Record<string, unknown> {
    return {
      prompt: request.prompt || '',
      video_url: request.videoUrl,
      duration: request.duration || 10,
      cfg_strength: request.cfgStrength || 4.5,
      ...(request.negativePrompt && { negative_prompt: request.negativePrompt }),
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { video?: { url: string } } | undefined;
    return data?.video?.url;
  }
}

class SyncLipsyncAdapter implements AudioModelAdapter {
  buildInput(request: VideoAudioGenerateRequest): Record<string, unknown> {
    if (!request.audioUrl) {
      throw new Error('Sync Lipsync requires a connected audio track');
    }

    return {
      video_url: request.videoUrl,
      audio_url: request.audioUrl,
      sync_mode: request.syncMode || 'cut_off',
    };
  }

  extractAudioUrl(result: Record<string, unknown>): string | undefined {
    const data = result.data as { video?: { url?: string } } | undefined;
    return data?.video?.url;
  }
}

const audioAdapters: Record<AudioModelType, AudioModelAdapter> = {
  'ace-step': new AceStepAdapter(),
  'elevenlabs-tts': new ElevenLabsTTSAdapter(),
  'lux-tts': new LuxTTSAdapter(),
  'tada-3b-tts': new TadaTTSAdapter(),
  'mmaudio-v2': new MMAudioV2Adapter(),
  'sync-lipsync-v2-pro': new SyncLipsyncAdapter(),
};

export function getAudioModelAdapter(model: AudioModelType): AudioModelAdapter {
  return audioAdapters[model] || audioAdapters['ace-step'];
}
