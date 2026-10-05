"use client";

import { useState } from "react";
import { Keyboard, Search, Sparkles } from "lucide-react";
import type { IngredientSource } from "@/lib/label-text";
import type { SubstanceHit } from "@/lib/substance-match";
import type { AdministrationRoute, ExtractedLabel } from "@/types";

interface ManualEntryProps {
  onSubmit: (
    extracted: ExtractedLabel,
    route: AdministrationRoute,
    isSupplement: boolean,
  ) => void;
  disabled?: boolean;
  /** Opens the form expanded, e.g. after a failed OCR attempt. */
  defaultOpen?: boolean;
  /** Pre-filled proposal from on-device OCR, awaiting confirmation. */
  initialProductName?: string;
  initialIngredients?: string[];
  /** Raw OCR text, disclosed so the athlete can see what was read. */
  ocrText?: string;
  ocrConfidence?: number;
  /** How the ingredient list was derived, so a guess can be flagged. */
  derivedFrom?: IngredientSource;
  /** Restricted substances matched directly against the WADA reference data. */
  knownSubstances?: SubstanceHit[];
  /** Escalate this image to the Vision model instead. */
  onUseAi?: () => void;
}

const ROUTES: Array<{ value: AdministrationRoute; label: string }> = [
  { value: "ORAL", label: "Oral (tablet, capsule, liquid)" },
  { value: "INHALED", label: "Inhaled (inhaler, nebuliser)" },
  { value: "INTRANASAL", label: "Nasal spray" },
  { value: "TOPICAL", label: "Topical (cream, gel, patch)" },
  { value: "OPHTHALMIC", label: "Eye drops" },
  { value: "INJECTION", label: "Injection" },
  { value: "RECTAL", label: "Rectal" },
  { value: "UNKNOWN", label: "Not sure" },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/40";

/**
 * Type a product's ingredients instead of photographing it.
 *
 * This is the path that keeps BESAFE usable when label OCR is unavailable —
 * no API key, no signal, or a label that will not photograph legibly. Route
 * matters because several WADA entries (glucocorticoids, beta-2 agonists)
 * resolve differently by route.
 */
export default function ManualEntry({
  onSubmit,
  disabled,
  defaultOpen = false,
  initialProductName = "",
  initialIngredients,
  ocrText,
  ocrConfidence,
  derivedFrom,
  knownSubstances,
  onUseAi,
}: ManualEntryProps) {
  const isReview = Boolean(ocrText);
  const [open, setOpen] = useState(defaultOpen || isReview);
  const [productName, setProductName] = useState(initialProductName);
  const [ingredientText, setIngredientText] = useState(
    (initialIngredients ?? []).join("\n"),
  );
  const [showRaw, setShowRaw] = useState(false);
  const [route, setRoute] = useState<AdministrationRoute>("ORAL");
  const [isSupplement, setIsSupplement] = useState(false);

  /** Accepts commas or newlines, so a label can be typed either way. */
  function parseIngredients(value: string): string[] {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const ingredients = parseIngredients(ingredientText);
  const canSubmit = ingredients.length > 0 && !disabled;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(
      {
        productName: productName.trim() || ingredients[0],
        ingredients,
      },
      route,
      isSupplement,
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-1.5 text-xs font-medium text-cyan-300 hover:text-cyan-200"
      >
        <Keyboard className="h-3.5 w-3.5" aria-hidden />
        Type ingredients instead
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">
          {isReview ? "Check what we read" : "Enter ingredients"}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      </div>

      {isReview && (
        <div className="mb-3 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.07] px-3 py-2">
          <p className="text-xs text-cyan-100">
            Read on your device — no internet needed, and it uses none of your
            scan allowance.{" "}
            <span className="font-semibold">
              Check every ingredient against the packaging before continuing.
            </span>{" "}
            Phone cameras miss small print, and a missed ingredient is the one
            that matters.
          </p>
          {knownSubstances && knownSubstances.length > 0 && (
            <p className="mt-2 rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-1.5 text-[11px] text-cyan-100">
              <span className="font-semibold">
                Matched against the WADA list on your device:
              </span>{" "}
              {knownSubstances
                .map((h) => `${h.substance} (${h.wadaClass})`)
                .join(", ")}
              . No AI scan was needed.
            </p>
          )}
          {(!knownSubstances || knownSubstances.length === 0) &&
            (derivedFrom === "product-name" ||
              derivedFrom === "parentheses") && (
              <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                <span className="font-semibold">
                  No ingredients panel was found on this pack.
                </span>{" "}
                {derivedFrom === "product-name"
                  ? "The line below is the product title, which on generic packs is also the substance name."
                  : "The line below came from the brackets after the brand name."}{" "}
                Add anything else printed on the box before continuing.
              </p>
            )}
          {derivedFrom === "none" && (
            <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
              <span className="font-semibold">
                No ingredients could be made out.
              </span>{" "}
              Type them from the packaging below, or use the AI scan.
            </p>
          )}
          {typeof ocrConfidence === "number" && (
            <p className="mt-1 text-[11px] text-cyan-300/80">
              Reading confidence {Math.round(ocrConfidence)}%
              {ocrConfidence < 70 ? " — low, please read carefully." : ""}
            </p>
          )}
        </div>
      )}

      <label
        htmlFor="manual-product"
        className="mb-1.5 block text-xs font-medium text-slate-300"
      >
        Product name (optional)
      </label>
      <input
        id="manual-product"
        type="text"
        value={productName}
        onChange={(e) => setProductName(e.target.value)}
        placeholder="e.g. Tramadol 50mg Capsules"
        className={`${inputClass} mb-3`}
      />

      <label
        htmlFor="manual-ingredients"
        className="mb-1.5 block text-xs font-medium text-slate-300"
      >
        Active ingredients
      </label>
      <textarea
        id="manual-ingredients"
        value={ingredientText}
        onChange={(e) => setIngredientText(e.target.value)}
        rows={3}
        placeholder={
          "One per line, or separated by commas\ne.g. Tramadol Hydrochloride 50 mg"
        }
        className={`${inputClass} mb-1 resize-y`}
      />
      <p className="mb-3 text-xs text-slate-400">
        {ingredients.length === 0
          ? "Copy the active ingredients from the packaging."
          : `${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"} detected.`}
      </p>

      <label
        htmlFor="manual-route"
        className="mb-1.5 block text-xs font-medium text-slate-300"
      >
        How is it taken?
      </label>
      <select
        id="manual-route"
        value={route}
        onChange={(e) => setRoute(e.target.value as AdministrationRoute)}
        className={`${inputClass} mb-1`}
      >
        {ROUTES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mb-3 text-xs text-slate-400">
        Route changes the result for some substances — an inhaled steroid is
        treated differently from an injected one.
      </p>

      <label className="mb-4 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={isSupplement}
          onChange={(e) => setIsSupplement(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/10 text-cyan-400 focus:ring-2 focus:ring-cyan-400/40"
        />
        <span className="text-xs text-slate-300">
          This is a dietary supplement, not a licensed medicine
        </span>
      </label>

      {isReview && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
          >
            {showRaw ? "Hide" : "Show"} everything we read from the label
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[11px] leading-snug text-slate-400">
              {ocrText}
            </pre>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-sky-400 to-blue-600 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.8)] transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Search className="h-4 w-4" aria-hidden />
        Check against WADA list
      </button>

      {onUseAi && (
        <button
          type="button"
          onClick={onUseAi}
          disabled={disabled}
          className="mt-2 flex w-full items-center justify-center gap-2 panel panel-hover px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Couldn&apos;t read it? Use AI scan
        </button>
      )}
    </form>
  );
}
