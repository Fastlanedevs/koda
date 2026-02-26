/**
 * Storyboard Generator Schema
 *
 * Zod schemas for input validation and AI output structure.
 * System prompts, model-aware prompt profiles, and prompt builders.
 */

import { z } from 'zod';

// ============================================
// VIDEO MODEL FAMILIES
// ============================================

export const VIDEO_MODEL_FAMILIES = ['veo', 'kling', 'seedance'] as const;
export type VideoModelFamily = (typeof VIDEO_MODEL_FAMILIES)[number];

// ============================================
// INPUT SCHEMA (Client -> API)
// ============================================

/**
 * Input validation schema for storyboard generation
 */
export const StoryboardInputSchema = z.object({
  /** Product or subject for the storyboard */
  product: z.string().min(1, 'Product/subject is required'),
  /** Optional character description */
  character: z.string().optional(),
  /** Story concept or brief */
  concept: z.string().min(1, 'Concept is required'),
  /** Number of scenes to generate (4-8) */
  sceneCount: z.number().min(4).max(8).default(4),
  /** Visual style for the storyboard */
  style: z.enum([
    'cinematic',
    'anime',
    'photorealistic',
    'illustrated',
    'commercial',
  ]).default('cinematic'),
  /** Storyboard mode: 'transition' for video transitions between scenes, 'single-shot' for independent scene videos */
  mode: z.enum(['transition', 'single-shot']).default('transition'),
  /** Target video model family for prompt optimization */
  targetVideoModel: z.enum(VIDEO_MODEL_FAMILIES).default('veo'),
});

export type StoryboardInput = z.infer<typeof StoryboardInputSchema>;

// ============================================
// OUTPUT SCHEMA (AI -> Client)
// ============================================

/**
 * Single scene in a storyboard
 */
export const StoryboardSceneSchema = z.object({
  /** Scene number (1-indexed) */
  number: z.number(),
  /** Short title for the scene */
  title: z.string(),
  /** Description of what happens in this scene */
  description: z.string(),
  /** Detailed image generation prompt (structured, min 80 chars) */
  prompt: z.string().min(1),
  /** Camera direction/angle */
  camera: z.string(),
  /** Mood/atmosphere */
  mood: z.string(),
  /** Video transition prompt describing motion from this scene to the next (transition mode only, optional for last scene) */
  transition: z.string().optional(),
  /** Video motion prompt describing action within this scene (single-shot mode only) */
  motion: z.string().optional(),
  /** Negative prompt — what to exclude from generation */
  negativePrompt: z.string().optional(),
  /** Audio direction — SFX, ambient, dialogue cues */
  audioDirection: z.string().optional(),
});

export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

/**
 * Complete storyboard output from AI
 */
export const StoryboardOutputSchema = z.object({
  /** Array of scenes */
  scenes: z.array(StoryboardSceneSchema),
  /** Brief summary of the storyboard */
  summary: z.string(),
  /** Consistent identity description for the product/subject — repeat verbatim in every scene prompt */
  productIdentity: z.string().optional(),
  /** Consistent identity description for the character — repeat verbatim in every scene prompt */
  characterIdentity: z.string().optional(),
});

export type StoryboardOutput = z.infer<typeof StoryboardOutputSchema>;

// ============================================
// MODEL-AWARE VIDEO PROMPT PROFILES (#69)
// ============================================

export interface VideoPromptProfile {
  maxWords: number;
  structure: string;
  imagePromptTips: string[];
  videoPromptTips: string[];
  exampleImagePrompt: string;
  exampleTransition: string;
  exampleMotion: string;
  negativePromptTips: string;
}

