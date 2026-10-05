/**
 * Deterministic assertion harness for the rules engine.
 *
 * Run with `npm run verify:demo`. Asserts the five demo presets resolve to
 * their documented tiers, and that the 48-hour in-competition escalation
 * behaves correctly around its boundary.
 */

import { DEMO_PRESETS } from "../lib/demo-presets";
import { evaluateLabel } from "../lib/rules-engine";
import { DEFAULT_PROFILE } from "../lib/storage";
import type { AthleteProfile, SafetyStatus } from "../types";

const NOW = new Date("2026-10-05T12:00:00");

function profile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return { ...DEFAULT_PROFILE, sport: "Athletics", ...overrides };
}

/** yyyy-mm-dd `hours` from NOW. */
function dateIn(hours: number): string {
  const d = new Date(NOW.getTime() + hours * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let failures = 0;

function check(name: string, actual: SafetyStatus, expected: SafetyStatus) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(
    `${pass ? "  PASS" : "  FAIL"}  ${name.padEnd(52)} ${actual}${pass ? "" : `  (expected ${expected})`}`,
  );
}

console.log("\nDemo presets (no competition date set)");
for (const preset of DEMO_PRESETS) {
  const result = evaluateLabel(preset.extracted, profile(), preset.context, NOW);
  check(preset.label, result.status, preset.expectedStatus);
}

console.log("\nContextual escalation — Sudafed (pseudoephedrine, S6 in-competition)");
const sudafed = DEMO_PRESETS.find((p) => p.id === "sudafed")!;
const escalation: Array<[string, string | null, SafetyStatus]> = [
  ["no competition date", null, "CONDITIONAL"],
  ["event in 10 days", dateIn(240), "CONDITIONAL"],
  ["event in 72h (outside window)", dateIn(72), "CONDITIONAL"],
  ["event in 24h (inside window)", dateIn(24), "PROHIBITED"],
  ["event today (in competition)", dateIn(0), "PROHIBITED"],
];
for (const [label, date, expected] of escalation) {
  const result = evaluateLabel(
    sudafed.extracted,
    profile({ nextCompetitionDate: date }),
    sudafed.context,
    NOW,
  );
  check(label, result.status, expected);
}

console.log("\nStanozolol is unaffected by timing (prohibited at all times)");
const stanozolol = DEMO_PRESETS.find((p) => p.id === "stanozolol")!;
for (const [label, date] of [
  ["no competition date", null],
  ["event in 6 months", dateIn(24 * 180)],
] as Array<[string, string | null]>) {
  const result = evaluateLabel(
    stanozolol.extracted,
    profile({ nextCompetitionDate: date }),
    stanozolol.context,
    NOW,
  );
  check(label, result.status, "PROHIBITED");
}

console.log("\nRoute sensitivity — glucocorticoid (S9) inside the window");
const pred = { productName: "Prednisolone 5mg", ingredients: ["Prednisolone 5 mg"] };
for (const [label, route, expected] of [
  ["oral, event in 24h", "ORAL", "PROHIBITED"],
  ["topical cream, event in 24h", "TOPICAL", "NOT_PROHIBITED"],
  ["oral, no event scheduled", "ORAL", "CONDITIONAL"],
] as Array<[string, "ORAL" | "TOPICAL", SafetyStatus]>) {
  const result = evaluateLabel(
    pred,
    profile({
      nextCompetitionDate: label.includes("no event") ? null : dateIn(24),
    }),
    { route },
    NOW,
  );
  check(label, result.status, expected);
}

console.log("\nSport sensitivity — beta-blockers (P1, particular sports)");
const propranolol = { productName: "Propranolol 40mg", ingredients: ["Propranolol 40 mg"] };
for (const [label, sport, expected] of [
  ["archer, event in 24h", "Archery", "PROHIBITED"],
  ["marathon runner, event in 24h", "Athletics", "NOT_PROHIBITED"],
] as Array<[string, string, SafetyStatus]>) {
  const result = evaluateLabel(
    propranolol,
    profile({ sport, nextCompetitionDate: dateIn(24) }),
    { route: "ORAL" },
    NOW,
  );
  check(label, result.status, expected);
}

console.log("\nDeterminism — same input evaluated twice");
const a = evaluateLabel(sudafed.extracted, profile(), sudafed.context, NOW);
const b = evaluateLabel(sudafed.extracted, profile(), sudafed.context, NOW);
const identical = JSON.stringify(a) === JSON.stringify(b);
if (!identical) failures += 1;
console.log(`${identical ? "  PASS" : "  FAIL"}  byte-identical output`);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
