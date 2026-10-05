import { STATUS_STYLES } from "@/lib/status-styles";
import { STATUS_TIERS, type SafetyStatus } from "@/types";

interface StatusBadgeProps {
  status: SafetyStatus;
  /** Full-width badge for the result card; compact for lists. */
  size?: "full" | "compact";
}

/** The 5-tier status badge — DESIGN.md §3. */
export default function StatusBadge({
  status,
  size = "full",
}: StatusBadgeProps) {
  const style = STATUS_STYLES[status];
  const tier = STATUS_TIERS[status];
  const Icon = style.icon;

  if (size === "compact") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${style.badge}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {tier.label}
      </span>
    );
  }

  return (
    <div
      className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 ${style.badge}`}
    >
      <Icon className="h-8 w-8 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-lg font-bold uppercase leading-tight tracking-wide">
          {tier.label}
        </p>
        <p className="text-xs font-medium opacity-80">
          {style.emoji} WADA {tier.status.replace(/_/g, " ").toLowerCase()}
        </p>
      </div>
    </div>
  );
}
