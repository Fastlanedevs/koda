'use client';

import { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { PluginNodeData } from '@/lib/types';
import { useCanvasStore } from '@/stores/canvas-store';
import { PenTool, Loader2, RefreshCw, Type, ImageIcon, Code } from 'lucide-react';
import { createDefaultSvgStudioState, type SvgStudioNodeData, type SvgStudioState } from './types';

function SvgStudioNodeComponent({ id, data, selected }: NodeProps<Node<PluginNodeData, 'pluginNode'>>) {
  const nodeData = data as unknown as SvgStudioNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const isReadOnly = useCanvasStore((s) => s.isReadOnly);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nodeName, setNodeName] = useState(nodeData.name || 'SVG Studio');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameSubmit = useCallback(() => {
    setIsEditingName(false);
    if (nodeName.trim() && nodeName !== (nodeData.name || 'SVG Studio')) {
      updateNodeData(id, { name: nodeName.trim() });
    }
  }, [id, nodeName, nodeData.name, updateNodeData]);

  const state: SvgStudioState = useMemo(() => {
    const base = createDefaultSvgStudioState();
    if (!nodeData.state) return base;
    return { ...base, ...nodeData.state };
  }, [nodeData.state]);

  const updateState = (patch: Partial<SvgStudioState>) => {
    updateNodeData(id, {
      state: {
        ...state,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const submit = async () => {
    if (!state.prompt.trim() || isSubmitting) return;

    setIsSubmitting(true);
    updateState({ phase: 'working', error: undefined });

    try {
      const res = await fetch('/api/plugins/svg-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: state.mode,
          prompt: state.prompt.trim(),
          svg: state.mode === 'edit' ? state.sourceSvg : undefined,
          persistAsset: true,
          nodeId: id,
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'SVG generation failed');
      }

      updateNodeData(id, {
        outputUrl: payload.asset?.url,
        outputMimeType: payload.asset?.mimeType ?? 'image/svg+xml',
        outputType: 'image',
        outputSvgCode: payload.svg,
      });

      updateState({
        phase: 'ready',
        svg: payload.svg,
        metadata: payload.metadata,
        asset: payload.asset,
        error: undefined,
      });
    } catch (err) {
      updateState({
        phase: 'error',
        error: err instanceof Error ? err.message : 'SVG generation failed',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {/* Node Title */}
      <div className="flex items-center gap-2 mb-2 text-sm font-medium" style={{ color: 'var(--node-title-svg)' }}>
        <PenTool className="h-4 w-4" />
        {isEditingName && !isReadOnly ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') {
                setNodeName(nodeData.name || 'SVG Studio');
                setIsEditingName(false);
              }
            }}
            className="bg-transparent border-b outline-none px-0.5 min-w-[100px]"
            style={{ borderColor: 'var(--input-border)', color: 'var(--text-secondary)' }}
          />
        ) : (
          <span
            onDoubleClick={() => !isReadOnly && setIsEditingName(true)}
            className={`transition-colors hover:opacity-80 ${isReadOnly ? 'cursor-default' : 'cursor-text'}`}
          >
            {nodeData.name || 'SVG Studio'}
          </span>
        )}
      </div>

      <div className={`relative w-[420px] rounded-2xl overflow-visible ${selected ? 'node-card-selected' : 'node-card'}`}>
        <div className="p-3 space-y-2">
        <div className="flex gap-1">
          <button
            onClick={() => updateState({ mode: 'generate' })}
            className={`px-2 py-1 text-xs rounded ${state.mode === 'generate' ? 'bg-muted text-foreground' : 'bg-muted/40 text-muted-foreground'}`}
          >
            Generate
          </button>
          <button
            onClick={() => updateState({ mode: 'edit' })}
            className={`px-2 py-1 text-xs rounded ${state.mode === 'edit' ? 'bg-muted text-foreground' : 'bg-muted/40 text-muted-foreground'}`}
          >
            Edit
          </button>
        </div>

        <div className="node-content-area p-2">
          <textarea
            value={state.prompt}
            onChange={(e) => updateState({ prompt: e.target.value })}
            placeholder="Describe the SVG you want to create..."
            className="w-full min-h-[74px] text-xs bg-transparent border-none text-foreground resize-none focus:outline-none"
            aria-label="SVG prompt"
          />
        </div>

        {state.mode === 'edit' && (
          <div className="node-content-area p-2">
            <textarea
              value={state.sourceSvg || ''}
              onChange={(e) => updateState({ sourceSvg: e.target.value })}
              placeholder="Paste existing SVG to edit"
              className="w-full min-h-[90px] text-[10px] bg-transparent border-none text-muted-foreground resize-none font-mono focus:outline-none"
              aria-label="Source SVG"
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={submit}
            disabled={isSubmitting || !state.prompt.trim()}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs text-white"
            aria-label="Generate SVG"
          >
            {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Run'}
          </button>

          {state.phase === 'ready' && (
            <button
              onClick={() => updateState({ svg: undefined, metadata: undefined, asset: undefined, phase: 'idle' })}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>

        {state.error && <div className="text-xs text-red-400">{state.error}</div>}

        {state.svg && (
          <div className="rounded border border-border bg-muted/50 p-2">
            <div className="text-[10px] text-muted-foreground mb-1">
              Paths: {state.metadata?.pathCount ?? 0} · Elements: {state.metadata?.elementCount ?? 0}
            </div>
            <div className="bg-white rounded p-1 max-h-[220px] overflow-auto">
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(state.svg)}`} alt="SVG output" className="max-w-full h-auto" />
            </div>
          </div>
        )}
      </div>

      {/* Input Handle - Text (left top) */}
      <div className="absolute -left-3 group" style={{ top: '30%', transform: 'translateY(-50%)' }}>
        <div className="relative">
          <Handle type="target" position={Position.Left} id="text" className="!relative !transform-none !w-7 !h-7 !border-2 !rounded-full !bg-yellow-500 !border-zinc-900 hover:!border-zinc-700" />
          <Type className="absolute inset-0 m-auto h-3.5 w-3.5 pointer-events-none text-zinc-900" />
        </div>
        <span className="absolute left-9 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border node-tooltip">Text input</span>
      </div>

      {/* Input Handle - Image ref (left bottom) */}
      <div className="absolute -left-3 group" style={{ top: '70%', transform: 'translateY(-50%)' }}>
        <div className="relative">
          <Handle type="target" position={Position.Left} id="reference" className="!relative !transform-none !w-7 !h-7 !border-2 !rounded-full !bg-red-400 !border-zinc-900 hover:!border-zinc-700" />
          <ImageIcon className="absolute inset-0 m-auto h-3.5 w-3.5 pointer-events-none text-zinc-900" />
        </div>
        <span className="absolute left-9 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border node-tooltip">Image reference</span>
      </div>

      {/* Output Handle - Image (right top) */}
      <div className="absolute -right-3 group" style={{ top: '30%', transform: 'translateY(-50%)' }}>
        <div className="relative">
          <Handle type="source" position={Position.Right} id="image-output" className="!relative !transform-none !w-7 !h-7 !border-2 !rounded-full !bg-teal-500 !border-zinc-900 hover:!border-zinc-700" />
          <ImageIcon className="absolute inset-0 m-auto h-3.5 w-3.5 pointer-events-none text-zinc-900" />
        </div>
        <span className="absolute right-9 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border node-tooltip">SVG image</span>
      </div>

      {/* Output Handle - Code (right bottom) */}
      <div className="absolute -right-3 group" style={{ top: '70%', transform: 'translateY(-50%)' }}>
        <div className="relative">
          <Handle type="source" position={Position.Right} id="code-output" className="!relative !transform-none !w-7 !h-7 !border-2 !rounded-full !bg-emerald-500 !border-zinc-900 hover:!border-zinc-700" />
          <Code className="absolute inset-0 m-auto h-3.5 w-3.5 pointer-events-none text-zinc-900" />
        </div>
        <span className="absolute right-9 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border node-tooltip">SVG code</span>
      </div>
      </div>
    </div>
  );
}

export const SvgStudioNode = memo(SvgStudioNodeComponent);
