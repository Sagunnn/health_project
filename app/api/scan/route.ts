/**
 * POST /api/scan — hybrid label extraction + rules orchestration.
 *
 * Three input modes, one output contract:
 *   { presetId }    -> deterministic demo extraction (no model call)
 *   { imageBase64 } -> Gemini vision OCR
 *   { extracted }   -> ingredients typed by the athlete
 *
 * ARCHITECTURAL LAW: the model is used ONLY to turn an image into
 * { productName, ingredients, isSupplement }. It is never asked for a status,
 * a WADA class, or a recommendation. Every verdict comes from the
 * deterministic rules engine.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPresetById } from "@/lib/demo-presets";
import {
  ExtractionFailure,
  extractLabel,
  hasAnyProvider,
  providerSnapshot,
} from "@/lib/vision";
import {
  cacheStats,
  getCached,
  imageKey,
  setCached,
  singleFlight,
} from "@/lib/extraction-cache";
import {
  checkRateLimit,
  clientKey,
  recordCacheHit,
  recordRejection,
  recordScan,
  usageSnapshot,
} from "@/lib/rate-limit";
import { evaluateLabel } from "@/lib/rules-engine";
import { DEFAULT_PROFILE } from "@/lib/storage";
import type {
  AthleteProfile,
  ExtractedLabel,
  ExtractionSource,
  ScanContext,
  ScanResponse,
} from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ------------------------------------------------------------------ *
 * Request contract
 * ------------------------------------------------------------------ */

/** Mirrors lib/vision's extraction contract for client-supplied payloads. */
const clientExtractedSchema = z.object({
  productName: z.string(),
  ingredients: z.array(z.string()),
});

const requestSchema = z.object({
  /** Scenario A — demo preset, resolved server-side with no model call. */
  presetId: z.string().optional(),
  /** Scenario B — data: URL or bare base64 image, for the AI fallback. */
  imageBase64: z.string().optional(),
  /** Scenario C — ingredients read on-device or typed by the athlete. */
  extracted: clientExtractedSchema.optional(),
  /** Provenance hint; the server still validates the shape. */
  source: z.enum(["mock-preset", "manual-entry", "local-ocr"]).optional(),
  profile: z.record(z.unknown()).optional(),
  context: z
    .object({
      route: z.string().optional(),
      dose: z.string().optional(),
      isDietarySupplement: z.boolean().optional(),
    })
    .optional(),
});

