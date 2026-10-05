"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Upload } from "lucide-react";
import { downscaleImage } from "@/lib/image";

interface ScannerModalProps {
  /** Receives a data: URL for the chosen image. */
  onCapture: (dataUrl: string) => void;
  isScanning: boolean;
}

/**
 * Sanity ceiling on the file we will even attempt to decode. Anything within
 * it gets downscaled before upload, so this is about avoiding a huge decode,
 * not about the request size.
 */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/**
 * Camera / file-upload trigger — DESIGN.md §4.
 *
 * `capture="environment"` opens the rear camera on mobile and degrades to a
 * normal file picker on desktop, so one control covers both without a
 * separate camera permission flow.
 */
export default function ScannerModal({
  onCapture,
  isScanning,
}: ScannerModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so selecting the same file twice still fires a change event.
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
      <button
        type="button"
        disabled={busy}
        onClick={() => cameraInputRef.current?.click()}
        aria-label="Scan a product label with your camera"
        className="flex h-32 w-32 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all active:scale-95 disabled:opacity-70"
      >
        {busy ? (
          <Loader2 className="h-12 w-12 animate-spin" aria-hidden />
        ) : (
          <Camera className="h-12 w-12" aria-hidden />
        )}
      </button>

      <p className="mt-3 text-sm font-medium text-slate-700">
        {isPreparing
          ? "Preparing photo…"
          : isScanning
            ? "Reading label…"
            : "Scan a label"}
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden />
        Upload a photo instead
      </button>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void handleFile(e)}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleFile(e)}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
