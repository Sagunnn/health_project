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
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import { getPresetById } from "@/lib/demo-presets";
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
 * Model configuration
 * ------------------------------------------------------------------ */

/**
 * Google retires Gemini models on a rolling basis and returns a hard error
 * for retired ones ("no longer available to new users"), so a single pinned
 * model is a demo that breaks without warning. The first entry is used; the
 * rest are tried in order when a model is unavailable or throttled.
 *
 * Verified against the live ListModels API on 2026-10-05: gemini-1.5-flash
 * and gemini-2.5-flash are both retired.
 */
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
].filter((model): model is string => Boolean(model));

/**
 * Every configured Gemini key, in rotation order.
 *
 * Gemini's free tier meters requests per project per model per day, so a
 * second key on a second project is a second allowance. Keys are tried in
 * order and a quota failure moves to the next one, which keeps the scanner
 * working past the point where a single free-tier key gives up.
 *
 * Reads GEMINI_API_KEY, then GEMINI_API_KEY_1..9, then the provider's own
 * GOOGLE_GENERATIVE_AI_API_KEY. Blanks and duplicates are dropped so an
 * unset slot in the middle does not waste an attempt.
 */
function apiKeys(): string[] {
  const names = [
    "GEMINI_API_KEY",
    ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY_${i + 1}`),
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    keys.push(value);
  }
  return keys;
}

function apiKey(): string | undefined {
  return apiKeys()[0];
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

/** The ONLY shape the model is allowed to return. */
const extractionSchema = z.object({
  productName: z
    .string()
    .describe("The commercial product name exactly as printed on the label."),
  ingredients: z
    .array(z.string())
    .describe(
      "Every line item listed on the label, including proprietary blends.",
    ),
  isSupplement: z
    .boolean()
    .describe(
      "True when the packaging presents this as a dietary supplement rather than a licensed medicine.",
    ),
});

const requestSchema = z.object({
  /** Scenario A — demo preset, resolved server-side with no model call. */
  presetId: z.string().optional(),
  /** Scenario B — data: URL or bare base64 image. */
  imageBase64: z.string().optional(),
  /** Scenario C — ingredients typed by the athlete. */
  extracted: z
    .object({
      productName: z.string(),
      ingredients: z.array(z.string()),
    })
    .optional(),
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

/**
 * Extraction prompt.
 *
 * Deliberately requires EVERY line item, including proprietary blends and
 * botanical names. Testing showed that asking only for "normalized chemical
 * names" made the model silently drop "Proprietary Energy Blend" from a
 * pre-workout label — which is precisely the opaque-label signal the engine
 * uses to raise SUPPLEMENT_RISK. Dropping it would have downgraded a risky
 * product to clear.
 */
const EXTRACTION_PROMPT = [
  "You are a medical OCR data extractor.",
  "Read this product label and extract:",
  "1. productName — the commercial product name as printed.",
  "2. ingredients — EVERY item listed on the label: active ingredients,",
  "   inactive ingredients and excipients, proprietary or herbal blends, and",
  "   botanical names. Give the standard chemical name where one clearly",
  "   exists; otherwise transcribe exactly as printed. Never omit an item",
  "   because you cannot identify it — transcribe it verbatim.",
  "3. isSupplement — true if the packaging presents this as a dietary",
  "   supplement rather than a licensed medicine.",
  "Transcribe only what is printed. Do NOT judge whether anything is",
  "permitted, prohibited, or safe. If the label is unreadable, return an",
  "empty ingredients array.",
  "Return ONLY structured JSON.",
].join(" ");

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Splits a data: URL into its media type and payload; tolerates bare base64. */
function parseImage(input: string): { data: string; mimeType: string } {
  const match = input.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: input };
}

function coerceProfile(raw: unknown): AthleteProfile {
  return { ...DEFAULT_PROFILE, ...((raw ?? {}) as Partial<AthleteProfile>) };
}

/**
 * Wall-clock budget for the whole extraction, across every model in the
 * chain. Without it, three models each retrying with backoff took 90s on an
 * exhausted quota — long past Vercel's function timeout, so the athlete would
 * get a 504 instead of the manual-entry fallback.
 */
const OCR_BUDGET_MS = Number(process.env.OCR_BUDGET_MS ?? 45_000);

type FailureKind =
  "quota" | "auth" | "unavailable" | "network" | "timeout" | "other";

/**
 * Classify a failure so the chain knows whether to keep going, and so the
 * athlete gets a message they can act on.
 *
 * Connection errors must be recoverable: a single ETIMEDOUT reaching Google
 * is transient, and treating it as fatal aborted the whole chain on a blip.
 * The error chain is walked because the AI SDK wraps the socket error inside
 * an APICallError, and the outer message alone does not name the cause.
 */
function classify(error: unknown): FailureKind {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 6; depth++) {
    if (cur instanceof Error) {
      parts.push(cur.name, cur.message);
      const code = (cur as NodeJS.ErrnoException).code;
      if (code) parts.push(code);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  const message = parts.join(" ");

  if (
    /RESOURCE_EXHAUSTED|exceeded your current quota|quota|rate limit|429/i.test(
      message,
    )
  ) {
    return "quota";
  }
  // A rejected key is the whole reason rotation exists: it must move to the
  // next key rather than failing the scan outright.
  if (
    /API_KEY_INVALID|api key not valid|api key expired|PERMISSION_DENIED|UNAUTHENTICATED|invalid authentication|\b401\b|\b403\b/i.test(
      message,
    )
  ) {
    return "auth";
  }
  if (/\bTimeoutError\b|\bAbortError\b|operation was aborted/i.test(message)) {
    return "timeout";
  }
  if (
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|Cannot connect to API|fetch failed/i.test(
      message,
    )
  ) {
    return "network";
  }
  if (
    /no longer available|not found|high demand|overloaded|unavailable|503/i.test(
      message,
    )
  ) {
    return "unavailable";
  }
  return "other";
}

/** An error carrying why the whole chain gave up, for the user-facing copy. */
class ExtractionFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    cause?: unknown,
  ) {
    super(`Label extraction failed (${kind}).`, { cause });
  }
}

interface VisionResult {
  extracted: ExtractedLabel;
  isSupplement: boolean;
  model: string;
}

/** Runs the extraction, walking the model chain past retired/throttled models. */
async function extractWithGemini(imageBase64: string): Promise<VisionResult> {
  const keys = apiKeys();
  if (keys.length === 0) throw new Error("GEMINI_API_KEY is not configured.");

  const { data, mimeType } = parseImage(imageBase64);
  const startedAt = Date.now();

  let lastError: unknown;
  let lastKind: FailureKind | undefined;
  let sawQuota = false;
  let sawAuth = false;

  const remainingMs = () => OCR_BUDGET_MS - (Date.now() - startedAt);

  /** One attempt against one key and model. Throws on failure. */
  const attempt = async (
    google: ReturnType<typeof createGoogleGenerativeAI>,
    model: string,
    budget: number,
  ): Promise<VisionResult> => {
    const result = await generateObject({
      model: google(model),
      schema: extractionSchema,
      // No SDK-level retry: it sleeps and retries on 429s too, which turned
      // an exhausted quota into a 45s wait. Socket faults get one immediate
      // retry below instead.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(budget),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image", image: data, mimeType },
          ],
        },
      ],
    });
    return {
      extracted: {
        productName: result.object.productName,
        ingredients: result.object.ingredients,
      },
      isSupplement: result.object.isSupplement,
      model,
    };
  };

  // Keys outer, models inner: a key whose quota is gone is gone for every
  // model on that project, so exhausting its models first is the cheap way
  // to establish that before paying for a rotation.
  outer: for (let k = 0; k < keys.length; k++) {
    const google = createGoogleGenerativeAI({ apiKey: keys[k] });
    let keyUnusable = false;

    for (const model of MODEL_CHAIN) {
      // Up to two tries: the second only for a transient socket fault.
      for (let tries = 0; tries < 2; tries++) {
        const budget = remainingMs();
        // Leave enough headroom that an attempt can plausibly finish.
        if (budget < 5_000) {
          lastKind = "timeout";
          break outer;
        }

        try {
          const vision = await attempt(google, model, budget);
          if (k > 0) {
            console.warn(`[scan] succeeded on key #${k + 1} after rotation`);
          }
          return vision;
        } catch (cause) {
          lastError = cause;
          const kind = classify(cause);
          lastKind = kind;
          if (kind === "quota") {
            sawQuota = true;
            keyUnusable = true;
          }
          if (kind === "auth") {
            sawAuth = true;
            keyUnusable = true;
          }
          // Key material never reaches the log — only its rotation position.
          console.error(
            `[scan] key #${k + 1}, model ${model} failed (${kind}):`,
            cause,
          );

          if (kind === "other") throw new ExtractionFailure("other", cause);
          // A bad key fails identically on every model; stop wasting attempts.
          if (kind === "auth" || kind === "quota") break;
          // Retry the same model once, but only for a socket fault.
          if (kind === "network" && tries === 0) continue;
          break;
        }
      }
      if (keyUnusable) break;
    }

    if (keyUnusable && k < keys.length - 1) {
      console.warn(
        `[scan] key #${k + 1} unusable (${sawAuth ? "rejected" : "quota"}), rotating to #${k + 2}`,
      );
    }
  }

  // Quota wins because it is the most actionable thing an athlete can be
  // told; otherwise report whatever actually ended the attempt.
  throw new ExtractionFailure(
    sawQuota ? "quota" : (lastKind ?? "unavailable"),
    lastError,
  );
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
  const key = apiKey();
  return NextResponse.json({
    ok: Boolean(key),
    keyConfigured: Boolean(key),
    keySource: process.env.GEMINI_API_KEY
      ? "GEMINI_API_KEY"
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? "GOOGLE_GENERATIVE_AI_API_KEY"
        : null,
    // Length only — catches a truncated paste or stray quotes without
    // revealing any part of the secret.
    keyLength: key ? key.length : 0,
    keysConfigured: apiKeys().length,
    modelChain: MODEL_CHAIN,
    deployment: {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    usage: usageSnapshot(),
    cache: cacheStats(),
    rulesVersion: evaluateLabel(
      { productName: "", ingredients: [] },
      DEFAULT_PROFILE,
      {},
    ).rulesVersion,
    hint: key
      ? "Key present. Label OCR should work."
      : "No key on this deployment. Add GEMINI_API_KEY in Vercel, then REDEPLOY — existing deployments keep their original env snapshot.",
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
    } else if (!apiKey()) {
      label = { productName: "Unrecognised product", ingredients: [] };
      extractionSource = "vision-llm";
      warning =
        "GEMINI_API_KEY is not configured, so label OCR is unavailable. Enter the ingredients manually or use a demo preset.";
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
          return extractWithGemini(imageBase64);
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
            ? `The daily free-tier limit for label scanning has been reached on ${apiKeys().length > 1 ? "all configured keys" : "the configured key"}. It resets within 24 hours — enter the ingredients manually in the meantime.`
            : kind === "auth"
              ? "The label-scanning key was rejected. Check GEMINI_API_KEY in your environment, then redeploy. You can still enter ingredients manually."
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
