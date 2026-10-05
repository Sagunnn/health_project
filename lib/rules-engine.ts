/**
 * BESAFE by AIMS — deterministic anti-doping rules engine.
 *
 * ARCHITECTURAL LAW: no AI, no network, no randomness in this file. Given the
 * same label, profile, and clock it must always return the same verdict. The
 * Vision LLM's only contribution is the `ExtractedLabel` passed in.
 */

import rulesData from "@/data/wada-rules.json";
import type {
  AdministrationRoute,
  AthleteProfile,
  CompetitionContext,
  ExtractedLabel,
  IngredientFinding,
  SafetyEvaluation,
  SafetyStatus,
  ScanContext,
  WadaRulesDatabase,
  WadaSubstanceRule,
} from "@/types";
import { STATUS_TIERS } from "@/types";

const DB = rulesData as WadaRulesDatabase;

export const rulesVersion = DB.version;
export const listEdition = DB.listEdition;
export const inCompetitionWindowHours = DB.inCompetitionWindowHours;

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/**
 * Collapse a label string to a comparable form: lowercase, punctuation to
 * spaces, single-spaced. Keeps digits because some substance names need them
 * (LGD-4033, GW501516).
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, "-") // unicode dashes -> hyphen
    .replace(/[^a-z0-9+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip trailing dose/strength noise so "ibuprofen 200 mg" matches "ibuprofen". */
