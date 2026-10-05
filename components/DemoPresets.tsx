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
        className="label-caps mb-1 text-cyan-300/90"
      >
        Demo presets
      </h2>
      <p className="mb-3 text-xs text-dimmer">
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
                className="panel panel-hover flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span
                    aria-hidden
                    className={`absolute inline-flex h-full w-full rounded-full opacity-60 blur-[3px] ${style.dot}`}
                  />
                  <span
                    aria-hidden
                    className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-100">
                    {preset.label}
                  </span>
                  <span className="block truncate text-xs text-dim">
                    {preset.caption}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-slate-600"
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
