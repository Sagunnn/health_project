/**
 * Client-side image downscaling for label uploads.
 *
 * Phone photos are routinely 2–5 MB, and base64 encoding adds ~33%. Vercel
 * caps serverless request bodies at 4.5 MB, so an un-resized photo fails in
 * production with a 413 while working fine against `next dev`, which has no
 * such limit. Downscaling before upload also cuts Gemini latency, which is
 * dominated by image size, and costs nothing in OCR accuracy — label text is
 * comfortably legible at 1600px on the long edge.
 *
 * Browser-only: every entry point is called from an event handler.
 */

export interface DownscaleOptions {
  /** Longest edge of the output, in pixels. */
  maxEdge?: number;
  /** Initial JPEG quality (0–1). */
  quality?: number;
  /** Ceiling for the resulting data: URL length, in characters ≈ bytes. */
  maxBytes?: number;
}

export interface DownscaleResult {
  dataUrl: string;
  width: number;
  height: number;
  /** Length of the data: URL, i.e. what the request body will carry. */
  bytes: number;
  originalBytes: number;
  /** False when the original was returned unchanged. */
  resized: boolean;
}

const DEFAULTS = {
  maxEdge: 1600,
  quality: 0.8,
  // Well under Vercel's 4.5 MB body limit, leaving room for JSON overhead.
  maxBytes: 3_000_000,
};

/** Progressively harsher fallbacks if the first encode is still too large. */
const FALLBACKS: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1280, quality: 0.7 },
  { maxEdge: 1024, quality: 0.6 },
  { maxEdge: 800, quality: 0.5 },
];

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unexpected FileReader result."));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(file);
  });
}

/**
 * Decodes to a bitmap, honouring EXIF orientation.
 *
 * `imageOrientation: "from-image"` matters for phone photos: without it a
 * portrait shot decodes sideways and the OCR quality drops sharply.
 */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari fell back historically; fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The image could not be decoded."));
      img.src = url;
    });
  } finally {
    // Safe to revoke once decoding has settled; the bitmap is already drawn.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function dimensionsOf(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ("naturalWidth" in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function encode(
  source: ImageBitmap | HTMLImageElement,
  natural: { width: number; height: number },
  maxEdge: number,
  quality: number,
): { dataUrl: string; width: number; height: number } | null {
  const longest = Math.max(natural.width, natural.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // White backdrop so transparent PNGs do not encode as black under JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

/**
 * Downscales `file` to a JPEG data: URL small enough to POST.
 *
 * Falls back to the original bytes if the browser cannot decode or encode it,
 * so an unusual format degrades to the previous behaviour rather than
 * blocking the scan outright.
 */
export async function downscaleImage(
  file: File,
  options: DownscaleOptions = {},
): Promise<DownscaleResult> {
  const { maxEdge, quality, maxBytes } = { ...DEFAULTS, ...options };
  const originalBytes = file.size;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    const dataUrl = await readAsDataUrl(file);
    return {
      dataUrl,
      width: 0,
      height: 0,
      bytes: dataUrl.length,
      originalBytes,
      resized: false,
    };
  }

  try {
    const natural = dimensionsOf(source);
    const attempts = [{ maxEdge, quality }, ...FALLBACKS];

    let last: { dataUrl: string; width: number; height: number } | null = null;
    for (const attempt of attempts) {
      const encoded = encode(source, natural, attempt.maxEdge, attempt.quality);
      if (!encoded) break;
      last = encoded;
      if (encoded.dataUrl.length <= maxBytes) break;
    }

    if (!last) {
      const dataUrl = await readAsDataUrl(file);
      return {
        dataUrl,
        width: natural.width,
        height: natural.height,
        bytes: dataUrl.length,
        originalBytes,
        resized: false,
      };
    }

    return {
      dataUrl: last.dataUrl,
      width: last.width,
      height: last.height,
      bytes: last.dataUrl.length,
      originalBytes,
      resized: true,
    };
  } finally {
    if ("close" in source && typeof source.close === "function") source.close();
  }
}
