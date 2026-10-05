/**
 * BESAFE by AIMS — shared type contracts.
 *
 * Architectural note: the Vision LLM is only ever allowed to produce an
 * `ExtractedLabel`. Every status decision below it is computed by
 * `lib/rules-engine.ts` from `data/wada-rules.json`.
 */

/* ------------------------------------------------------------------ *
 * Status tiers
 * ------------------------------------------------------------------ */

/** The 5 definitive status tiers. No other value may reach the UI. */
export type SafetyStatus =
  | "NOT_PROHIBITED"
  | "CONDITIONAL"
  | "PROHIBITED"
  | "SUPPLEMENT_RISK"
  | "UNVERIFIED";

export interface StatusTierMeta {
  status: SafetyStatus;
  label: string;
  emoji: string;
  /** One-line meaning, shown under the badge. */
  summary: string;
  /** Tailwind token names declared in tailwind.config.ts. */
  color: string;
  softColor: string;
  /** Sort weight used when reducing many ingredient findings to one verdict. */
  severity: number;
}

/**
 * Ordered least-to-most actionable. `severity` drives the reducer in the rules
 * engine: the overall verdict is the finding with the highest severity.
 *
 * SUPPLEMENT_RISK sits above CONDITIONAL but below PROHIBITED: an athlete can
 * choose not to take a contaminated-risk supplement, but a confirmed banned
 * substance is the more serious finding and must win the headline.
 */
export const STATUS_TIERS: Record<SafetyStatus, StatusTierMeta> = {
  NOT_PROHIBITED: {
    status: "NOT_PROHIBITED",
    label: "Not Prohibited",
    emoji: "🟢",
    summary: "No WADA restriction identified for the declared ingredients.",
    color: "tier-clear",
    softColor: "tier-clear-soft",
    severity: 0,
  },
  UNVERIFIED: {
    status: "UNVERIFIED",
    label: "Unverified",
    emoji: "⚪",
    summary: "Insufficient information. Refer to your NADO before use.",
    color: "tier-unverified",
    softColor: "tier-unverified-soft",
    severity: 1,
  },
  CONDITIONAL: {
    status: "CONDITIONAL",
    label: "Conditional",
    emoji: "🟡",
    summary: "Permitted only under specific dose, route, or timing conditions.",
    color: "tier-conditional",
    softColor: "tier-conditional-soft",
    severity: 2,
  },
  SUPPLEMENT_RISK: {
    status: "SUPPLEMENT_RISK",
    label: "Supplement Risk",
    emoji: "🟠",
    summary:
      "Dietary supplement with inherent contamination risk, even if the label looks clear.",
    color: "tier-risk",
    softColor: "tier-risk-soft",
    severity: 3,
  },
  PROHIBITED: {
    status: "PROHIBITED",
    label: "Prohibited",
    emoji: "🔴",
    summary: "Banned under the applicable WADA Prohibited List provisions.",
    color: "tier-prohibited",
    softColor: "tier-prohibited-soft",
    severity: 4,
  },
};

/* ------------------------------------------------------------------ *
 * WADA reference data (shape of data/wada-rules.json)
 * ------------------------------------------------------------------ */

/** WADA Prohibited List section identifiers. */
export type WadaClass =
  | "S0"
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "P1"
  | "M1"
  | "M2"
  | "M3"
  | "MONITORING"
  | "NONE";

/** When the prohibition applies. */
export type ProhibitionScope =
  | "AT_ALL_TIMES"
  | "IN_COMPETITION"
  | "PARTICULAR_SPORTS"
  | "MONITORED"
  | "NOT_PROHIBITED";

export type AdministrationRoute =
  | "ORAL"
  | "INHALED"
  | "INTRANASAL"
  | "TOPICAL"
  | "OPHTHALMIC"
  | "OTIC"
  | "RECTAL"
  | "INJECTION"
  | "UNKNOWN";

export type DosePeriod = "PER_DOSE" | "PER_24H" | "URINE_CONCENTRATION";

export interface DoseThreshold {
  amount: number;
  unit: string;
  period: DosePeriod;
  /** Human-readable note shown verbatim in the result card. */
  note: string;
}

/**
 * One curated substance entry.
 *
 * `baseStatus` is the verdict out-of-competition / before any contextual
 * escalation. The engine may raise it (never silently lower it) using the
 * athlete's competition window, sport, route, and dose.
 */
export interface WadaSubstanceRule {
  id: string;
  /** Canonical WADA substance name. */
  substance: string;
  /** Brand names, INN variants, and common label spellings, all lowercase. */
  aliases: string[];
  wadaClass: WadaClass;
  classLabel: string;
  scope: ProhibitionScope;
  baseStatus: SafetyStatus;
  /** Status to apply when the athlete is inside the in-competition window. */
  inCompetitionStatus?: SafetyStatus;
  /** Only meaningful when scope is PARTICULAR_SPORTS. Lowercase sport names. */
  sports?: string[];
  /** Routes that remain permitted (e.g. topical glucocorticoids). */
  permittedRoutes?: AdministrationRoute[];
  /** Routes that are explicitly prohibited. */
  prohibitedRoutes?: AdministrationRoute[];
  doseThreshold?: DoseThreshold;
  /** Recommended clearance period before competition, in hours. */
  washoutHours?: number;
  /** Whether a Therapeutic Use Exemption is the normal route to legal use. */
  tueRequired: boolean;
  /** Why this entry resolves the way it does — surfaced to the athlete. */
  rationale: string;
  /** Citation into the WADA List or a TUE guideline. */
  reference: string;
}

