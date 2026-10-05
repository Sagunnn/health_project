"use client";

import { BookOpen, ScanLine, User, type LucideIcon } from "lucide-react";

export type TabId = "scanner" | "passport" | "profile";

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "scanner", label: "Scanner", icon: ScanLine },
  { id: "passport", label: "Passport", icon: BookOpen },
  { id: "profile", label: "Profile", icon: User },
];

interface BottomNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  /** Shown as a count badge on the Passport tab. */
  passportCount: number;
}

/**
 * Fixed bottom tab bar — DESIGN.md §2.
 *
 * `left-1/2 -translate-x-1/2` is added to the specified classes because a
 * `fixed` element with `max-w-md` would otherwise pin to the viewport's left
 * edge instead of staying aligned with the centred shell on desktop.
 */
export default function BottomNav({
  active,
  onChange,
  passportCount,
}: BottomNavProps) {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t border-white/10 bg-[#070c17]/85 px-2 py-3 backdrop-blur-xl"
    >
      {/* Luminous hairline, brightest at the centre. */}
      <span aria-hidden className="edge-top absolute inset-x-0 top-0 h-px" />
      <div className="flex justify-around">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute -top-px h-px w-10 bg-cyan-300 shadow-[0_0_10px_2px_rgba(103,232,249,0.9)]"
                />
              )}
              <Icon
                className={`h-6 w-6 transition-transform ${isActive ? "scale-110 drop-shadow-[0_0_8px_rgba(103,232,249,0.65)]" : ""}`}
                aria-hidden
              />
              {label}
              {id === "passport" && passportCount > 0 && (
                <span className="absolute right-1/2 top-0 translate-x-5 rounded-full bg-cyan-400 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                  {passportCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
