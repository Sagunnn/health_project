"use client";

import { useRef } from "react";
import { Camera, Loader2, Upload } from "lucide-react";

interface ScannerModalProps {
  /** Receives a data: URL for the chosen image. */
  onCapture: (dataUrl: string) => void;
  isScanning: boolean;
}

const MAX_BYTES = 8 * 1024 * 1024;

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

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so selecting the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      window.alert("That image is larger than 8 MB. Please choose a smaller one.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onCapture(reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        disabled={isScanning}
        onClick={() => cameraInputRef.current?.click()}
        aria-label="Scan a product label with your camera"
        className="flex h-32 w-32 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all active:scale-95 disabled:opacity-70"
      >
        {isScanning ? (
          <Loader2 className="h-12 w-12 animate-spin" aria-hidden />
        ) : (
          <Camera className="h-12 w-12" aria-hidden />
        )}
      </button>

      <p className="mt-3 text-sm font-medium text-slate-700">
        {isScanning ? "Reading label…" : "Scan a label"}
      </p>

      <button
        type="button"
        disabled={isScanning}
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
        onChange={handleFile}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="sr-file"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
