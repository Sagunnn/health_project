"use client";

import { useState } from "react";
import { BookOpen, Check, Keyboard, X } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { STATUS_STYLES } from "@/lib/status-styles";
import type { ScanResponse } from "@/types";

const SOURCE_LABELS: Record<ScanResponse["extractionSource"], string> = {
  "vision-llm": "Read by label OCR",
  "manual-entry": "Entered manually",
  "mock-preset": "Demo preset",
};

interface ResultCardProps {
  result: ScanResponse;
  onSave: (note: string) => void;
  onDismiss: () => void;
  isSaved: boolean;
  /** Offered when extraction produced no ingredients to assess. */
  onManualEntry: () => void;
}

/**
 * 5-tier result display — DESIGN.md §3 and §4.
 *
 * Rendered inside the modal overlay owned by the scanner screen. The status
 * badge spans the full card width and the explanation uses large type, so the
 * verdict is unmistakable at a glance.
 */
export default function ResultCard({
  result,
  onSave,
  onDismiss,
  isSaved,
  onManualEntry,
}: ResultCardProps) {
  const [note, setNote] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const { evaluation, extracted, extractionSource, warning } = result;
  const style = STATUS_STYLES[evaluation.status];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan result"
      className={`flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-2xl ${style.card}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 bg-white/70 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900">
            {extracted.productName || "Unnamed product"}
          </p>
          <p className="text-xs text-slate-500">
            {SOURCE_LABELS[extractionSource]}{" "}
            · WADA list {evaluation.rulesVersion}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close result"
          className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <StatusBadge status={evaluation.status} />

        <h3 className="mt-4 text-lg font-semibold leading-snug text-slate-900">
          {evaluation.headline}
        </h3>
        <p className="mt-2 text-base leading-relaxed text-slate-700">
          {evaluation.summary}
        </p>

        {warning && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-900">{warning}</p>
            {extracted.ingredients.length === 0 && (
              <button
                type="button"
                onClick={onManualEntry}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
              >
                <Keyboard className="h-3.5 w-3.5" aria-hidden />
                Enter ingredients manually
              </button>
            )}
          </div>
        )}

        {/* In-competition context */}
        {evaluation.competition.nextCompetitionDate && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
              evaluation.competition.inCompetitionWindow
                ? "bg-red-100 text-red-800"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {evaluation.competition.inCompetitionWindow
              ? `In-competition window: your event is within ${evaluation.competition.windowHours} hours.`
              : `Out-of-competition: your event is in about ${Math.max(0, Math.round((evaluation.competition.hoursUntilCompetition ?? 0) / 24))} day(s).`}
          </p>
        )}

        {/* What to do */}
        <h4 className="mt-5 text-sm font-semibold text-slate-900">
          What to do
        </h4>
        <ul className="mt-2 space-y-1.5">
          {evaluation.recommendedActions.map((action) => (
            <li key={action} className="flex gap-2 text-sm text-slate-700">
              <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
              {action}
            </li>
          ))}
        </ul>

        {/* Per-ingredient detail */}
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="mt-5 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          {showDetail ? "Hide" : "Show"} ingredient breakdown (
          {evaluation.findings.length})
        </button>

        {showDetail && (
          <ul className="mt-3 space-y-3">
            {evaluation.findings.map((finding, index) => (
              <li
                key={`${finding.ingredient}-${index}`}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                    {finding.ingredient}
                  </p>
                  <StatusBadge status={finding.status} size="compact" />
                </div>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {finding.classLabel}
                </p>
                <ul className="mt-2 space-y-1">
                  {finding.reasons.map((reason) => (
                    <li key={reason} className="text-xs leading-relaxed text-slate-600">
                      {reason}
                    </li>
                  ))}
                </ul>
                {finding.reference && (
                  <p className="mt-2 text-[11px] italic text-slate-400">
                    {finding.reference}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Save to Passport */}
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        {isSaved ? (
          <p className="flex items-center justify-center gap-2 py-2 text-sm font-semibold text-emerald-700">
            <Check className="h-4 w-4" aria-hidden />
            Saved to your Passport
          </p>
        ) : (
          <>
            <label htmlFor="scan-note" className="sr-only">
              Add a note
            </label>
            <input
              id="scan-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (e.g. prescribed by team doctor)"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => onSave(note.trim())}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98]"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              Save to Passport
            </button>
          </>
        )}
      </div>
    </div>
  );
}
