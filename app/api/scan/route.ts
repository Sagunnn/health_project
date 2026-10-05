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

function apiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
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
  source: z.enum(["mock-preset", "manual-entry"]).optional(),
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

function isRecoverable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no longer available|not found|high demand|overloaded|unavailable|quota|rate limit|503|429/i.test(
    message,
  );
}

interface VisionResult {
  extracted: ExtractedLabel;
  isSupplement: boolean;
  model: string;
}

/** Runs the extraction, walking the model chain past retired/throttled models. */
async function extractWithGemini(
  imageBase64: string,
): Promise<VisionResult> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const google = createGoogleGenerativeAI({ apiKey: key });
  const { data, mimeType } = parseImage(imageBase64);
  let lastError: unknown;

  for (const model of MODEL_CHAIN) {
    try {
      const result = await generateObject({
        model: google(model),
        schema: extractionSchema,
        maxRetries: 1,
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
    } catch (cause) {
      lastError = cause;
      console.error(`[scan] model ${model} failed:`, cause);
      if (!isRecoverable(cause)) throw cause;
      // Otherwise fall through and try the next model in the chain.
    }
  }

  throw lastError ?? new Error("No Gemini model was available.");
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

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
    if (!apiKey()) {
      label = { productName: "Unrecognised product", ingredients: [] };
      extractionSource = "vision-llm";
      warning =
        "GEMINI_API_KEY is not configured, so label OCR is unavailable. Enter the ingredients manually or use a demo preset.";
    } else {
      try {
        const vision = await extractWithGemini(imageBase64);
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
        console.error("[scan] label OCR failed:", cause);
        label = { productName: "Unrecognised product", ingredients: [] };
        extractionSource = "vision-llm";
        warning =
          "Label OCR failed, so no ingredients could be read. Enter them manually or use a demo preset.";
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
