"use client";

import { useEffect, useState } from "react";
import { Check, Calendar } from "lucide-react";
import {
  NADO_OTHER,
  findNado,
  isKnownNado,
  nadosByRegion,
} from "@/lib/nados";
import type { AthleteProfile as AthleteProfileType } from "@/types";

interface AthleteProfileProps {
  profile: AthleteProfileType;
  onSave: (profile: AthleteProfileType) => void;
}

const LEVELS = [
  "International",
  "National",
  "Regional",
  "Club",
  "Recreational",
];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500";

const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

/** Athlete context form — DESIGN.md §3/§4. Drives the engine's timing rules. */
export default function AthleteProfile({
  profile,
  onSave,
}: AthleteProfileProps) {
  const [draft, setDraft] = useState(profile);
  const [justSaved, setJustSaved] = useState(false);
  // A stored NADO that is not in the list came from free text, so the form
  // reopens in "Other" mode rather than silently discarding it.
  const [nadoIsOther, setNadoIsOther] = useState(
    () => profile.nado !== "" && !isKnownNado(profile.nado),
  );

  // Keep the form in step when the parent finishes loading from localStorage.
  useEffect(() => {
    setDraft(profile);
    setNadoIsOther(profile.nado !== "" && !isKnownNado(profile.nado));
  }, [profile]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function update<K extends keyof AthleteProfileType>(
    key: K,
    value: AthleteProfileType[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSave(draft);
    setJustSaved(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="athlete-name" className={labelClass}>
          Name
        </label>
        <input
          id="athlete-name"
          type="text"
          value={draft.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Your name"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="athlete-sport" className={labelClass}>
          Sport
        </label>
        <input
          id="athlete-sport"
          type="text"
          value={draft.sport}
          onChange={(e) => update("sport", e.target.value)}
          placeholder="e.g. Athletics, Archery, Swimming"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Some substances are prohibited only in specific sports, so this
          changes your result.
        </p>
      </div>

      <div>
        <label htmlFor="athlete-discipline" className={labelClass}>
          Discipline
        </label>
        <input
          id="athlete-discipline"
          type="text"
          value={draft.discipline}
          onChange={(e) => update("discipline", e.target.value)}
          placeholder="e.g. 1500m, Recurve, Freestyle"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="athlete-level" className={labelClass}>
          Level
        </label>
        <select
          id="athlete-level"
          value={draft.level}
          onChange={(e) => update("level", e.target.value)}
          className={inputClass}
        >
          <option value="">Select a level</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="athlete-competition" className={labelClass}>
          Next competition date
        </label>
        <div className="relative">
          <input
            id="athlete-competition"
            type="date"
            value={draft.nextCompetitionDate ?? ""}
            onChange={(e) =>
              update("nextCompetitionDate", e.target.value || null)
            }
            className={inputClass}
          />
          <Calendar
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Within 48 hours of this date, in-competition rules apply and some
          results escalate to prohibited.
        </p>
      </div>

      <div>
        <label htmlFor="athlete-nado" className={labelClass}>
          National Anti-Doping Organisation
        </label>
        <select
          id="athlete-nado"
          value={nadoIsOther ? NADO_OTHER : draft.nado}
          onChange={(e) => {
            const value = e.target.value;
            if (value === NADO_OTHER) {
              setNadoIsOther(true);
              update("nado", "");
            } else {
              setNadoIsOther(false);
              update("nado", value);
            }
          }}
          className={inputClass}
        >
          <option value="">Select your NADO</option>
          {nadosByRegion().map(({ region, items }) => (
            <optgroup key={region} label={region}>
              {items.map((nado) => (
                <option key={nado.code} value={nado.code}>
                  {nado.code} — {nado.country}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={NADO_OTHER}>Other / not listed…</option>
        </select>

        {nadoIsOther && (
          <input
            type="text"
            value={draft.nado}
            onChange={(e) => update("nado", e.target.value)}
            placeholder="Name of your anti-doping organisation"
            aria-label="Name of your anti-doping organisation"
            className={`${inputClass} mt-2`}
          />
        )}

        <p className="mt-1 text-xs text-slate-500">
          {!nadoIsOther && findNado(draft.nado)
            ? findNado(draft.nado)?.name
            : "Used when a result tells you who to contact before using a product."}
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-slate-300 bg-white px-3 py-3">
        <input
          type="checkbox"
          checked={draft.hasApprovedTue}
          onChange={(e) => update("hasApprovedTue", e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
        />
        <span>
          <span className="block text-sm font-medium text-slate-700">
            I hold an approved TUE
          </span>
          <span className="block text-xs text-slate-500">
            Results are never downgraded on this basis — you remain strictly
            liable. It only adds a reminder to verify your exemption covers the
            exact substance, dose, and route.
          </span>
        </span>
      </label>

      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98]"
      >
        {justSaved ? (
          <>
            <Check className="h-4 w-4" aria-hidden />
            Profile saved
          </>
        ) : (
          "Save profile"
        )}
      </button>

      <p className="text-center text-xs text-slate-400">
        Stored only on this device. Nothing is uploaded.
      </p>
    </form>
  );
}