export const VIDEO_PROMPT_PROFILES: Record<VideoModelFamily, VideoPromptProfile> = {
  veo: {
    maxWords: 60,
    structure: 'Natural prose following: [Camera + lens] [Subject] [Action + physics], [Setting + atmosphere], [Lighting]. Include SFX: prefix for sound effects and quotes for dialogue.',
    imagePromptTips: [
      'Use 5-part formula: Cinematography + Subject + Action + Setting + Style',
      'Specify lens (35mm, 85mm, etc.) and depth of field',
      'Include lighting direction and color temperature explicitly',
      'These images become video keyframes — ensure subjects are in poses that can naturally transition to motion',
    ],
    videoPromptTips: [
      'Describe the journey/motion between frames, NOT the static endpoints',
      'Include audio direction: SFX: prefix for sound effects, quotes for dialogue, ambient descriptions',
      'Use precise cinematography terms: dolly in, tracking shot, crane up, slow pan',
      'One primary camera movement per prompt — do NOT stack competing moves',
      'Include physics and temporal flow: "steam curling upward", "hair settling after movement"',
      'Keep prompts 40-60 words, 3-4 sentences',
    ],
    exampleImagePrompt: 'Close-up with shallow depth of field, 35mm lens. A young woman with auburn hair holds a matte black ceramic mug, steam rising from the surface. Golden hour light streams through rain-streaked cafe windows, casting warm amber tones across her face. Cinematic color grading, soft bokeh background.',
    exampleTransition: 'Slow dolly in as she raises the mug to her lips, steam curling upward and catching the golden backlight. Her eyes close as she takes the first sip. SFX: ceramic scrape on wood, gentle coffee shop murmur, soft jazz in background.',
    exampleMotion: 'She lifts the mug with both hands, steam rising and swirling in the warm backlight. Camera holds steady with subtle push-in, shallow depth of field keeping focus on her expression. SFX: gentle sip, mug settling on saucer, ambient cafe chatter.',
    negativePromptTips: 'motion blur, face distortion, warping, morphing, duplicate limbs, text overlay',
  },
  kling: {
    maxWords: 50,
    structure: 'Concrete action-based sentences: Subject + Movement, Background + Movement. Always specify motion endpoints to prevent generation hangs. Pair camera movement with a target.',
    imagePromptTips: [
      'Use 4-part structure: Subject + Action + Context (3-5 elements) + Style',
      'Keep descriptions concrete and action-oriented, not abstract',
      'Avoid specifying exact counts of objects (the model struggles with this)',
      'Include one clear visual anchor — do not overload the frame',
    ],
    videoPromptTips: [
      'Always give motion a clear END STATE to prevent generation hanging at 99%',
      'Pair every camera movement with a target: "camera dollies in on her eyes" not just "dolly in"',
      'Keep to 1-3 actions maximum per shot',
      'Use motivated camera movement — every move should serve narrative purpose',
      'Describe speed explicitly: "slowly raises", "quick turn", "gentle drift"',
      'Keep prompts 30-50 words, concise and direct',
    ],
    exampleImagePrompt: 'A young woman with auburn hair in a leather jacket sits at a wooden cafe table, both hands wrapped around a matte black ceramic mug. Warm pendant lights overhead, steam rising from the cup. Shallow depth of field, cinematic color grading, warm amber tones.',
    exampleTransition: 'Camera tracks alongside as she lifts the mug from the table and takes a slow sip, then gently sets it back down. Her eyes shift from the mug to the rain-streaked window. Hair settles after the movement. Warm overhead lighting.',
    exampleMotion: 'She picks up the coffee mug and takes a deliberate sip, then sets it down with a soft clink. Camera holds steady at medium close-up. Warm overhead pendant lighting, steam dissipates after the sip.',
    negativePromptTips: 'blur, distortion, watermark, text overlay, low quality, flickering, morphing faces, extra limbs',
  },
  seedance: {
    maxWords: 40,
    structure: 'Card-style with labeled sections. Pin the subject in the first 20 words. Use Camera: [move + speed + stability], Style: [one anchor]. Short structured prompts outperform long prose.',
    imagePromptTips: [
      'Pin the main subject in the first 20 words — this is critical for Seedance',
      'Use structured card format: Subject, Camera, Lighting, Style as separate concepts',
      'Pick ONE visual style anchor (not six adjectives)',
      'Short prompts (30-80 words) consistently outperform long ones',
    ],
    videoPromptTips: [
      'Pin subject in first 20 words of the prompt or character consistency breaks',
      'Use labeled Camera: section with [move + speed + stability]',
      'One primary camera move per shot — compound moves produce visual chaos',
      'Include explicit speed: slow, medium, fast',
      'Include stability type: tripod, handheld, gimbal',
      'Keep prompts 20-40 words, card-style structure preferred',
    ],
    exampleImagePrompt: 'A young woman with auburn hair in a leather jacket holds a matte black ceramic mug at a wooden cafe table. Camera: medium close-up, eye-level. Soft warm pendant lighting from above, shallow depth of field. Cinematic style, warm amber tones.',
    exampleTransition: 'Woman lifts mug toward her lips, steam rising. Camera: slow dolly in, gimbal smooth. Warm amber tones, shallow depth of field, cinematic style.',
    exampleMotion: 'Woman sips from mug, steam curling upward, then sets it down. Camera: close-up, slow push-in, tripod. Soft morning light, warm tones, commercial style.',
    negativePromptTips: 'blur, flicker, style drift, warping, duplicate subjects',
  },
};

