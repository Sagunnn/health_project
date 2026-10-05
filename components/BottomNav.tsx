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
      className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 justify-around border-t border-slate-200 bg-white px-2 py-3"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-1 rounded-lg py-1 text-xs font-medium transition-colors ${
              isActive
                ? "text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-6 w-6" aria-hidden />
            {label}
            {id === "passport" && passportCount > 0 && (
              <span className="absolute right-1/2 top-0 translate-x-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {passportCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
