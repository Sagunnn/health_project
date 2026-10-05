/**
 * Cache and single-flight guard for label extraction.
 *
 * The rules engine is instant, so caching verdicts buys nothing — the only
 * expensive step is the model call that turns an image into text. This caches
 * that step, keyed by a hash of the image bytes, so re-scanning the same photo
 * (a retry, a double tap, a demo shown twice) costs no quota.
 *
 * Verdicts are deliberately NOT cached: the same product resolves differently
 * as a competition date approaches, so the engine must re-run every time on
 * the current profile and clock.
 *
 * Same caveat as rate limiting: this is per-instance memory, not shared
 * across serverless invocations. It is a quota saver, not a guarantee.
 */

import { createHash } from "node:crypto";
import type { ExtractedLabel } from "@/types";

export interface CachedExtraction {
  extracted: ExtractedLabel;
  isSupplement: boolean;
  model: string;
}

interface Entry extends CachedExtraction {
  expiresAt: number;
}

const TTL_MS = Number(process.env.EXTRACTION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const MAX_ENTRIES = 200;

const cache = new Map<string, Entry>();
/** Requests already in flight, so concurrent duplicates share one model call. */
const inFlight = new Map<string, Promise<CachedExtraction>>();

export function imageKey(imageBase64: string): string {
  return createHash("sha256").update(imageBase64).digest("hex").slice(0, 32);
}

export function getCached(key: string): CachedExtraction | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency for the LRU eviction below.
  cache.delete(key);
  cache.set(key, entry);
  return { extracted: entry.extracted, isSupplement: entry.isSupplement, model: entry.model };
}

export function setCached(key: string, value: CachedExtraction): void {
  // An empty extraction is a failure, not a result worth replaying.
  if (value.extracted.ingredients.length === 0) return;
  cache.set(key, { ...value, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Runs `work` for `key`, collapsing concurrent callers onto one execution.
 *
 * Two taps on the scan button, or a client retry while the first request is
 * still running, would otherwise spend two of a very small daily allowance on
 * the identical image.
 */
export async function singleFlight(
  key: string,
  work: () => Promise<CachedExtraction>,
): Promise<{ result: CachedExtraction; deduped: boolean }> {
  const existing = inFlight.get(key);
  if (existing) return { result: await existing, deduped: true };

  const promise = work();
  inFlight.set(key, promise);
  try {
    return { result: await promise, deduped: false };
  } finally {
    inFlight.delete(key);
  }
}

export function cacheStats() {
  return { entries: cache.size, inFlight: inFlight.size, ttlMs: TTL_MS };
}

/** Test seam. */
export function __resetExtractionCache(): void {
  cache.clear();
  inFlight.clear();
}
