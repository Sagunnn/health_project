"use client";

import { ChevronRight } from "lucide-react";
import { DEMO_PRESETS } from "@/lib/demo-presets";
import { STATUS_STYLES } from "@/lib/status-styles";
import type { DemoPreset } from "@/types";

interface DemoPresetsProps {
  onSelect: (preset: DemoPreset) => void;
  disabled?: boolean;
}

/**
 * Five one-click stakeholder demo cards — DESIGN.md §4.
 *
 * The coloured dot previews the tier each preset is designed to produce, but
 * the status shown in the result always comes from the rules engine.
 */
export default function DemoPresets({ onSelect, disabled }: DemoPresetsProps) {
  return (
    <section aria-labelledby="demo-presets-heading">
      <h2
        id="demo-presets-heading"
        className="mb-1 text-sm font-semibold text-slate-700"
      >
        Demo presets
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        One tap per status tier — no packaging or API key required.
      </p>

      <ul className="space-y-2">
        {DEMO_PRESETS.map((preset) => {
          const style = STATUS_STYLES[preset.expectedStatus];
          return (
            <li key={preset.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(preset)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {preset.label}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {preset.caption}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-slate-400"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
