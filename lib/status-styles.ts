/**
 * UI-layer visual tokens for the 5 status tiers.
 *
 * These are the STRICT class strings mandated by DESIGN.md §3. They live here
 * as literal strings (not composed at runtime) so Tailwind's JIT scanner can
 * see every class it needs to compile — `lib/` is in the `content` globs.
 *
 * This module is deliberately separate from `types/index.ts`: the type layer
 * owns the tier semantics (label, severity), this one owns how a tier looks.
 */

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  XOctagon,
  type LucideIcon,
} from "lucide-react";
import type { SafetyStatus } from "@/types";

export interface StatusStyle {
  /** Full-width badge surface, per DESIGN.md. */
  badge: string;
  /** Card surface behind the badge. */
  card: string;
  /** Timeline node dot. */
  dot: string;
  /** Icon + accent text colour. */
  accent: string;
  icon: LucideIcon;
  emoji: string;
}

export const STATUS_STYLES: Record<SafetyStatus, StatusStyle> = {
  NOT_PROHIBITED: {
    badge: "bg-emerald-100 text-emerald-800 border-emerald-500",
    card: "bg-emerald-50 border-emerald-500",
    dot: "bg-emerald-500",
    accent: "text-emerald-700",
    icon: CheckCircle,
    emoji: "🟢",
  },
  CONDITIONAL: {
    badge: "bg-amber-100 text-amber-900 border-amber-500",
    card: "bg-amber-50 border-amber-500",
    dot: "bg-amber-500",
    accent: "text-amber-800",
    icon: AlertCircle,
    emoji: "🟡",
  },
  PROHIBITED: {
    // DESIGN.md lists both bg-red-100 and bg-red-50 for this tier; the badge
    // takes the stronger 100 and the card surface takes 50.
    badge: "bg-red-100 text-red-800 border-red-600",
    card: "bg-red-50 border-red-600",
    dot: "bg-red-600",
    accent: "text-red-700",
    icon: XOctagon,
    emoji: "🔴",
  },
  SUPPLEMENT_RISK: {
    badge: "bg-orange-100 text-orange-900 border-orange-500",
    card: "bg-orange-50 border-orange-500",
    dot: "bg-orange-500",
    accent: "text-orange-800",
    icon: AlertTriangle,
    emoji: "🟠",
  },
  UNVERIFIED: {
    badge: "bg-slate-200 text-slate-800 border-slate-400",
    card: "bg-slate-100 border-slate-400",
    dot: "bg-slate-400",
    accent: "text-slate-700",
    icon: HelpCircle,
    emoji: "⚪",
  },
};
