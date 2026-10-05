"use client";

import { BookOpen, Trash2 } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { STATUS_STYLES } from "@/lib/status-styles";
import { STATUS_TIERS, type PassportEntry, type SafetyStatus } from "@/types";

interface PassportTimelineProps {
  entries: PassportEntry[];
  onDelete: (id: string) => void;
  counts: Record<SafetyStatus, number>;
}

const SUMMARY_ORDER: SafetyStatus[] = [
  "NOT_PROHIBITED",
  "CONDITIONAL",
  "PROHIBITED",
  "SUPPLEMENT_RISK",
  "UNVERIFIED",
];

/**
 * Formats an ISO timestamp for display.
 *
 * Called only from client-rendered output (the passport loads from
 * localStorage after mount), so locale-dependent formatting cannot cause a
 * hydration mismatch.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Longitudinal scan history as a vertical timeline — DESIGN.md §4. */
export default function PassportTimeline({
  entries,
  onDelete,
  counts,
}: PassportTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-12 text-center">
        <BookOpen className="mx-auto h-10 w-10 text-slate-600" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-slate-300">
          Your Passport is empty
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Scan a product or run a demo preset, then save the result here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Status tally */}
      <ul className="mb-6 grid grid-cols-5 gap-1.5">
        {SUMMARY_ORDER.map((status) => {
          const style = STATUS_STYLES[status];
          return (
            <li
              key={status}
              className={`rounded-lg border px-1 py-2 text-center ${style.badge}`}
              title={STATUS_TIERS[status].label}
            >
              <span className="block text-lg font-bold leading-none">
                {counts[status]}
              </span>
              <span className="mt-1 block text-[10px] font-medium leading-tight">
                {STATUS_TIERS[status].emoji}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Timeline */}
      <ol className="relative ml-4 border-l border-white/10 pl-4">
        {entries.map((entry) => {
          const style = STATUS_STYLES[entry.status];
          return (
            <li key={entry.id} className="relative mb-5 last:mb-0">
              {/* Node dot sits on the timeline rail */}
              <span
                aria-hidden
                className={`absolute -left-[1.4rem] top-1.5 h-3 w-3 rounded-full ring-2 ring-[#0a1020] ${style.dot}`}
              />

              <div className="panel p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {entry.productName || "Unnamed product"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatTimestamp(entry.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    aria-label={`Delete ${entry.productName} from your Passport`}
                    className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <div className="mt-2">
                  <StatusBadge status={entry.status} size="compact" />
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {entry.headline}
                </p>

                {entry.ingredients.length > 0 && (
                  <p className="mt-2 truncate text-[11px] text-slate-600">
                    {entry.ingredients.join(" · ")}
                  </p>
                )}

                {entry.athleteContext.inCompetitionWindow && (
                  <p className="mt-2 inline-block rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-200 ring-1 ring-red-400/40">
                    Scanned inside the in-competition window
                  </p>
                )}

                {entry.note && (
                  <p className="mt-2 border-l border-white/15 pl-2 text-xs italic text-slate-500">
                    {entry.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
