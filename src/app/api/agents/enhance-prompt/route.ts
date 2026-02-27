import { NextResponse } from 'next/server';
import { Agent } from '@mastra/core/agent';
import { mastra } from '@/mastra';
import { PROMPT_ENHANCER_MODEL } from '@/mastra/models';

export const maxDuration = 60;

const SVG_ENHANCER_INSTRUCTIONS = `You are an expert prompt engineer for AI SVG generation.
Your job is to take a user's basic prompt and enhance it to produce better vector SVG results.

Guidelines:
1. Keep the core concept/subject from the original prompt
2. Add specific details about:
   - Visual style (flat design, line art, geometric, isometric, minimalist, duotone, etc.)
   - Color palette (specific colors, gradients, monochrome, vibrant, muted)
   - Composition (centered icon, full scene, symmetrical, layered)
   - Shape language (rounded, angular, organic curves, geometric primitives)
   - Detail level (simple icon, detailed illustration, complex scene)
3. Keep the enhanced prompt concise (under 150 words)
4. Don't add elements that contradict the original intent
5. Focus on vector-friendly descriptions (clean shapes, clear outlines, solid fills)
6. Avoid photorealistic descriptors (8k, photograph, etc.) — this is for SVG

Output ONLY the enhanced prompt, nothing else.`;

export async function POST(request: Request) {
  try {
    const { prompt, type } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    let response;

    if (type === 'svg') {
      const svgEnhancer = new Agent({
        id: 'svg-prompt-enhancer',
        name: 'SVG Prompt Enhancer',
        instructions: SVG_ENHANCER_INSTRUCTIONS,
        model: PROMPT_ENHANCER_MODEL,
      });
      response = await svgEnhancer.generate(prompt);
    } else {
      const agent = mastra.getAgent('promptEnhancer');
      response = await agent.generate(prompt);
    }

    return NextResponse.json({
      success: true,
      originalPrompt: prompt,
      enhancedPrompt: response.text,
    });
  } catch (error) {
    console.error('Agent error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent failed' },
      { status: 500 }
    );
  }
}
