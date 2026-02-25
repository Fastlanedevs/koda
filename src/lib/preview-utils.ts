import { toBlob } from 'html-to-image';

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;

export async function captureCanvasPreview(canvasElement: HTMLElement): Promise<Blob> {
  // html-to-image uses browser-native SVG foreignObject rendering,
  // so it handles all modern CSS (oklch, oklab, lab, etc.) that html2canvas cannot.
  const sourceBlob = await toBlob(canvasElement, {
    backgroundColor: '#09090b',
    width: canvasElement.offsetWidth,
    height: canvasElement.offsetHeight,
    cacheBust: true,
  });

  if (!sourceBlob) {
    throw new Error('CAPTURE_FAILED');
  }

  // Resize to 640x360 JPEG thumbnail
  const img = await createImageBitmap(sourceBlob);

  const output = document.createElement('canvas');
  output.width = PREVIEW_WIDTH;
  output.height = PREVIEW_HEIGHT;

  const ctx = output.getContext('2d');
  if (!ctx) {
    throw new Error('CAPTURE_FAILED');
  }

  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  // Fit source into 16:9 output (contain)
  const ratio = Math.min(PREVIEW_WIDTH / img.width, PREVIEW_HEIGHT / img.height);
  const width = img.width * ratio;
  const height = img.height * ratio;
  const x = (PREVIEW_WIDTH - width) / 2;
  const y = (PREVIEW_HEIGHT - height) / 2;
  ctx.drawImage(img, x, y, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    output.toBlob(resolve, 'image/jpeg', 0.78);
  });

  if (!blob) {
    throw new Error('CAPTURE_FAILED');
  }

  return blob;
}

export function makeThumbnailVersion(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function withThumbnailVersion(url: string, version?: string): string {
  if (!version) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}
