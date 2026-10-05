/**
 * Coverage of the official WADA Prohibited List.
 *
 * These substances were all UNVERIFIED before the 2026 List was imported.
 * They are pinned here because an anti-doping tool that silently loses
 * coverage of an anabolic agent is worse than one that never had it.
 */
import { evaluateLabel } from "../lib/rules-engine";
import { DEFAULT_PROFILE } from "../lib/storage";
import { LISTED } from "../lib/substance-match";
import type { SafetyStatus } from "../types";

const base = { ...DEFAULT_PROFILE, sport: "Athletics", nado: "KADA" };
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

const CASES: Array<[string, string | null, SafetyStatus]> = [
  // S1 anabolic agents — the largest previous gap.
  ["Oxandrolone", null, "PROHIBITED"],
  ["Metandienone", null, "PROHIBITED"],
  ["Methandienone", null, "PROHIBITED"], // alternate spelling
  ["Trenbolone", null, "PROHIBITED"],
  ["Boldenone", null, "PROHIBITED"],
  ["Oxymetholone", null, "PROHIBITED"],
  ["Drostanolone", null, "PROHIBITED"],
  ["Andarine", null, "PROHIBITED"],
  ["YK-11", null, "PROHIBITED"],
  ["Ostarine", null, "PROHIBITED"],
  ["Ligandrol", null, "PROHIBITED"],
  ["Clenbuterol", null, "PROHIBITED"],
  // S2 / S4 metabolic and hormone modulators.
  ["Roxadustat", null, "PROHIBITED"],
  ["Cobalt", null, "PROHIBITED"],
  ["Xenon", null, "PROHIBITED"],
  ["Meldonium", null, "PROHIBITED"],
  ["Trimetazidine", null, "PROHIBITED"],
  ["Clomiphene", null, "PROHIBITED"],
  // S3 beta-2 agonists.
  ["Terbutaline", null, "PROHIBITED"],
  ["Salmeterol", null, "PROHIBITED"],
  ["Vilanterol", null, "PROHIBITED"],
  // S5 diuretics.
  ["Metolazone", null, "PROHIBITED"],
  ["Canrenone", null, "PROHIBITED"],
  ["Frusemide", null, "PROHIBITED"],
  // In-competition classes still depend on timing.
  ["Methylphenidate", null, "CONDITIONAL"],
  ["Methylphenidate", tomorrow, "PROHIBITED"],
  ["Amphetamine", tomorrow, "PROHIBITED"],
  // Permitted substances must stay permitted — exceptions were the main
  // extraction hazard, since reading one as prohibited bins a legal medicine.
  ["Ibuprofen 200 mg", tomorrow, "NOT_PROHIBITED"],
  ["Paracetamol 500 mg", tomorrow, "NOT_PROHIBITED"],
  ["Cannabidiol", tomorrow, "NOT_PROHIBITED"],
  ["Phenylephrine HCl", tomorrow, "NOT_PROHIBITED"],
  ["Diphenhydramine HCl", tomorrow, "NOT_PROHIBITED"],
];

let failures = 0;
console.log(`Reference data: ${LISTED.listEdition}`);
const total = Object.values(LISTED.classes).reduce(
  (n, g) => n + g.substances.length,
  0,
);
console.log(`Indexed substances: ${total}\n`);

for (const [ingredient, date, expected] of CASES) {
  const r = evaluateLabel(
    { productName: ingredient, ingredients: [ingredient] },
    { ...base, nextCompetitionDate: date },
    { route: "ORAL" },
  );
  const ok = r.status === expected;
  if (!ok) failures += 1;
  const when = date ? "in-comp " : "out-comp";
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${when}  ${ingredient.padEnd(22)} ${r.status}${ok ? "" : `  expected ${expected}`}`,
  );
}

// Every exception listed in the official PDF must evaluate as permitted.
console.log("\nOfficial EXCEPTIONS must never read as prohibited:");
for (const [cls, group] of Object.entries(LISTED.classes)) {
  for (const exc of group.exceptions) {
    // Exceptions are route-specific: "Inhaled salbutamol" is permitted, oral
    // salbutamol is not, so the route has to match the exception's own wording.
    const route = /^inhaled/i.test(exc) ? "INHALED" : "ORAL";
    const r = evaluateLabel(
      { productName: exc, ingredients: [exc] },
      base,
      { route },
    );
    const ok = r.status !== "PROHIBITED";
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${cls}  ${exc.padEnd(26)} ${route.padEnd(8)} ${r.status}`,
    );
  }
}

console.log(
  failures === 0
    ? "\nAll coverage checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
