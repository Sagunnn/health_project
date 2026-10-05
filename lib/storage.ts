/**
 * SSR-safe localStorage helpers.
 *
 * Every read must tolerate running on the server (where `window` is absent)
 * and tolerate corrupt or stale JSON written by an older build. Readers
 * therefore always fall back to a valid default rather than throwing — a
 * parse error must never take down the scanner.
 */

import type { AthleteProfile, PassportEntry, SafetyStatus } from "@/types";

const PROFILE_KEY = "besafe.athlete-profile.v1";
const PASSPORT_KEY = "besafe.passport.v1";

export const DEFAULT_PROFILE: AthleteProfile = {
  name: "",
  sport: "",
  discipline: "",
  level: "",
  nextCompetitionDate: null,
  nado: "",
  hasApprovedTue: false,
  updatedAt: "",
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private-mode restrictions: the app stays usable, the
    // record just is not persisted.
  }
}

/* ------------------------------- Profile ------------------------------- */

export function loadProfile(): AthleteProfile {
  const stored = readJson<Partial<AthleteProfile>>(PROFILE_KEY, {});
  // Merge over defaults so a profile saved by an earlier schema still loads.
  return { ...DEFAULT_PROFILE, ...stored };
}

export function saveProfile(profile: AthleteProfile): AthleteProfile {
  const next = { ...profile, updatedAt: new Date().toISOString() };
  writeJson(PROFILE_KEY, next);
  return next;
}

/* ------------------------------- Passport ------------------------------ */

export function loadPassport(): PassportEntry[] {
  const entries = readJson<PassportEntry[]>(PASSPORT_KEY, []);
  if (!Array.isArray(entries)) return [];
  // Newest first; the timeline renders in this order.
  return entries
    .filter((entry) => entry && typeof entry.id === "string")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function savePassportEntry(entry: PassportEntry): PassportEntry[] {
  const next = [entry, ...loadPassport().filter((e) => e.id !== entry.id)];
  writeJson(PASSPORT_KEY, next);
  return next;
}

export function deletePassportEntry(id: string): PassportEntry[] {
  const next = loadPassport().filter((entry) => entry.id !== id);
  writeJson(PASSPORT_KEY, next);
  return next;
}

export function clearPassport(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(PASSPORT_KEY);
  } catch {
    // ignore
  }
}

/* -------------------------------- Helpers ------------------------------ */

/** Stable id without pulling in a uuid dependency. */
export function createEntryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function countByStatus(
  entries: PassportEntry[],
): Record<SafetyStatus, number> {
  const counts: Record<SafetyStatus, number> = {
    NOT_PROHIBITED: 0,
    CONDITIONAL: 0,
    PROHIBITED: 0,
    SUPPLEMENT_RISK: 0,
    UNVERIFIED: 0,
  };
  for (const entry of entries) {
    if (entry.status in counts) counts[entry.status] += 1;
  }
  return counts;
}
