/**
 * Vision-model label extraction, across providers.
 *
 * ARCHITECTURAL LAW: a model is used ONLY to turn an image into
 * { productName, ingredients, isSupplement }. It is never asked whether
 * something is permitted, what WADA class it falls under, or what the athlete
 * should do. Those come from lib/rules-engine.ts.
 *
 * Providers exist because no single free allowance is reliable: Gemini meters
 * 20 requests per project per model per day and returns 503 under load, so a
 * second provider is the difference between a working scanner and a dead one.
 * Attempts are flattened into one ordered list and walked under a single
 * wall-clock budget, so adding a provider never multiplies the worst case.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type { ExtractedLabel } from "@/types";

/* ------------------------------ contract ------------------------------ */

/** The ONLY shape a model is allowed to return. */
export const extractionSchema = z.object({
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

/**
 * Deliberately requires EVERY line item, including proprietary blends and
 * botanical names. Testing showed that asking only for "normalized chemical
 * names" made the model silently drop "Proprietary Energy Blend" from a
 * pre-workout label — precisely the opaque-label signal the engine uses to
 * raise SUPPLEMENT_RISK, so dropping it downgraded a risky product to clear.
 */
export const EXTRACTION_PROMPT = [
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
  'Return ONLY a JSON object: {"productName": string, "ingredients": string[], "isSupplement": boolean}',
].join(" ");

export interface VisionResult {
  extracted: ExtractedLabel;
  isSupplement: boolean;
  model: string;
  provider: string;
}

export type FailureKind =
  "quota" | "auth" | "unavailable" | "network" | "timeout" | "other";

export class ExtractionFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    cause?: unknown,
  ) {
    super(`Label extraction failed (${kind}).`, { cause });
    this.name = "ExtractionFailure";
  }
}

/* ---------------------------- classification --------------------------- */

/**
 * Classify a failure so the chain knows whether to keep going, and so the
 * athlete gets a message they can act on.
 *
 * The error chain is walked because the AI SDK wraps the socket error inside
 * an APICallError, and the outer message alone does not name the cause.
 */
export function classify(error: unknown): FailureKind {
  if (error instanceof HttpStatusError) return error.kind;

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
    /RESOURCE_EXHAUSTED|exceeded your current quota|quota|rate limit|429|\b402\b|insufficient credits|out of credits|requires more credits/i.test(
      message,
    )
  ) {
    return "quota";
  }
  if (
    /API_KEY_INVALID|api key not valid|api key expired|PERMISSION_DENIED|UNAUTHENTICATED|invalid authentication|No auth credentials|\b401\b|\b403\b/i.test(
      message,
    )
  ) {
    return "auth";
  }
  // Our own AbortSignal raises these; they are not connection faults.
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
    /no longer available|not found|high demand|overloaded|unavailable|503|502|504/i.test(
      message,
    )
  ) {
    return "unavailable";
  }
  return "other";
}

/** Carries an already-classified HTTP failure from a raw-fetch provider. */
class HttpStatusError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status: number,
    detail: string,
  ) {
    super(`HTTP ${status}: ${detail}`.slice(0, 300));
    this.name = "HttpStatusError";
  }
}

function kindForStatus(status: number): FailureKind {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota"; // out of credits
  if (status >= 500) return "unavailable";
  if (status === 404) return "unavailable";
  return "other";
}

/* ------------------------------ providers ------------------------------ */

