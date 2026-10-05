/**
 * UI-layer visual tokens for the 5 status tiers.
 *
 * Retuned for the dark cockpit shell. DESIGN.md §3 specified light surfaces
 * (bg-emerald-100 and friends); on a near-black background those wash out and
 * the 100-weight fills glare, so each tier now uses a translucent fill, a
 * luminous border and a matching bloom. The HUES are unchanged, because they
 * are the product's semantics — green/amber/red/orange/grey mean the same
 * thing they always did.
 *
 * Class strings stay literal (never composed at runtime) so Tailwind's JIT
 * scanner can see every class it must compile — `lib/` is in the content globs.
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
  /** Full-width badge surface. */
  badge: string;
  /** Card surface behind the badge. */
  card: string;
  /** Timeline node dot. */
  dot: string;
  /** Icon + accent text colour. */
  accent: string;
  /** Coloured bloom behind the badge, so the verdict reads at a glance. */
  glow: string;
  icon: LucideIcon;
  emoji: string;
}

export const STATUS_STYLES: Record<SafetyStatus, StatusStyle> = {
  NOT_PROHIBITED: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-400/60",
    card: "bg-emerald-500/10 border-emerald-400/50",
    dot: "bg-emerald-400",
    accent: "text-emerald-300",
    glow: "shadow-[0_0_28px_-6px_rgba(52,211,153,0.55)]",
    icon: CheckCircle,
    emoji: "🟢",
  },
  CONDITIONAL: {
    badge: "bg-amber-500/15 text-amber-200 border-amber-400/60",
    card: "bg-amber-500/10 border-amber-400/50",
    dot: "bg-amber-400",
    accent: "text-amber-200",
    glow: "shadow-[0_0_28px_-6px_rgba(251,191,36,0.55)]",
    icon: AlertCircle,
    emoji: "🟡",
  },
  PROHIBITED: {
    badge: "bg-red-500/20 text-red-200 border-red-400/70",
    card: "bg-red-500/10 border-red-400/60",
    dot: "bg-red-400",
    accent: "text-red-200",
    glow: "shadow-[0_0_34px_-4px_rgba(248,113,113,0.7)]",
    icon: XOctagon,
    emoji: "🔴",
  },
  SUPPLEMENT_RISK: {
    badge: "bg-orange-500/15 text-orange-200 border-orange-400/60",
    card: "bg-orange-500/10 border-orange-400/50",
    dot: "bg-orange-400",
    accent: "text-orange-200",
    glow: "shadow-[0_0_28px_-6px_rgba(251,146,60,0.55)]",
    icon: AlertTriangle,
    emoji: "🟠",
  },
  UNVERIFIED: {
    badge: "bg-slate-400/15 text-slate-200 border-slate-400/50",
    card: "bg-slate-400/10 border-slate-400/40",
    dot: "bg-slate-300",
    accent: "text-slate-200",
    glow: "shadow-[0_0_24px_-8px_rgba(148,163,184,0.5)]",
    icon: HelpCircle,
    emoji: "⚪",
  },
};
