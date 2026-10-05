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
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-semibold ${style.badge}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {tier.label}
      </span>
    );
  }

  return (
    <div
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 backdrop-blur-sm ${style.badge} ${style.glow}`}
    >
      <Icon className="h-9 w-9 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xl font-bold uppercase leading-tight tracking-[0.06em]">
          {tier.label}
        </p>
        <p className="label-caps mt-0.5 opacity-70">
          WADA {tier.status.replace(/_/g, " ").toLowerCase()}
        </p>
      </div>
    </div>
  );
}
