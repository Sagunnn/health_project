/**
 * Rate limiting and usage accounting for the label-OCR path.
 *
 * The deployed /api/scan is public, and every image scan spends from a shared
 * Gemini free-tier allowance. Without a limit, one visitor — or one script —
 * can burn the day's quota for every athlete using the app.
 *
 * IMPORTANT LIMITATION: this is in-process state. Serverless instances do not
 * share memory, so the effective ceiling is per-instance and a burst spread
 * across cold starts can exceed it. That is a deliberate trade for the MVP:
 * it stops casual abuse and accidental loops with no external dependency. A
 * production deployment should back this with Vercel KV, Upstash, or Redis so
 * the counters are shared.
 *
 * Only the model-backed path is metered. Demo presets and manual entry cost
 * nothing, so they are never limited — a stakeholder demo must not be
 * throttled by someone else's scanning.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function intFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const LIMITS = {
  /** Image scans per client per hour. */
  perClientPerHour: intFromEnv("SCAN_LIMIT_PER_HOUR", 10),
  /** Image scans per client per day. */
  perClientPerDay: intFromEnv("SCAN_LIMIT_PER_DAY", 30),
  /** Ceiling on model calls across all clients, protecting the free tier. */
  globalPerDay: intFromEnv("SCAN_LIMIT_GLOBAL_PER_DAY", 150),
};

interface Hit {
  /** Epoch ms of each metered scan, newest last. */
  times: number[];
}

const clients = new Map<string, Hit>();
let globalTimes: number[] = [];

/** Total scans served, for the health endpoint. Not persisted. */
const totals = { metered: 0, cacheHits: 0, rejected: 0, startedAt: Date.now() };

function prune(times: number[], now: number): number[] {
  const cutoff = now - DAY_MS;
  // Times are appended in order, so the first in-window index is enough.
  let i = 0;
  while (i < times.length && times[i] < cutoff) i += 1;
  return i === 0 ? times : times.slice(i);
}

/** Keeps the client map from growing without bound on a long-lived instance. */
function sweep(now: number): void {
  if (clients.size < 5000) return;
  for (const [key, hit] of clients) {
    const kept = prune(hit.times, now);
    if (kept.length === 0) clients.delete(key);
    else hit.times = kept;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "client-hour" | "client-day" | "global-day";
  /** Seconds until the relevant window frees up. */
  retryAfterSeconds?: number;
  remainingToday: number;
}

/**
 * Derives a client key from proxy headers.
 *
 * Vercel sets x-forwarded-for; the first entry is the original client. This is
 * spoofable by a determined caller, which is another reason the global daily
 * ceiling exists as a backstop.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/** Checks the limits without recording a hit. */
export function checkRateLimit(
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  sweep(now);
  globalTimes = prune(globalTimes, now);

  const hit = clients.get(key);
  const times = hit ? prune(hit.times, now) : [];
  if (hit) hit.times = times;

  const lastHour = times.filter((t) => t > now - HOUR_MS);
  const remainingToday = Math.max(0, LIMITS.perClientPerDay - times.length);

  if (globalTimes.length >= LIMITS.globalPerDay) {
    const oldest = globalTimes[0] ?? now;
    return {
      allowed: false,
      reason: "global-day",
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)),
      remainingToday,
    };
  }
  if (lastHour.length >= LIMITS.perClientPerHour) {
    const oldest = lastHour[0] ?? now;
    return {
      allowed: false,
      reason: "client-hour",
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)),
      remainingToday,
    };
  }
  if (times.length >= LIMITS.perClientPerDay) {
    const oldest = times[0] ?? now;
    return {
      allowed: false,
      reason: "client-day",
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)),
      remainingToday: 0,
    };
  }

  return { allowed: true, remainingToday };
}

/** Records one metered scan. Call only when a model call is actually made. */
export function recordScan(key: string, now: number = Date.now()): void {
  const hit = clients.get(key) ?? { times: [] };
  hit.times = prune(hit.times, now);
  hit.times.push(now);
  clients.set(key, hit);
  globalTimes = prune(globalTimes, now);
  globalTimes.push(now);
  totals.metered += 1;
}

export function recordCacheHit(): void {
  totals.cacheHits += 1;
}

export function recordRejection(): void {
  totals.rejected += 1;
}

/** Non-sensitive counters for the health endpoint. */
export function usageSnapshot(now: number = Date.now()) {
  globalTimes = prune(globalTimes, now);
  return {
    limits: LIMITS,
    modelCallsLast24h: globalTimes.length,
    globalRemainingToday: Math.max(0, LIMITS.globalPerDay - globalTimes.length),
    trackedClients: clients.size,
    totals: { ...totals },
    // Counters live in instance memory, so they reset on a cold start.
    sinceInstanceStartedMinutes: Math.round(
      (now - totals.startedAt) / 60000,
    ),
  };
}

/** Test seam. */
export function __resetRateLimitState(): void {
  clients.clear();
  globalTimes = [];
  totals.metered = 0;
  totals.cacheHits = 0;
  totals.rejected = 0;
  totals.startedAt = Date.now();
}