// ============================================
// SYSTEM PROMPTS (Mode + Model Aware)
// ============================================

/**
 * Base guidelines for all storyboard generation
 */
const STORYBOARD_BASE_GUIDELINES = `You are an expert storyboard artist and creative director specializing in visual storytelling for advertising and content creation.

Your task is to break down a concept into a series of scenes optimized for AI image generation and AI video generation.

CRITICAL: These images will be used as VIDEO KEYFRAMES. Ensure subjects are in poses that can naturally transition to motion. Prefer compositions with clear foreground/background separation. Avoid extreme close-ups that leave no room for camera movement.

IDENTITY CONSISTENCY:
If a character is specified, generate a "characterIdentity" field with an exact appearance description (age, hair, clothing, distinguishing features). Repeat this description VERBATIM in every scene's "prompt" field to prevent character drift across scenes.
Similarly, generate a "productIdentity" field with an exact product description. Repeat in every scene prompt.

For each scene, provide:

- **title**: A short, descriptive title (2-5 words)

- **description**: What happens in this scene (1-2 sentences)

- **prompt**: A detailed image generation prompt using this STRUCTURED FORMAT:
  [Subject with identity details], [action in present tense].
  [Camera: shot type, one camera movement, lens/DoF hint].
  [Setting: location, time of day, weather/atmosphere].
  [Lighting: direction, quality, color temperature].
  [Style: one anchor keyword matching the requested style].
  Minimum 80 characters. Include the product/subject prominently.

  GOOD image prompt example:
  "Close-up with shallow depth of field, 35mm lens. A young woman with auburn hair and a red scarf holds a matte black ceramic mug, steam rising from the surface. Golden hour light streams through rain-streaked cafe windows, warm amber tones. Cinematic color grading, soft bokeh."

  BAD image prompt example (too vague):
  "A woman drinking coffee in a nice cafe with good lighting."

- **camera**: Camera shot type (e.g., "wide shot", "medium close-up", "over-the-shoulder", "aerial view", "low angle")

- **mood**: The emotional tone (e.g., "warm and inviting", "dramatic tension", "peaceful serenity")

- **negativePrompt**: What to EXCLUDE from this scene's generation (e.g., "motion blur, face distortion, text overlay"). Keep short, 5-10 terms.

- **audioDirection**: Sound design for this scene — ambient sounds, SFX, music cues, or dialogue. (e.g., "SFX: ceramic scrape on wood, soft jazz, cafe murmur" or "Quiet tension, distant thunder, no music")

Guidelines:
1. Maintain visual continuity across scenes — same character appearance, wardrobe, props
2. Include the product/subject consistently and prominently in each scene
3. If a character is specified, use the EXACT same identity description in every scene prompt
4. Build a narrative arc: establish → develop → climax → resolve
5. Vary camera angles and compositions for visual interest (wide → medium → close-up → wide)
6. Match all prompts to the specified visual style
7. Every prompt must be at least 80 characters with specific details — never generic`;

