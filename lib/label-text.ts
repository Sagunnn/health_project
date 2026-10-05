/**
 * Turns raw OCR text from a label into a candidate product name and
 * ingredient list.
 *
 * Pure and dependency-free so it can be tested without a browser or a model.
 *
 * SAFETY NOTE: this is deliberately a *proposal*, never a verdict. On-device
 * OCR misreads packaging — curved boxes, glare, small print — and an
 * ingredient it drops would otherwise produce a clean result for a product
 * that is not clean. So the parsed list is shown to the athlete to confirm or
 * correct before the rules engine ever sees it. That is also why nothing here
 * tries to "fix" characters: silently rewriting what was read would hide the
 * very errors the confirmation step exists to catch.
 */

/** Lines at or after one of these start an ingredient block. */
const INGREDIENT_HEADINGS =
  /\b(active ingredient|inactive ingredient|other ingredient|ingredients?|drug facts|supplement facts|composition|each tablet contains|medicinal ingredient)\b/i;

/** Lines at or after one of these end it. */
const STOP_HEADINGS =
  /\b(uses?|warnings?|directions?|purpose|keep out of reach|storage|distributed by|manufactured|questions|other information|do not use|ask a doctor)\b/i;

/**
 * Words that describe what an ingredient *does*, or where it sits on the
 * label, rather than naming a substance. Boxes print these right beside the
 * actives ("Phenylephrine HCl / Nasal Decongestant"), and OCR frequently runs
 * the two columns together, so a fragment is rejected when nothing but these
 * is left after they are removed.
 */
const ROLE_TOKENS =
  /\b(pain|reliever|fever|reducer|nasal|decongestant|antihistamine|expectorant|cough|suppressant|antitussive|analgesic|purpose|uses?|active|inactive|other|ingredients?|amount|per|each|serving|dose|tablets?|caplets?|capsules?|softgels?|contains?|in|the|and|mg|mcg|ml|g)\b/gi;

/** Obvious packaging noise that is never an ingredient. */
const NOISE =
  /^(non-?drowsy|tablets?|caplets?|capsules?|softgels?|ultratabs?|actual size|small tablet size|total|each|mg|ml|www\.|https?:|ndc\b|lot\b|exp\b|otc\b)/i;

function cleanLine(line: string): string {
  return line
    .replace(/[^\p{L}\p{N}\s,;./%+()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a fragment plausibly names a substance. */
function looksLikeIngredient(fragment: string): boolean {
  const text = fragment.replace(/^[\s(]+|[\s)]+$/g, "").trim();
  if (text.length < 4 || text.length > 80) return false;
  if (NOISE.test(text)) return false;

  // Strip role and packaging words; a real substance name survives this,
  // "Nasal Decongestant Antihistamine" and "in each tablet" do not.
  const residue = text
    .replace(new RegExp(ROLE_TOKENS.source, "gi"), " ")
    .replace(/[^\p{L}]/gu, "");
  if (residue.length < 4) return false;

  // Needs at least one word of real length — "HCl 10" names nothing on its own.
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.some((w) => w.replace(/[^\p{L}]/gu, "").length >= 4);
}

function splitFragments(line: string): string[] {
  return line
    .split(/[,;]|\s{3,}|\s\.{3,}\s?/)
    .map((part) => part.replace(/\.{2,}/g, " ").trim())
    .filter(Boolean);
}

export interface ParsedLabel {
  productName: string;
  ingredients: string[];
  /** Lines the heuristics drew from, for the "what we read" disclosure. */
  sourceLines: string[];
}

export function parseLabelText(raw: string): ParsedLabel {
  const lines = raw
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 1);

  const collected: string[] = [];
  const sourceLines: string[] = [];

  // Pass 1: lines inside an explicit ingredient block.
  let inBlock = false;
  for (const line of lines) {
    if (INGREDIENT_HEADINGS.test(line)) {
      inBlock = true;
      // A heading often carries the ingredients on the same line.
      const tail = line.replace(INGREDIENT_HEADINGS, " ").trim();
      if (tail.length > 3) {
        sourceLines.push(line);
        collected.push(...splitFragments(tail));
      }
      continue;
    }
    if (inBlock && STOP_HEADINGS.test(line)) {
      inBlock = false;
      continue;
    }
    if (inBlock) {
      sourceLines.push(line);
      collected.push(...splitFragments(line));
    }
  }

  // Pass 2: a comma-separated run of capitalised words is how most OTC boxes
  // print actives on the front, with no heading at all.
  if (collected.length === 0) {
    for (const line of lines) {
      if (STOP_HEADINGS.test(line)) continue;
      const parts = splitFragments(line);
      const named = parts.filter(
        (p) => /^[A-Z]/.test(p) && looksLikeIngredient(p),
      );
      if (named.length >= 2 || (named.length === 1 && /,/.test(line))) {
        sourceLines.push(line);
        collected.push(...named);
      }
    }
  }

  const seen = new Set<string>();
  const ingredients: string[] = [];
  for (const candidate of collected) {
    if (!looksLikeIngredient(candidate)) continue;
    const key = candidate.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    ingredients.push(candidate);
  }

  return {
    productName: guessProductName(lines),
    ingredients,
    sourceLines: [...new Set(sourceLines)],
  };
}

/**
 * The brand is usually the largest text, which OCR renders as an early line
 * of mostly capitals. Confidence is low, so this is only a default the
 * athlete can overwrite.
 */
function guessProductName(lines: string[]): string {
  const head = lines.slice(0, 8);
  let best = "";
  let bestScore = -1;
  for (const line of head) {
    if (STOP_HEADINGS.test(line) || INGREDIENT_HEADINGS.test(line)) continue;
    const letters = line.replace(/[^\p{L}]/gu, "");
    if (letters.length < 4) continue;
    const upper = (line.match(/\p{Lu}/gu) ?? []).length;
    const ratio = upper / letters.length;
    // Favour long, mostly-uppercase lines; penalise obvious code lines.
    const score = ratio * 2 + Math.min(letters.length, 24) / 24 -
      (/\d{3,}/.test(line) ? 1.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best.trim();
}
