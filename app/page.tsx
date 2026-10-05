"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";

import AthleteProfileForm from "@/components/AthleteProfile";
import BottomNav, { type TabId } from "@/components/BottomNav";
import DemoPresets from "@/components/DemoPresets";
import ManualEntry from "@/components/ManualEntry";
import { assessRead } from "@/lib/label-text";
import { readLabelLocally, type LocalOcrResult } from "@/lib/local-ocr";
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
  // One scan at a time: a second request supersedes the first rather than
  // racing it, so a double tap cannot spend two model calls or land a stale
  // result over a newer one.
  const inFlight = useRef<AbortController | null>(null);
  // On-device OCR result awaiting the athlete's confirmation, plus the image
  // it came from so they can escalate the same photo to the AI scan.
  const [review, setReview] = useState<
    (LocalOcrResult & { dataUrl: string }) | null
  >(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  /** Why we are reaching for the model, shown while that happens. */
  const [escalating, setEscalating] = useState<string | null>(null);
  /** Whether any vision provider is configured, so we never escalate in vain. */
  const [aiAvailable, setAiAvailable] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
    setPassport(loadPassport());
    setMounted(true);
    // Cheap, no model call: tells us whether escalation is even possible.
    fetch("/api/scan")
      .then((r) => r.json())
      .then((health: { ok?: boolean }) => setAiAvailable(Boolean(health.ok)))
      .catch(() => setAiAvailable(false));
  }, []);

  const counts = useMemo(() => countByStatus(passport), [passport]);

  const runScan = useCallback(
    async (body: Record<string, unknown>) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setIsScanning(true);
      setError(null);
      setIsSaved(false);
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, profile }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? "The scan could not be completed.");
        }
        const payload = (await response.json()) as ScanResponse;
        setResult(payload);
        return payload;
      } catch (cause) {
        // A superseded request is not a failure the athlete should see.
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The scan could not be completed.",
        );
        return null;
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setIsScanning(false);
        }
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
        // Confirmed OCR text has its own provenance; it was not hand-typed.
        source: review ? "local-ocr" : "manual-entry",
        context: { route, isDietarySupplement },
      });
    },
    [runScan, review],
  );

  /** Escalates an image to the Vision model. Costs quota, so it is explicit. */
  const scanWithAi = useCallback(
    (dataUrl: string) => {
      setReview(null);
      void runScan({ imageBase64: dataUrl });
    },
    [runScan],
  );

  /**
   * Read the label on-device first and show the result for confirmation.
   * The model is only involved if this cannot read the packaging.
   */
  const handleCapture = useCallback(
    async (dataUrl: string) => {
      setError(null);
      setResult(null);
      setOcrProgress(0);
      try {
        const ocr = await readLabelLocally(dataUrl, setOcrProgress);
        setOcrProgress(null);
        const quality = assessRead(
          ocr,
          ocr.confidence,
          ocr.knownSubstances.length,
        );

        // A weak read is exactly where an ingredient gets missed, and a
        // missed ingredient reads as a clean product. Spend a model call
        // there, and nowhere else — a clean ingredients panel is already
        // trustworthy, free and instant.
        if (!quality.strong && aiAvailable) {
          setEscalating(quality.reason);
          const payload = await runScan({ imageBase64: dataUrl });
          setEscalating(null);
          if (payload && payload.extracted.ingredients.length > 0) return;
          // The model could not help either — hand back the local read so
          // the athlete can still correct it by hand.
          setError(null);
          setResult(null);
        }

        setReview({ ...ocr, dataUrl });
        setManualOpen(false);
      } catch {
        // Tesseract could not start — fall straight through to the model.
        scanWithAi(dataUrl);
      } finally {
        setOcrProgress(null);
        setEscalating(null);
      }
    },
    [aiAvailable, runScan, scanWithAi],
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
          inCompetitionWindow:
            result.evaluation.competition.inCompetitionWindow,
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
          <span className="rounded-2xl bg-gradient-to-b from-sky-400 to-blue-600 p-2 text-slate-950 shadow-[0_0_22px_-4px_rgba(56,189,248,0.9)]">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight text-slate-100">
              BESAFE by AIMS
            </h1>
            <p className="text-sm text-dim">Know before you take it.</p>
          </div>
        </header>

        {tab === "scanner" && (
          <div className="space-y-8">
            <div className="pt-2">
              <ScannerModal
                onCapture={(dataUrl) => void handleCapture(dataUrl)}
                isScanning={isScanning}
              />
            </div>

            {escalating !== null && (
              <p className="flex items-start gap-2 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-2.5 text-sm text-cyan-100">
                <Loader2
                  className="mt-0.5 h-4 w-4 shrink-0 animate-spin"
                  aria-hidden
                />
                <span>
                  Your device read it, but {escalating}. Checking with the AI
                  scanner for a cleaner read…
                </span>
              </p>
            )}

            {ocrProgress !== null && escalating === null && (
              <p className="flex items-center justify-center gap-2 text-sm font-medium text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Reading the label on your device…{" "}
                {Math.round(ocrProgress * 100)}%
              </p>
            )}

            <ManualEntry
              key={
                review
                  ? `review-${review.durationMs}`
                  : manualOpen
                    ? "open"
                    : "closed"
              }
              onSubmit={handleManualEntry}
              disabled={isScanning}
              defaultOpen={manualOpen}
              initialProductName={review?.productName}
              initialIngredients={review?.ingredients}
              ocrText={review?.text}
              ocrConfidence={review?.confidence}
              derivedFrom={review?.derivedFrom}
              knownSubstances={review?.knownSubstances}
              onUseAi={review ? () => scanWithAi(review.dataUrl) : undefined}
            />

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            {/* Competition-context reminder */}
            {mounted && !profile.nextCompetitionDate && (
              <button
                type="button"
                onClick={() => setTab("profile")}
                className="w-full rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2.5 text-left text-xs text-amber-100 transition-colors hover:border-amber-300/60"
              >
                <span className="font-semibold">No competition date set.</span>{" "}
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
              className="label-caps mb-1 text-cyan-300/90"
            >
              Athlete Passport
            </h2>
            <p className="mb-4 text-xs text-dimmer">
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
              className="label-caps mb-1 text-cyan-300/90"
            >
              Athlete profile
            </h2>
            <p className="mb-4 text-xs text-dimmer">
              Your sport and competition date change how substances are
              assessed.
            </p>
            <AthleteProfileForm profile={profile} onSave={handleProfileSave} />
          </section>
        )}
      </main>

      {/* Result modal overlay */}
      {result && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#04070e]/80 p-3 backdrop-blur-sm sm:items-center">
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