/**
 * Build mode-specific video prompt instructions
 */
function buildTransitionInstructions(profile: VideoPromptProfile): string {
  const tips = profile.videoPromptTips.map((t) => `  - ${t}`).join('\n');

  return `
TRANSITION VIDEO PROMPTS:
- **transition**: (REQUIRED for all scenes EXCEPT the last one) A video prompt describing the motion and action from THIS scene to the NEXT scene. This drives AI video generation between keyframes.

Structure: ${profile.structure}
Target length: ${profile.maxWords} words maximum.

Rules:
${tips}

GOOD transition example:
"${profile.exampleTransition}"

BAD transition example (too vague, no camera, no physics, no audio):
"Camera moves to next scene smoothly."

IMPORTANT: Write transition prompts that describe realistic camera movements WITH subject actions that bridge consecutive scenes. Do NOT generate "motion" fields.`;
}

function buildMotionInstructions(profile: VideoPromptProfile): string {
  const tips = profile.videoPromptTips.map((t) => `  - ${t}`).join('\n');

  return `
SINGLE-SHOT MOTION PROMPTS:
- **motion**: (REQUIRED for ALL scenes) A video prompt describing the action and movement WITHIN this scene. Each scene generates its own independent video clip.

Structure: ${profile.structure}
Target length: ${profile.maxWords} words maximum.

Rules:
${tips}

GOOD motion example:
"${profile.exampleMotion}"

BAD motion example (too vague, no endpoint, will cause generation to hang):
"Person does stuff with the product."

IMPORTANT: Write motion prompts that describe self-contained action within each scene. Always give motion a clear end state. Do NOT generate "transition" fields.`;
}

/**
 * Get the appropriate system prompt based on mode and target video model
 */
export function getSystemPrompt(
  mode: 'transition' | 'single-shot',
  targetVideoModel: VideoModelFamily = 'veo',
): string {
  const profile = VIDEO_PROMPT_PROFILES[targetVideoModel];
  const imageTips = profile.imagePromptTips.map((t) => `- ${t}`).join('\n');

  const modelSection = `
MODEL-SPECIFIC IMAGE PROMPT TIPS (optimized for ${targetVideoModel.toUpperCase()}):
${imageTips}

Example image prompt for this model:
"${profile.exampleImagePrompt}"

Default negative prompt terms: ${profile.negativePromptTips}`;

  const videoSection = mode === 'single-shot'
    ? buildMotionInstructions(profile)
    : buildTransitionInstructions(profile);

  return `${STORYBOARD_BASE_GUIDELINES}
${modelSection}
${videoSection}`;
}

/**
 * Legacy exports for backwards compatibility
 */
export const STORYBOARD_TRANSITION_PROMPT = getSystemPrompt('transition', 'veo');
export const STORYBOARD_SINGLE_SHOT_PROMPT = getSystemPrompt('single-shot', 'veo');
export const STORYBOARD_SYSTEM_PROMPT = STORYBOARD_TRANSITION_PROMPT;

// ============================================
// PROMPT BUILDER
// ============================================

/**
 * Build the user prompt from input data
 */
