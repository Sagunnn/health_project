"use client";

import { useRef, useState } from "react";
import { Camera, ImageIcon, Loader2 } from "lucide-react";
import { downscaleImage } from "@/lib/image";

interface ScannerModalProps {
  /** Receives a downscaled data: URL for the chosen image. */
  onCapture: (dataUrl: string) => void;
  isScanning: boolean;
}

/**
 * Sanity ceiling on the file we will even attempt to decode. Anything within
 * it gets downscaled before upload, so this bounds the decode cost, not the
 * request size.
 */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/**
 * Label capture — DESIGN.md §4.
 *
 * Two inputs, one handler. `capture="environment"` makes iOS and Android open
 * the rear camera directly; the second input omits it so the OS offers the
 * photo library instead. A single input cannot do both, because `capture` is
 * a request for a specific source rather than a hint. On desktop, where there
 * is no camera intent, both fall back to an ordinary file picker.
 */
export default function ScannerModal({
  onCapture,
  isScanning,
}: ScannerModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  async function handleImageUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_INPUT_BYTES) {
      window.alert(
        "That image is too large to process. Please choose a smaller one.",
      );
      return;
    }

    setIsPreparing(true);
    try {
      // Resize before upload: an un-resized phone photo exceeds the 4.5 MB
      // serverless body limit once base64-encoded, which fails in production
      // but not against the dev server.
      const { dataUrl } = await downscaleImage(file);
      onCapture(dataUrl);
    } catch {
      window.alert(
        "That image could not be read. Try another photo, or enter the ingredients manually.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  const busy = isScanning || isPreparing;

  return (
    <div className="flex flex-col items-center">
      {/* Primary: Take Photo */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        {isScanning && (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-60"
          />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraInputRef.current?.click()}
          aria-label="Take a photo of a product label"
          className="relative flex h-32 w-32 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all active:scale-95 disabled:opacity-70"
        >
          {busy ? (
            <Loader2 className="h-12 w-12 animate-spin" aria-hidden />
          ) : (
            <Camera className="h-12 w-12" aria-hidden />
          )}
        </button>
      </div>

      <p
        className="mt-3 text-sm font-semibold text-slate-800"
        aria-live="polite"
      >
        {isPreparing
          ? "Preparing photo…"
          : isScanning
            ? "AI scanning label…"
            : "Take Photo"}
      </p>
      <p className="mt-0.5 h-4 text-xs text-slate-500">
        {isScanning
          ? "Reading the ingredients, this can take a few seconds."
          : isPreparing
            ? ""
            : "Point at the ingredients panel"}
      </p>

      {/* Secondary: Upload from Gallery */}
      <button
        type="button"
        disabled={busy}
        onClick={() => galleryInputRef.current?.click()}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ImageIcon className="h-4 w-4" aria-hidden />
        Upload from Gallery
      </button>

      {/* Camera: `capture` asks the OS for the rear camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void handleImageUpload(e)}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
      {/* Gallery: no `capture`, so the OS offers the photo library. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleImageUpload(e)}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
