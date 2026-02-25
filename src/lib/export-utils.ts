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
    const { toBlob } = await import('html-to-image');

    const blob = await toBlob(canvasElement, {
      backgroundColor: '#09090b',
      cacheBust: true,
      pixelRatio: 2,
    });

    if (blob) {
      const filename = `${spaceName.replace(/\s+/g, '-').toLowerCase()}-canvas.png`;
      downloadBlob(blob, filename);
    }
  } catch (error) {
    console.error('Failed to export as PNG:', error);
    throw error;
  }
};