export function buildStoryboardPrompt(input: StoryboardInput): string {
  const characterLine = input.character
    ? `\nCharacter: ${input.character}`
    : '';

  const targetModel = input.targetVideoModel || 'veo';
  const profile = VIDEO_PROMPT_PROFILES[targetModel];

  const modeInstruction = input.mode === 'single-shot'
    ? `\n\nMODE: Single-Shot — Generate a "motion" field for EVERY scene describing action within that scene (${profile.maxWords} words max each). Do NOT generate "transition" fields.`
    : `\n\nMODE: Transition — Generate a "transition" field for ALL scenes EXCEPT the last one, describing motion to the next scene (${profile.maxWords} words max each). Do NOT generate "motion" fields.`;

  return `Create a ${input.sceneCount}-scene storyboard for:

Product/Subject: ${input.product}${characterLine}
Concept: ${input.concept}
Style: ${input.style}
Target Video Model: ${targetModel.toUpperCase()}${modeInstruction}

Generate exactly ${input.sceneCount} scenes that tell a compelling visual story.
For EVERY scene, include: prompt (80+ chars), camera, mood, negativePrompt, audioDirection.
${input.character ? 'Generate characterIdentity and productIdentity fields and repeat them verbatim in each scene prompt.' : 'Generate a productIdentity field and repeat it verbatim in each scene prompt.'}`;
}

// ============================================
// REFINEMENT PROMPT BUILDERS
// ============================================

/**
 * Build a refinement system prompt that wraps the base system prompt
 * with additional instructions for iterative editing.
 */
export function getRefinementSystemPrompt(
  mode: 'transition' | 'single-shot',
  targetVideoModel: VideoModelFamily = 'veo',
): string {
  return `${getSystemPrompt(mode, targetVideoModel)}

REFINEMENT MODE:
You are refining an existing storyboard based on user feedback. Follow these rules:
1. Apply the user's feedback precisely — change only what they ask for.
2. Preserve unchanged scenes VERBATIM — copy exact prompts, camera, mood, transition/motion, negativePrompt, audioDirection.
3. Maintain narrative continuity and visual consistency across scenes.
4. Output ALL scenes in the storyboard, not just the changed ones.
5. Keep the same number of scenes unless the user explicitly requests adding or removing scenes.
6. Preserve productIdentity and characterIdentity unless the user asks to change them.`;
}

/**
 * Build a refinement user prompt with the FULL previous draft context + feedback.
 * Includes complete prompt text so the LLM doesn't regenerate from scratch. (#70)
 */
export function buildRefinementPrompt(
  previousDraft: {
    scenes: Array<{
      number: number;
      title: string;
      description: string;
      prompt: string;
      camera: string;
      mood: string;
      transition?: string;
      motion?: string;
      negativePrompt?: string;
      audioDirection?: string;
    }>;
    summary: string;
    productIdentity?: string;
    characterIdentity?: string;
  },
  feedback: string,
  mode: 'transition' | 'single-shot',
): string {
  const sceneDetails = previousDraft.scenes.map((s) => {
    let detail = `  Scene ${s.number}: "${s.title}"
    Description: ${s.description}
    Camera: ${s.camera} | Mood: ${s.mood}
    Image Prompt: ${s.prompt}`;
    if (s.transition) detail += `\n    Transition: ${s.transition}`;
    if (s.motion) detail += `\n    Motion: ${s.motion}`;
    if (s.negativePrompt) detail += `\n    Negative: ${s.negativePrompt}`;
    if (s.audioDirection) detail += `\n    Audio: ${s.audioDirection}`;
    return detail;
  }).join('\n\n');

  const identitySection = [
    previousDraft.productIdentity && `Product Identity: ${previousDraft.productIdentity}`,
    previousDraft.characterIdentity && `Character Identity: ${previousDraft.characterIdentity}`,
  ].filter(Boolean).join('\n');

  return `Here is the current storyboard (${previousDraft.scenes.length} scenes):

Summary: ${previousDraft.summary}
${identitySection ? `\n${identitySection}\n` : ''}
Scenes:
${sceneDetails}

USER FEEDBACK:
${feedback}

Please update the storyboard based on the feedback above. Output ALL ${previousDraft.scenes.length} scenes${mode === 'transition' ? ' with transitions' : ' with motion prompts'}. Preserve unchanged scenes VERBATIM — do not rewrite prompts that the user did not ask to change.`;
}