function listEnvKeys(base: string, extraNames: string[] = []): string[] {
  const names = [
    base,
    ...Array.from({ length: 9 }, (_, i) => `${base}_${i + 1}`),
    ...extraNames,
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

export function geminiKeys(): string[] {
  return listEnvKeys("GEMINI_API_KEY", ["GOOGLE_GENERATIVE_AI_API_KEY"]);
}

export function openRouterKeys(): string[] {
  return listEnvKeys("OPENROUTER_API_KEY");
}

function csv(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

/**
 * Google retires Gemini models on a rolling basis and returns a hard error
 * for retired ones, so a single pinned model is a scanner that breaks without
 * warning. Verified against the live ListModels API on 2026-10-05:
 * gemini-1.5-flash and gemini-2.5-flash are both already retired.
 */
export function geminiModels(): string[] {
  return csv(process.env.GEMINI_MODEL, [
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3-flash-preview",
  ]);
}

/** Free vision models, confirmed present in OpenRouter's catalogue. */
export function openRouterModels(): string[] {
  return csv(process.env.OPENROUTER_MODELS, [
    "qwen/qwen3.8-27b:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",
  ]);
}

/** Splits a data: URL into media type and payload; tolerates bare base64. */
export function parseImage(input: string): { data: string; mimeType: string } {
  const match = input.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) return { mimeType: match[1]!, data: match[2]! };
  return { mimeType: "image/jpeg", data: input };
}

async function geminiExtract(
  key: string,
  model: string,
  data: string,
  mimeType: string,
  budgetMs: number,
): Promise<VisionResult> {
  const google = createGoogleGenerativeAI({ apiKey: key });
  const result = await generateObject({
    model: google(model),
    schema: extractionSchema,
    // No SDK-level retry: it sleeps and retries on 429s too, which turned an
    // exhausted quota into a 45s wait. Socket faults are retried by the caller.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(budgetMs),
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
    provider: "gemini",
  };
}

/** Pulls a JSON object out of a reply that may be fenced or prose-wrapped. */
export function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1]! : content).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start)
      throw new Error("No JSON object in reply.");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * OpenRouter via its OpenAI-compatible REST API.
 *
 * Called with fetch rather than a provider package: @openrouter/ai-sdk-provider
 * requires ai@7 and this project is on ai@4. Free models also vary in whether
 * they honour response_format or tool calling, so the reply is parsed and
 * validated here instead of relying on structured-output support.
 */
async function openRouterExtract(
  key: string,
  model: string,
  data: string,
  mimeType: string,
  budgetMs: number,
): Promise<VisionResult> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      signal: AbortSignal.timeout(budgetMs),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution on its dashboard.
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL ?? "https://besafe.local",
        "X-Title": "BESAFE by AIMS",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACTION_PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${data}` },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpStatusError(
      kindForStatus(response.status),
      response.status,
      body.slice(0, 200),
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: number };
  };

  if (payload.error) {
    throw new HttpStatusError(
      kindForStatus(payload.error.code ?? 500),
      payload.error.code ?? 500,
      payload.error.message ?? "unknown error",
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content.");

  const parsed = extractionSchema.safeParse(parseJsonObject(content));
  if (!parsed.success) {
    throw new Error(
      `OpenRouter reply did not match the extraction schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }

  return {
    extracted: {
      productName: parsed.data.productName,
      ingredients: parsed.data.ingredients,
    },
    isSupplement: parsed.data.isSupplement,
    model,
    provider: "openrouter",
  };
}

/* ----------------------------- orchestration ---------------------------- */

interface Attempt {
  provider: string;
  model: string;
  /** Identifies the credential without revealing it. */
  keyIndex: number;
  /** Attempts sharing a credential are skipped together once it is unusable. */
  credentialId: string;
  run: (budgetMs: number) => Promise<VisionResult>;
}

/** Providers in the order they are tried. */
export function providerOrder(): string[] {
  return csv(process.env.VISION_PROVIDER_ORDER, ["gemini", "openrouter"]);
}

function buildAttempts(data: string, mimeType: string): Attempt[] {
  const attempts: Attempt[] = [];
  for (const provider of providerOrder()) {
    if (provider === "gemini") {
      geminiKeys().forEach((key, i) => {
        for (const model of geminiModels()) {
          attempts.push({
            provider,
            model,
            keyIndex: i + 1,
            credentialId: `gemini:${i}`,
            run: (budget) => geminiExtract(key, model, data, mimeType, budget),
          });
        }
      });
    } else if (provider === "openrouter") {
      openRouterKeys().forEach((key, i) => {
        for (const model of openRouterModels()) {
          attempts.push({
            provider,
            model,
            keyIndex: i + 1,
            credentialId: `openrouter:${i}`,
            run: (budget) =>
              openRouterExtract(key, model, data, mimeType, budget),
          });
        }
      });
    }
  }
  return attempts;
}

