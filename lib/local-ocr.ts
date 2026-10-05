/**
 * On-device label OCR.
 *
 * Runs Tesseract in the browser so the common case costs no API quota and no
 * network round trip for the image. Gemini becomes the fallback for labels
 * this cannot read, rather than the default path for every scan.
 *
 * Tesseract is loaded with a dynamic import so its WASM never enters the main
 * bundle; the worker and language data are fetched on first use and cached by
 * the browser thereafter.
 *
 * What comes back is a *proposal*. On-device OCR misreads curved boxes, glare
 * and small print, and a dropped ingredient would otherwise clear a product
 * that is not clear — so the caller must show this to the athlete to confirm
 * or correct before the rules engine runs.
 */

import { parseLabelText, type ParsedLabel } from "@/lib/label-text";

export interface LocalOcrResult extends ParsedLabel {
  /** Raw recognised text, shown so the athlete can see what was read. */
  text: string;
  /** Tesseract's mean confidence, 0–100. */
  confidence: number;
  durationMs: number;
}

export type OcrProgress = (fraction: number) => void;

/**
 * Grayscale and stretch contrast before recognition.
 *
 * Tesseract is markedly better on flat high-contrast text than on the
 * saturated colour packaging that medicine boxes use.
 */
async function preprocess(dataUrl: string): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;

  let min = 255;
  let max = 0;
  const grey = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) | 0;
    grey[p] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = ((grey[p]! - min) * 255) / span;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Recognises a label and parses it. Throws if Tesseract cannot start. */
export async function readLabelLocally(
  dataUrl: string,
  onProgress?: OcrProgress,
): Promise<LocalOcrResult> {
  const startedAt = Date.now();
  const { createWorker } = await import("tesseract.js");

  let source = dataUrl;
  try {
    source = await preprocess(dataUrl);
  } catch {
    // Preprocessing is an optimisation; recognise the original if it fails.
  }

  const worker = await createWorker("eng", undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && m.status === "recognizing text") onProgress(m.progress);
    },
  });

  try {
    const { data } = await worker.recognize(source);
    const parsed = parseLabelText(data.text ?? "");
    return {
      ...parsed,
      text: data.text ?? "",
      confidence: data.confidence ?? 0,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await worker.terminate();
  }
}
