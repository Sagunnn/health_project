"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ShieldCheck } from "lucide-react";

import AthleteProfileForm from "@/components/AthleteProfile";
import BottomNav, { type TabId } from "@/components/BottomNav";
import DemoPresets from "@/components/DemoPresets";
import ManualEntry from "@/components/ManualEntry";
import PassportTimeline from "@/components/PassportTimeline";
import ResultCard from "@/components/ResultCard";
import ScannerModal from "@/components/ScannerModal";
import {
  DEFAULT_PROFILE,
  countByStatus,
  createEntryId,
  deletePassportEntry,
  loadPassport,
  loadProfile,
  savePassportEntry,
  saveProfile,
} from "@/lib/storage";
import type {
  AdministrationRoute,
  AthleteProfile,
  DemoPreset,
  ExtractedLabel,
  PassportEntry,
  ScanResponse,
} from "@/types";

export default function Home() {
  const [tab, setTab] = useState<TabId>("scanner");

  // Both start at the server-rendered defaults and are replaced after mount,
  // so the first client render matches the server exactly — no hydration
  // mismatch from reading localStorage.
  const [profile, setProfile] = useState<AthleteProfile>(DEFAULT_PROFILE);
  const [passport, setPassport] = useState<PassportEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  const [result, setResult] = useState<ScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
    setPassport(loadPassport());
    setMounted(true);
  }, []);

  const counts = useMemo(() => countByStatus(passport), [passport]);

  const runScan = useCallback(
    async (body: Record<string, unknown>) => {
      setIsScanning(true);
      setError(null);
      setIsSaved(false);
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, profile }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? "The scan could not be completed.");
        }
        setResult((await response.json()) as ScanResponse);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The scan could not be completed.",
        );
      } finally {
        setIsScanning(false);
      }
    },
    [profile],
  );

  const handlePreset = useCallback(
    (preset: DemoPreset) => {
      // Only the id travels: the server resolves the extraction and its
      // context from lib/demo-presets, so there is one source of truth.
      void runScan({ presetId: preset.id });
    },
    [runScan],
  );

  const handleManualEntry = useCallback(
    (
      extracted: ExtractedLabel,
      route: AdministrationRoute,
      isDietarySupplement: boolean,
    ) => {
      void runScan({
        extracted,
        source: "manual-entry",
        context: { route, isDietarySupplement },
      });
    },
    [runScan],
  );

  const handleCapture = useCallback(
    (dataUrl: string) => {
      void runScan({ imageBase64: dataUrl });
    },
    [runScan],
  );

  const handleSave = useCallback(
    (note: string) => {
      if (!result) return;
      const entry: PassportEntry = {
        id: createEntryId(),
        createdAt: new Date().toISOString(),
        productName: result.extracted.productName,
        ingredients: result.extracted.ingredients,
        status: result.evaluation.status,
        headline: result.evaluation.headline,
        extractionSource: result.extractionSource,
        evaluation: result.evaluation,
        athleteContext: {
          sport: profile.sport,
          discipline: profile.discipline,
          nextCompetitionDate: profile.nextCompetitionDate,
          inCompetitionWindow: result.evaluation.competition.inCompetitionWindow,
        },
        ...(note ? { note } : {}),
      };
      setPassport(savePassportEntry(entry));
      setIsSaved(true);
    },
    [profile, result],
  );

  const handleDelete = useCallback((id: string) => {
    setPassport(deletePassportEntry(id));
  }, []);

  const handleProfileSave = useCallback((next: AthleteProfile) => {
    setProfile(saveProfile(next));
  }, []);

  return (
    <>
      <main className="px-4 pt-6">
        {/* Header — DESIGN.md §4 */}
        <header className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-blue-600 p-2 text-white">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight text-slate-900">
              BESAFE by AIMS
            </h1>
            <p className="text-sm text-slate-500">Know before you take it.</p>
          </div>
        </header>

        {tab === "scanner" && (
          <div className="space-y-8">
            <div className="pt-2">
              <ScannerModal
                onCapture={handleCapture}
                isScanning={isScanning}
              />
            </div>

            <ManualEntry
              key={manualOpen ? "open" : "closed"}
              onSubmit={handleManualEntry}
              disabled={isScanning}
              defaultOpen={manualOpen}
            />

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            {/* Competition-context reminder */}
            {mounted && !profile.nextCompetitionDate && (
              <button
                type="button"
                onClick={() => setTab("profile")}
                className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-900 transition-colors hover:border-amber-400"
              >
                <span className="font-semibold">
                  No competition date set.
                </span>{" "}
                Results are assessed out-of-competition. Tap to add your event
                date.
              </button>
            )}

            <DemoPresets onSelect={handlePreset} disabled={isScanning} />
          </div>
        )}

        {tab === "passport" && (
          <section aria-labelledby="passport-heading">
            <h2
              id="passport-heading"
              className="mb-1 text-sm font-semibold text-slate-700"
            >
              Athlete Passport
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              {passport.length} saved {passport.length === 1 ? "scan" : "scans"}{" "}
              · stored on this device only
            </p>
            <PassportTimeline
              entries={passport}
              onDelete={handleDelete}
              counts={counts}
            />
          </section>
        )}

        {tab === "profile" && (
          <section aria-labelledby="profile-heading">
            <h2
              id="profile-heading"
              className="mb-1 text-sm font-semibold text-slate-700"
            >
              Athlete profile
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Your sport and competition date change how substances are
              assessed.
            </p>
            <AthleteProfileForm
              profile={profile}
              onSave={handleProfileSave}
            />
          </section>
        )}
      </main>

      {/* Result modal overlay */}
      {result && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center">
          <div className="w-full max-w-md animate-fade-up">
            <ResultCard
              result={result}
              onSave={handleSave}
              onDismiss={() => setResult(null)}
              isSaved={isSaved}
              onManualEntry={() => {
                setResult(null);
                setTab("scanner");
                setManualOpen(true);
              }}
            />
          </div>
        </div>
      )}

      <BottomNav
        active={tab}
        onChange={setTab}
        passportCount={passport.length}
      />
    </>
  );
}