/** True when at least one provider is configured. */
export function hasAnyProvider(): boolean {
  return geminiKeys().length > 0 || openRouterKeys().length > 0;
}

export const OCR_BUDGET_MS = Number(process.env.OCR_BUDGET_MS ?? 45_000);

/**
 * Ceiling on a single attempt, so one hanging provider cannot consume the
 * whole budget and starve the ones behind it. Without this, a Gemini key that
 * stalls means OpenRouter is never tried at all — which defeats the point of
 * configuring a second provider.
 */
export const OCR_ATTEMPT_MS = Number(process.env.OCR_ATTEMPT_MS ?? 18_000);

/**
 * Walks every configured provider, key and model until one extracts a label.
 *
 * A credential that is out of quota or rejected is out for every model behind
 * it, so its remaining attempts are skipped rather than retried.
 */
export async function extractLabel(imageBase64: string): Promise<VisionResult> {
  const { data, mimeType } = parseImage(imageBase64);
  const attempts = buildAttempts(data, mimeType);
  if (attempts.length === 0) {
    throw new Error("No vision provider is configured.");
  }

  const startedAt = Date.now();
  const deadCredentials = new Set<string>();
  let lastError: unknown;
  let lastKind: FailureKind | undefined;
  let sawQuota = false;

  for (const attempt of attempts) {
    if (deadCredentials.has(attempt.credentialId)) continue;

    // Up to two tries; the second only for a transient socket fault.
    for (let tries = 0; tries < 2; tries++) {
      const remaining = OCR_BUDGET_MS - (Date.now() - startedAt);
      // Leave enough headroom that an attempt can plausibly finish.
      if (remaining < 5_000) {
        lastKind = "timeout";
        throw new ExtractionFailure(sawQuota ? "quota" : "timeout", lastError);
      }
      const budget = Math.min(remaining, OCR_ATTEMPT_MS);

      try {
        const result = await attempt.run(budget);
        if (attempt !== attempts[0]) {
          console.warn(
            `[scan] extracted via ${attempt.provider} key #${attempt.keyIndex} (${attempt.model}) after fallback`,
          );
        }
        return result;
      } catch (cause) {
        lastError = cause;
        const kind = classify(cause);
        lastKind = kind;
        if (kind === "quota") sawQuota = true;
        // Credential material never reaches the log — only its position.
        console.error(
          `[scan] ${attempt.provider} key #${attempt.keyIndex} model ${attempt.model} failed (${kind}):`,
          cause,
        );

        if (kind === "quota" || kind === "auth") {
          deadCredentials.add(attempt.credentialId);
          break;
        }
        if (kind === "timeout") {
          // It stalled once; its other models are behind the same endpoint.
          deadCredentials.add(attempt.credentialId);
          break;
        }
        if (kind === "network" && tries === 0) continue;
        break;
      }
    }
  }

  // Quota wins because it is the most actionable thing an athlete can be
  // told; otherwise report whatever actually ended the attempt.
  throw new ExtractionFailure(
    sawQuota ? "quota" : (lastKind ?? "unavailable"),
    lastError,
  );
}

/** Non-sensitive provider summary for the health endpoint. */
export function providerSnapshot() {
  return {
    order: providerOrder(),
    gemini: { keys: geminiKeys().length, models: geminiModels() },
    openrouter: { keys: openRouterKeys().length, models: openRouterModels() },
    budgetMs: OCR_BUDGET_MS,
    attemptMs: OCR_ATTEMPT_MS,
  };
}