function coerceProfile(raw: unknown): AthleteProfile {
  return { ...DEFAULT_PROFILE, ...((raw ?? {}) as Partial<AthleteProfile>) };
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

/**
 * GET /api/scan — configuration health check.
 *
 * Exists because a missing key looks identical to a failed scan from the
 * outside, and the usual cause is a Vercel env var that was added but never
 * redeployed. Reports only booleans, names, and lengths — never the key.
 */
export async function GET() {
  const providers = providerSnapshot();
  const configured = hasAnyProvider();
  return NextResponse.json({
    ok: configured,
    keyConfigured: configured,
    providers,
    usage: usageSnapshot(),
    cache: cacheStats(),
    rulesVersion: evaluateLabel(
      { productName: "", ingredients: [] },
      DEFAULT_PROFILE,
      {},
    ).rulesVersion,
    deployment: {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    hint: configured
      ? "At least one vision provider is configured; the AI scan fallback should work."
      : "No vision provider configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY, then REDEPLOY — existing deployments keep their original env snapshot.",
  });
}

function retryMessage(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { presetId, imageBase64, extracted, source, profile, context } =
    parsed.data;

  const athlete = coerceProfile(profile);
  const scanContext: ScanContext = { ...(context as ScanContext) };

  let label: ExtractedLabel;
  let extractionSource: ExtractionSource;
  let warning: string | undefined;

  if (presetId) {
    /* ---------- Scenario A: demo preset ---------- */
    const preset = getPresetById(presetId);
    if (!preset) {
      return NextResponse.json(
        { error: `Unknown presetId "${presetId}".` },
        { status: 404 },
      );
    }
    label = preset.extracted;
    extractionSource = "mock-preset";
    // Preset context is authoritative; any client-sent context is ignored.
    Object.assign(scanContext, preset.context ?? {});
  } else if (imageBase64) {
    /* ---------- Scenario B: real image via Gemini ---------- */
    const key = imageKey(imageBase64);
    const cached = getCached(key);

    if (cached) {
      // Served without touching the model, so it costs no quota and is not
      // metered against the caller's allowance.
      recordCacheHit();
      label = cached.extracted;
      extractionSource = "vision-llm";
      if (cached.isSupplement) scanContext.isDietarySupplement = true;
    } else if (!hasAnyProvider()) {
      label = { productName: "Unrecognised product", ingredients: [] };
      extractionSource = "vision-llm";
      warning =
        "No AI scan provider is configured, so the AI fallback is unavailable. The on-device reader and manual entry still work.";
    } else {
      // Metered only when a model call is actually going to happen.
      const caller = clientKey(request);
      const limit = checkRateLimit(caller);
      if (!limit.allowed) {
        recordRejection();
        const wait = retryMessage(limit.retryAfterSeconds ?? 60);
        return NextResponse.json(
          {
            error:
              limit.reason === "global-day"
                ? `Label scanning has reached its shared daily limit. Try again in ${wait}, or enter the ingredients manually.`
                : `You have reached the scanning limit. Try again in ${wait}, or enter the ingredients manually.`,
            retryAfterSeconds: limit.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(limit.retryAfterSeconds ?? 60),
            },
          },
        );
      }

      // Reserve the slot BEFORE calling out. A failed call still spends
      // Gemini quota, so metering only successes would let a caller hammer
      // the endpoint for free by forcing failures.
      let reserved = false;
      try {
        const { result: vision, deduped } = await singleFlight(key, () => {
          recordScan(caller);
          reserved = true;
          return extractLabel(imageBase64);
        });
        // A deduped caller rode along on an in-flight request, so it did not
        // spend a model call of its own.
        void deduped;
        setCached(key, vision);
        label = vision.extracted;
        extractionSource = "vision-llm";
        // The model's supplement call may only ADD risk. The engine's own
        // keyword heuristics run regardless and can still flag a product the
        // model called a medicine.
        if (vision.isSupplement) scanContext.isDietarySupplement = true;
        if (label.ingredients.length === 0) {
          warning =
            "No ingredients could be read from that image. Try better lighting, or enter them manually.";
        }
      } catch (cause) {
        void reserved;
        console.error("[scan] label OCR failed:", cause);
        label = { productName: "Unrecognised product", ingredients: [] };
        extractionSource = "vision-llm";
        const kind = cause instanceof ExtractionFailure ? cause.kind : "other";
        warning =
          kind === "quota"
            ? "The daily free-tier limit has been reached on every configured AI provider. It resets within 24 hours — the on-device reader and manual entry still work."
            : kind === "auth"
              ? "The AI scan credentials were rejected. Check GEMINI_API_KEY or OPENROUTER_API_KEY, then redeploy. On-device reading and manual entry still work."
              : kind === "network"
                ? "Could not reach the label-scanning service — this is usually a connection problem. Try again, or enter the ingredients manually."
                : kind === "timeout"
                  ? "Label scanning is busy and took too long, so it was stopped. Try again in a moment, or enter the ingredients manually."
                  : kind === "unavailable"
                    ? "The label-scanning service is temporarily unavailable. Enter the ingredients manually or use a demo preset."
                    : "Label OCR failed, so no ingredients could be read. Enter them manually or use a demo preset.";
      }
    }
  } else if (extracted) {
    /* ---------- Scenario C: manual entry ---------- */
    label = extracted;
    extractionSource = source ?? "manual-entry";
  } else {
    return NextResponse.json(
      { error: "Provide presetId, imageBase64, or extracted ingredients." },
      { status: 400 },
    );
  }

  const evaluation = evaluateLabel(label, athlete, scanContext);

  const payload: ScanResponse = {
    extracted: label,
    extractionSource,
    evaluation,
    ...(warning ? { warning } : {}),
  };

  return NextResponse.json(payload);
}