/** Keyword heuristics that flag inherent dietary-supplement risk. */
export interface SupplementRiskIndicators {
  /** Matched against the product name. */
  productNameKeywords: string[];
  /** Matched against ingredient strings. */
  ingredientKeywords: string[];
  /** Opaque labelling that hides the real formulation. */
  opaqueLabelKeywords: string[];
  rationale: string;
  reference: string;
}

/** Signals that a product cannot be assessed at all. */
export interface UnverifiedIndicators {
  /** Ingredient/product tokens that mean "we do not know what this is". */
  keywords: string[];
  rationale: string;
  reference: string;
}

export interface WadaRulesDatabase {
  /** Edition of the Prohibited List this data was curated from. */
  version: string;
  listEdition: string;
  lastReviewed: string;
  source: string;
  disclaimer: string;
  /** Hours before a competition at which in-competition rules begin to apply. */
  inCompetitionWindowHours: number;
  /** Ingredients that are explicitly permitted and should short-circuit. */
  permittedSubstances: string[];
  substances: WadaSubstanceRule[];
  supplementRiskIndicators: SupplementRiskIndicators;
  unverifiedIndicators: UnverifiedIndicators;
}

/* ------------------------------------------------------------------ *
 * Athlete context
 * ------------------------------------------------------------------ */

export interface AthleteProfile {
  /** Display name only; never leaves the device. */
  name: string;
  sport: string;
  discipline: string;
  /**
   * Competition level (e.g. International, National, Club). Recorded for the
   * athlete's own context and for NADO referrals; the rules engine does not
   * read it, because the Prohibited List does not vary by level.
   */
  level: string;
  /** ISO-8601 date string (yyyy-mm-dd) or null when no event is scheduled. */
  nextCompetitionDate: string | null;
  /** National Anti-Doping Organisation, used for the referral message. */
  nado: string;
  /** Athlete states they hold an approved TUE for a declared substance. */
  hasApprovedTue: boolean;
  updatedAt: string;
}

/** Derived, never stored: recomputed on every evaluation. */
export interface CompetitionContext {
  nextCompetitionDate: string | null;
  hoursUntilCompetition: number | null;
  /** True when the event is inside `inCompetitionWindowHours`. */
  inCompetitionWindow: boolean;
  windowHours: number;
}

/* ------------------------------------------------------------------ *
 * Scan pipeline
 * ------------------------------------------------------------------ */

/** The ONLY thing the Vision LLM is permitted to return. */
export interface ExtractedLabel {
  productName: string;
  ingredients: string[];
}

export type ExtractionSource =
  | "vision-llm"
  /** Read on the athlete's own device, then confirmed by them. */
  | "local-ocr"
  | "mock-preset"
  | "manual-entry";

/** Optional per-scan details the athlete can supply to sharpen the verdict. */
export interface ScanContext {
  route?: AdministrationRoute;
  /** Free-text dose as printed on the label, e.g. "60 mg". */
  dose?: string;
  /** Athlete marked this product as a dietary supplement. */
  isDietarySupplement?: boolean;
}

/** Result of evaluating a single extracted ingredient. */
export interface IngredientFinding {
  /** Ingredient exactly as extracted from the label. */
  ingredient: string;
  status: SafetyStatus;
  /** Canonical substance name, when a rule matched. */
  matchedSubstance: string | null;
  ruleId: string | null;
  wadaClass: WadaClass;
  classLabel: string;
  scope: ProhibitionScope;
  /** Ordered, human-readable reasons behind this finding. */
  reasons: string[];
  tueRequired: boolean;
  washoutHours: number | null;
  reference: string | null;
  /** True when the in-competition window raised this finding's status. */
  escalatedByCompetitionWindow: boolean;
}

export interface SafetyEvaluation {
  status: SafetyStatus;
  /** Short verdict line, e.g. "Prohibited at all times". */
  headline: string;
  /** Two or three sentences the athlete can act on. */
  summary: string;
  findings: IngredientFinding[];
  /** Concrete next steps, most important first. */
  recommendedActions: string[];
  requiresExpertReview: boolean;
  competition: CompetitionContext;
  rulesVersion: string;
  evaluatedAt: string;
}

/** API payload returned by POST /api/scan. */
export interface ScanResponse {
  extracted: ExtractedLabel;
  extractionSource: ExtractionSource;
  evaluation: SafetyEvaluation;
  /** Set when the Vision LLM was unavailable and a fallback was used. */
  warning?: string;
}

/* ------------------------------------------------------------------ *
 * Athlete Passport
 * ------------------------------------------------------------------ */

export interface PassportEntry {
  id: string;
  createdAt: string;
  productName: string;
  ingredients: string[];
  status: SafetyStatus;
  headline: string;
  extractionSource: ExtractionSource;
  evaluation: SafetyEvaluation;
  /** Snapshot of the context the verdict was computed under. */
  athleteContext: {
    sport: string;
    discipline: string;
    nextCompetitionDate: string | null;
    inCompetitionWindow: boolean;
  };
  /** Athlete's own note, e.g. "prescribed by team doctor". */
  note?: string;
}

/* ------------------------------------------------------------------ *
 * Demo presets
 * ------------------------------------------------------------------ */

export interface DemoPreset {
  id: string;
  label: string;
  /** Short description of what this preset demonstrates. */
  caption: string;
  /** The tier a stakeholder should expect to see. */
  expectedStatus: SafetyStatus;
  /** Deterministic stand-in for the Vision LLM output. */
  extracted: ExtractedLabel;
  context?: ScanContext;
}
