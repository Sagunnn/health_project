/**
 * Shared substance-name matching.
 *
 * These primitives are used by BOTH the deterministic rules engine and the
 * on-device reader. Two separate implementations would drift, and a client
 * that recognised a substance the engine did not — or worse, the reverse —
 * would produce a verdict the athlete cannot reproduce. So the normalisation
 * lives here once, and `lib/rules-engine.ts` imports it.
 */

import rulesData from "@/data/wada-rules.json";
import type { WadaClass, WadaRulesDatabase } from "@/types";

const DB = rulesData as WadaRulesDatabase;

/**
 * Collapse a label string to a comparable form: lowercase, punctuation to
 * spaces, single-spaced. Keeps digits because some substance names need them
 * (LGD-4033, GW501516).
 */
export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, "-") // unicode dashes -> hyphen
    .replace(/[^a-z0-9+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip trailing dose/strength noise so "ibuprofen 200 mg" matches "ibuprofen". */
export function stripDose(value: string): string {
  return value
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|%|mg\/ml|ng\/ml)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `needle` occurs in `haystack` on word boundaries. */
export function containsTerm(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const index = haystack.indexOf(needle);
  if (index === -1) return false;

  const before = index === 0 ? " " : haystack[index - 1]!;
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? " " : haystack[afterIndex]!;
  const isBoundary = (char: string) => !/[a-z0-9]/.test(char);

  return isBoundary(before) && isBoundary(after);
}

/* ------------------------------------------------------------------ *
 * Restricted-substance index
 * ------------------------------------------------------------------ */

export interface SubstanceHit {
  /** Canonical WADA substance name. */
  substance: string;
  /** The alias that matched, as it appears in the reference data. */
  alias: string;
  wadaClass: WadaClass;
  ruleId: string;
}

interface IndexEntry {
  needle: string;
  substance: string;
  alias: string;
  wadaClass: WadaClass;
  ruleId: string;
}

/**
 * Only RESTRICTED substances are indexed — never the permitted list.
 *
 * That asymmetry is the whole point. Spotting a prohibited substance in raw
 * OCR text is positive evidence we can act on immediately. Spotting only
 * permitted ones proves nothing: OCR may have dropped the very ingredient
 * that mattered, so "I found paracetamol" must never be read as "this product
 * is clean".
 */
const INDEX: IndexEntry[] = DB.substances
  .flatMap((rule) =>
    rule.aliases.map((alias) => ({
      needle: normalizeTerm(alias),
      substance: rule.substance,
      alias,
      wadaClass: rule.wadaClass,
      ruleId: rule.id,
    })),
  )
  // Longest first so "methylprednisolone" is not reported as a shorter alias.
  .sort((a, b) => b.needle.length - a.needle.length);

/**
 * Finds every restricted substance named anywhere in free text.
 *
 * Works on the whole OCR dump rather than a parsed ingredient list, because
 * generic packs print the molecule in the product title ("Frusemide Tablets
 * I.P. 40 mg") and brand packs put it in brackets ("LAMADOL (Tramadol HCl)") —
 * places an ingredients-panel parser will not look.
 */
export function findRestrictedSubstances(text: string): SubstanceHit[] {
  const haystack = stripDose(normalizeTerm(text));
  if (!haystack) return [];

  const hits: SubstanceHit[] = [];
  const seen = new Set<string>();

  for (const entry of INDEX) {
    if (seen.has(entry.ruleId)) continue;
    if (!containsTerm(haystack, entry.needle)) continue;
    seen.add(entry.ruleId);
    hits.push({
      substance: entry.substance,
      alias: entry.alias,
      wadaClass: entry.wadaClass,
      ruleId: entry.ruleId,
    });
  }

  return hits;
}
