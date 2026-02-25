import type { AppNode, AppEdge } from './types';

// Helper to download a blob
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Export canvas as JSON workflow
export const exportAsJSON = (
  nodes: AppNode[],
  edges: AppEdge[],
  spaceName: string
) => {
  const data = {
    version: '1.0',
    spaceName,
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });

  const filename = `${spaceName.replace(/\s+/g, '-').toLowerCase()}-workflow.json`;
  downloadBlob(blob, filename);
};

// Export canvas as PNG screenshot
export const exportAsPNG = async (
  canvasElement: HTMLElement,
  spaceName: string
) => {
  try {
    const { toPng } = await import('html-to-image');

    const dataUrl = await toPng(canvasElement, {
      backgroundColor: '#09090b',
      cacheBust: true,
      pixelRatio: 2,
      skipFonts: true,
      imagePlaceholder:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==',
      filter: (node: HTMLElement) => {
        if (node.tagName) {
          const tag = node.tagName.toLowerCase();
          if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe') return false;
        }
        if (node.classList) {
          if (
            node.classList.contains('react-flow__minimap') ||
            node.classList.contains('react-flow__controls') ||
            node.classList.contains('react-flow__panel')
          ) return false;
        }
        return true;
      },
    });

    // Convert data URL to blob
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    const bytes = atob(base64);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    const blob = new Blob([buf], { type: mime });

    const filename = `${spaceName.replace(/\s+/g, '-').toLowerCase()}-canvas.png`;
    downloadBlob(blob, filename);
  } catch (error) {
    console.error('Failed to export as PNG:', error);
    throw error;
  }
};