function stripDose(value: string): string {
  return value
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|%|mg\/ml|ng\/ml)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `needle` occurs in `haystack` on word boundaries. */
function containsTerm(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const index = haystack.indexOf(needle);
  if (index === -1) return false;

  const before = index === 0 ? " " : haystack[index - 1];
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? " " : haystack[afterIndex];
  const isBoundary = (char: string) => !/[a-z0-9]/.test(char);

  return isBoundary(before) && isBoundary(after);
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

interface RuleMatch {
  rule: WadaSubstanceRule;
  /** The alias that matched, for explaining the decision. */
  alias: string;
}

/**
 * Find the substance rule for one ingredient.
 *
 * Longest alias wins: "methylprednisolone" must not be captured by a shorter
 * overlapping alias, and "pseudoephedrine hydrochloride" should prefer the
 * most specific entry available.
 */
function matchSubstance(ingredient: string): RuleMatch | null {
  const haystack = stripDose(normalize(ingredient));
  if (!haystack) return null;

  let best: RuleMatch | null = null;

  for (const rule of DB.substances) {
    for (const alias of rule.aliases) {
      const needle = normalize(alias);
      if (!containsTerm(haystack, needle)) continue;
      if (!best || needle.length > normalize(best.alias).length) {
        best = { rule, alias };
      }
    }
  }

  return best;
}

/** True when the ingredient is on the explicit permitted allow-list. */
function matchPermitted(ingredient: string): string | null {
  const haystack = stripDose(normalize(ingredient));
  if (!haystack) return null;

  let best: string | null = null;
  for (const permitted of DB.permittedSubstances) {
    const needle = normalize(permitted);
    if (!containsTerm(haystack, needle)) continue;
    if (!best || needle.length > best.length) best = needle;
  }
  return best;
}

function matchKeyword(haystack: string, keywords: string[]): string | null {
  const text = normalize(haystack);
  let best: string | null = null;
  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (!needle || !text.includes(needle)) continue;
    if (!best || needle.length > best.length) best = keyword;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Competition context
 * ------------------------------------------------------------------ */

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Derive the in-competition window from the athlete's next event.
 *
 * The event date is stored as a plain `yyyy-mm-dd`, which we treat as starting
 * at 00:00 local time — the earliest moment competition could begin that day,
 * and therefore the safe reading.
 */
export function buildCompetitionContext(
  nextCompetitionDate: string | null,
  now: Date = new Date(),
): CompetitionContext {
  const windowHours = DB.inCompetitionWindowHours;

  if (!nextCompetitionDate) {
    return {
      nextCompetitionDate: null,
      hoursUntilCompetition: null,
      inCompetitionWindow: false,
      windowHours,
    };
  }

  const [year, month, day] = nextCompetitionDate.split("-").map(Number);
  const start = new Date(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);

  if (Number.isNaN(start.getTime())) {
    return {
      nextCompetitionDate,
      hoursUntilCompetition: null,
      inCompetitionWindow: false,
      windowHours,
    };
  }

  const hoursUntilCompetition = (start.getTime() - now.getTime()) / MS_PER_HOUR;

  // A competition day that has already begun still counts as in-competition
  // until it ends, so negative values within 24h of the start remain inside.
  const inCompetitionWindow =
    hoursUntilCompetition <= windowHours && hoursUntilCompetition > -24;

  return {
    nextCompetitionDate,
    hoursUntilCompetition: Math.round(hoursUntilCompetition * 10) / 10,
    inCompetitionWindow,
    windowHours,
  };
}

/* ------------------------------------------------------------------ *
 * Per-ingredient evaluation
 * ------------------------------------------------------------------ */

function routeIsPermitted(
  rule: WadaSubstanceRule,
  route: AdministrationRoute | undefined,
): boolean {
  if (!route || route === "UNKNOWN" || !rule.permittedRoutes) return false;
  return rule.permittedRoutes.includes(route);
}

function routeIsProhibited(
  rule: WadaSubstanceRule,
  route: AdministrationRoute | undefined,
): boolean {
  if (!route || route === "UNKNOWN" || !rule.prohibitedRoutes) return false;
  return rule.prohibitedRoutes.includes(route);
}

function sportIsAffected(
  rule: WadaSubstanceRule,
  profile: AthleteProfile,
): boolean {
  if (!rule.sports?.length) return false;
  const haystack = normalize(`${profile.sport} ${profile.discipline}`);
  return rule.sports.some((sport) => haystack.includes(normalize(sport)));
}

function evaluateMatchedIngredient(
  ingredient: string,
  match: RuleMatch,
  profile: AthleteProfile,
  competition: CompetitionContext,
  context: ScanContext,
): IngredientFinding {
  const { rule, alias } = match;
  const reasons: string[] = [rule.rationale];
  let status: SafetyStatus = rule.baseStatus;
  let escalated = false;

  // Record how we got here when the match was not the canonical name.
  if (normalize(alias) !== normalize(rule.substance)) {
    reasons.push(
      `Matched "${alias}" to ${rule.substance} (${rule.classLabel}).`,
    );
  }

  const route = context.route;

  if (routeIsPermitted(rule, route)) {
    // Route-permitted forms stay conditional when a dose ceiling applies,
    // otherwise they are genuinely not prohibited.
    if (rule.doseThreshold) {
      status = "CONDITIONAL";
      reasons.push(
        `The ${route?.toLowerCase()} route is permitted, but a dose limit applies. ${rule.doseThreshold.note}`,
      );
    } else {
      status = "NOT_PROHIBITED";
      reasons.push(
        `The ${route?.toLowerCase()} route is not prohibited for this substance.`,
      );
    }
  } else {
    if (routeIsProhibited(rule, route)) {
      reasons.push(
        `The ${route?.toLowerCase()} route is explicitly prohibited for this substance.`,
      );
    }

    switch (rule.scope) {
      case "AT_ALL_TIMES":
        status = rule.baseStatus;
        reasons.push(
          "Prohibited both in and out of competition, so competition timing does not change this result.",
        );
        break;

      case "IN_COMPETITION":
        if (competition.inCompetitionWindow) {
          status = rule.inCompetitionStatus ?? "PROHIBITED";
          escalated = status !== rule.baseStatus;
          reasons.push(
            `Your next competition is within ${competition.windowHours} hours, so in-competition rules apply.`,
          );
        } else {
          status = rule.baseStatus;
          reasons.push(
            competition.nextCompetitionDate
              ? `Your next competition is more than ${competition.windowHours} hours away, so out-of-competition rules apply for now.`
              : "No competition date is set, so this is assessed out-of-competition. Add your event date for a timing-aware result.",
          );
        }
        break;

      case "PARTICULAR_SPORTS":
        if (sportIsAffected(rule, profile)) {
          if (competition.inCompetitionWindow) {
            status = rule.inCompetitionStatus ?? "PROHIBITED";
            escalated = status !== rule.baseStatus;
            reasons.push(
              `Prohibited in ${profile.sport}, and your competition is within ${competition.windowHours} hours.`,
            );
          } else {
            status = rule.baseStatus;
            reasons.push(
              `Prohibited in-competition in ${profile.sport}. Your event is not yet inside the ${competition.windowHours}-hour window.`,
            );
          }
        } else {
          status = "NOT_PROHIBITED";
          reasons.push(
            profile.sport
              ? `Not prohibited in ${profile.sport}. This class is restricted only in specific sports.`
              : "Restricted only in specific sports. Set your sport in your profile to confirm.",
          );
        }
        break;

      case "MONITORED":
      case "NOT_PROHIBITED":
        status = "NOT_PROHIBITED";
        break;
    }
  }

  if (rule.doseThreshold && status !== "NOT_PROHIBITED") {
    const note = rule.doseThreshold.note;
    if (!reasons.some((reason) => reason.includes(note))) reasons.push(note);
  }

  if (rule.washoutHours && status === "PROHIBITED") {
    reasons.push(
      `Recommended clearance before competition: ${formatHours(rule.washoutHours)}.`,
    );
  }

  // Strict liability: an athlete-declared TUE is never allowed to downgrade a
  // verdict here. It is surfaced as context for the athlete to verify.
  if (profile.hasApprovedTue && rule.tueRequired && status === "PROHIBITED") {
    reasons.push(
      "You have indicated you hold an approved TUE. Confirm it covers this exact substance, dose, and route before use.",
    );
  }

  return {
    ingredient,
    status,
    matchedSubstance: rule.substance,
    ruleId: rule.id,
    wadaClass: rule.wadaClass,
    classLabel: rule.classLabel,
    scope: rule.scope,
    reasons,
    tueRequired: rule.tueRequired,
    washoutHours: rule.washoutHours ?? null,
    reference: rule.reference,
    escalatedByCompetitionWindow: escalated,
  };
}

function formatHours(hours: number): string {
  if (hours < 48) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return days >= 30 ? `${Math.round(days / 30)} month(s)` : `${days} days`;
}

/* ------------------------------------------------------------------ *
 * Whole-product evaluation
 * ------------------------------------------------------------------ */

function isUnreadable(extracted: ExtractedLabel): boolean {
  const ingredients = extracted.ingredients.filter((i) => i.trim().length > 0);
  return ingredients.length === 0;
}

function buildSupplementRiskFinding(
  extracted: ExtractedLabel,
  context: ScanContext,
): IngredientFinding | null {
  const indicators = DB.supplementRiskIndicators;
  const ingredientText = extracted.ingredients.join(" ; ");

  const nameHit = matchKeyword(
    extracted.productName,
    indicators.productNameKeywords,
  );
  const ingredientHit = matchKeyword(
    ingredientText,
    indicators.ingredientKeywords,
  );
  const opaqueHit = matchKeyword(
    `${extracted.productName} ; ${ingredientText}`,
    indicators.opaqueLabelKeywords,
  );

  if (!nameHit && !ingredientHit && !opaqueHit && !context.isDietarySupplement) {
    return null;
  }

  const reasons: string[] = [indicators.rationale];
  if (nameHit) {
    reasons.push(`Product category signal: "${nameHit}".`);
  }
  if (ingredientHit) {
    reasons.push(
      `Ingredient commonly associated with contaminated products: "${ingredientHit}".`,
    );
  }
  if (opaqueHit) {
    reasons.push(
      `The label hides its composition behind "${opaqueHit}", so the full formulation cannot be verified.`,
    );
  }
  if (context.isDietarySupplement && !nameHit && !ingredientHit && !opaqueHit) {
    reasons.push("You marked this product as a dietary supplement.");
  }

  return {
    ingredient: extracted.productName || "Dietary supplement",
    status: "SUPPLEMENT_RISK",
    matchedSubstance: null,
    ruleId: "supplement-risk",
    wadaClass: "NONE",
    classLabel: "Dietary supplement contamination risk",
    scope: "NOT_PROHIBITED",
    reasons,
    tueRequired: false,
    washoutHours: null,
    reference: indicators.reference,
    escalatedByCompetitionWindow: false,
  };
}

function buildUnverifiedFinding(
  ingredient: string,
  keyword: string | null,
): IngredientFinding {
  const indicators = DB.unverifiedIndicators;
  const reasons = [indicators.rationale];
  if (keyword) {
    reasons.push(`Unassessable label text: "${keyword}".`);
  } else {
    reasons.push(
      `"${ingredient}" is not in the BESAFE reference database. It may be a brand name, an excipient, or a substance requiring expert review.`,
    );
  }

  return {
    ingredient,
    status: "UNVERIFIED",
    matchedSubstance: null,
    ruleId: null,
    wadaClass: "NONE",
    classLabel: "Not assessable from the label",
    scope: "NOT_PROHIBITED",
    reasons,
    tueRequired: false,
    washoutHours: null,
    reference: indicators.reference,
    escalatedByCompetitionWindow: false,
  };
}

/** Reduce many findings to the single most actionable status. */
function reduceStatus(findings: IngredientFinding[]): SafetyStatus {
  if (findings.length === 0) return "UNVERIFIED";
  return findings.reduce<SafetyStatus>((worst, finding) => {
    return STATUS_TIERS[finding.status].severity > STATUS_TIERS[worst].severity
      ? finding.status
      : worst;
  }, "NOT_PROHIBITED");
}

function buildHeadline(
  status: SafetyStatus,
  findings: IngredientFinding[],
  competition: CompetitionContext,
): string {
  const driver = findings.find((f) => f.status === status);

  switch (status) {
    case "PROHIBITED":
      if (driver?.escalatedByCompetitionWindow) {
        return `Prohibited in-competition — your event is within ${competition.windowHours} hours`;
      }
      return driver?.scope === "AT_ALL_TIMES"
        ? "Prohibited at all times"
        : "Prohibited under the applicable rules";
    case "SUPPLEMENT_RISK":
      return "Declared ingredients look clear, but this is a high-risk supplement";
    case "CONDITIONAL":
      return "Permitted only under specific conditions";
    case "UNVERIFIED":
      return "Cannot be verified from this label";
    case "NOT_PROHIBITED":
      return "No WADA restriction identified";
  }
}

function buildSummary(
  status: SafetyStatus,
  findings: IngredientFinding[],
  competition: CompetitionContext,
): string {
  const driver = findings.find((f) => f.status === status);
  const parts: string[] = [];

  if (driver?.matchedSubstance) {
    parts.push(`${driver.matchedSubstance} drives this result.`);
  }
  parts.push(STATUS_TIERS[status].summary);

  if (competition.inCompetitionWindow) {
    parts.push(
      `You are inside the ${competition.windowHours}-hour in-competition window.`,
    );
  } else if (!competition.nextCompetitionDate) {
    parts.push(
      "Add your next competition date in your profile for a timing-aware result.",
    );
  }

  return parts.join(" ");
}

function buildRecommendedActions(
  status: SafetyStatus,
  findings: IngredientFinding[],
  profile: AthleteProfile,
  competition: CompetitionContext,
): string[] {
  const actions: string[] = [];
  const nado = profile.nado?.trim() || "your National Anti-Doping Organisation";

  switch (status) {
    case "PROHIBITED":
      actions.push("Do not take this product.");
      actions.push(
        `Contact ${nado} or your team physician before using any alternative.`,
      );
      if (findings.some((f) => f.tueRequired)) {
        actions.push(
          "If this is medically necessary, apply for a Therapeutic Use Exemption before competing.",
        );
      }
      break;

    case "SUPPLEMENT_RISK":
      actions.push(
        "Avoid unless the product is certified by a batch-testing programme such as Informed Sport or NSF Certified for Sport.",
      );
      actions.push("Keep the product, batch number, and receipt.");
      actions.push(`Check the specific batch with ${nado} if you intend to use it.`);
      break;

    case "CONDITIONAL":
      actions.push(
        "Confirm the dose and route on the packaging against the limits shown below.",
      );
      if (competition.nextCompetitionDate) {
        actions.push(
          `Re-check this product as your event on ${competition.nextCompetitionDate} approaches — the verdict can change inside the ${competition.windowHours}-hour window.`,
        );
      } else {
        actions.push(
          "Add your competition date so BESAFE can apply in-competition rules.",
        );
      }
      actions.push(`Verify with ${nado} or Global DRO before use.`);
      break;

    case "UNVERIFIED":
      actions.push(`Send the product and its label to ${nado} for review.`);
      actions.push("Do not use it until you have written confirmation.");
      break;

    case "NOT_PROHIBITED":
      actions.push("No anti-doping restriction was identified for this product.");
      actions.push(
        "Re-scan if the formulation changes, and keep this record in your Passport.",
      );
      break;
  }

  return actions;
}

/**
 * Evaluate an extracted label in the athlete's context.
 *
 * `now` is injectable so the competition-window logic is testable.
 */
export function evaluateLabel(
  extracted: ExtractedLabel,
  profile: AthleteProfile,
  context: ScanContext = {},
  now: Date = new Date(),
): SafetyEvaluation {
  const competition = buildCompetitionContext(
    profile.nextCompetitionDate,
    now,
  );
  const findings: IngredientFinding[] = [];

  if (isUnreadable(extracted)) {
    findings.push(
      buildUnverifiedFinding(
        extracted.productName || "Unreadable label",
        "unreadable",
      ),
    );
  } else {
    for (const raw of extracted.ingredients) {
      const ingredient = raw.trim();
      if (!ingredient) continue;

      const unverifiedHit = matchKeyword(
        ingredient,
        DB.unverifiedIndicators.keywords,
      );
      if (unverifiedHit) {
        findings.push(buildUnverifiedFinding(ingredient, unverifiedHit));
        continue;
      }

      const match = matchSubstance(ingredient);
      if (match) {
        findings.push(
          evaluateMatchedIngredient(
            ingredient,
            match,
            profile,
            competition,
            context,
          ),
        );
        continue;
      }

      const permitted = matchPermitted(ingredient);
      if (permitted) {
        findings.push({
          ingredient,
          status: "NOT_PROHIBITED",
          matchedSubstance: null,
          ruleId: "permitted-list",
          wadaClass: "NONE",
          classLabel: "Not on the Prohibited List",
          scope: "NOT_PROHIBITED",
          reasons: [
            `"${ingredient}" is on the BESAFE permitted reference list and carries no WADA restriction.`,
          ],
          tueRequired: false,
          washoutHours: null,
          reference: DB.source,
          escalatedByCompetitionWindow: false,
        });
        continue;
      }

      findings.push(buildUnverifiedFinding(ingredient, null));
    }

    // Product-level supplement risk, evaluated even when every declared
    // ingredient resolved as permitted. This is the whole point of the tier.
    const riskFinding = buildSupplementRiskFinding(extracted, context);
    if (riskFinding) findings.push(riskFinding);
  }

  // A product-name keyword alone can also mean "unassessable".
  const productUnverified = matchKeyword(
    extracted.productName,
    DB.unverifiedIndicators.keywords,
  );
  if (
    productUnverified &&
    !findings.some((f) => f.status === "UNVERIFIED")
  ) {
    findings.push(
      buildUnverifiedFinding(extracted.productName, productUnverified),
    );
  }

  const status = reduceStatus(findings);

  return {
    status,
    headline: buildHeadline(status, findings, competition),
    summary: buildSummary(status, findings, competition),
    findings,
    recommendedActions: buildRecommendedActions(
      status,
      findings,
      profile,
      competition,
    ),
    requiresExpertReview:
      status === "UNVERIFIED" ||
      status === "PROHIBITED" ||
      status === "SUPPLEMENT_RISK",
    competition,
    rulesVersion: DB.version,
    evaluatedAt: now.toISOString(),
  };
}
