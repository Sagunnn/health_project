/**
 * Parser checks against verbatim Tesseract output from real packaging.
 * Each case is a label that previously parsed wrongly.
 */
import { assessRead, parseLabelText } from "../lib/label-text";
import { evaluateLabel } from "../lib/rules-engine";
import { DEFAULT_PROFILE } from "../lib/storage";
import type { SafetyStatus } from "../types";

const profile = { ...DEFAULT_PROFILE, sport: "Athletics", nado: "KADA" };

const CASES: Array<[string, string, SafetyStatus]> = [
  // Generic prescription pack: the molecule is only in the title line.
  ["Frusemide 40mg (title line only)", `Bi Hest i
BR
Frusemide Tablets |.P. 40 mg
yy`, "PROHIBITED"],

  // Brand pack: the molecule is only in parentheses.
  ["Lamadol (Tramadol HCl, parentheses)", `it 5x2mi Ampoules
v | L Injection IMIV
i I
2: (Tramadol HCI)
<: p-
JF gh
5 oe > A 4 "For Moderate 10
i y gevere Pain
a rOOKES J`, "CONDITIONAL"],

  // Previously-working cases must not regress.
  ["Sudafed PE (inline comma list)", `Acetaminophen, Guaifenesin, Phenylephrine HCI, REC
Pain Reliever/Fever Reducer, Expectorant, Nasal Decongestant
24 TABLETS`, "NOT_PROHIBITED"],

  ["Decongestant (explicit ingredient block)", `NASALCLEAR
ACTIVE INGREDIENT (IN EACH TABLET)
Pseudoephedrine Hydrochloride ....... 60 mg
PURPOSE
Nasal decongestant
INACTIVE INGREDIENTS
Croscarmellose Sodium, Magnesium Stearate
Keep out of reach of children.`, "CONDITIONAL"],
];

let failures = 0;
for (const [label, text, expected] of CASES) {
  const parsed = parseLabelText(text);
  const r = evaluateLabel(
    { productName: parsed.productName, ingredients: parsed.ingredients },
    profile,
    { route: "ORAL" },
  );
  const ok = r.status === expected;
  if (!ok) failures += 1;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`   derivedFrom : ${parsed.derivedFrom}`);
  console.log(`   ingredients : ${JSON.stringify(parsed.ingredients)}`);
  console.log(`   status      : ${r.status}${ok ? "" : `  (expected ${expected})`}`);
}

console.log("\n--- escalation policy (which reads get sent to a model) ---");
for (const [label, text] of CASES.map((c) => [c[0], c[1]] as const)) {
  const parsed = parseLabelText(text);
  // Confidence from the real Tesseract runs on these images.
  const conf = label.startsWith("Frusemide") ? 55 : label.startsWith("Lamadol") ? 44 : 77;
  const q = assessRead(parsed, conf);
  console.log(
    `   ${(q.strong ? "keep local " : "ESCALATE   ").padEnd(12)} ${label.padEnd(42)} ${parsed.derivedFrom} (${q.reason})`,
  );
}

console.log(
  failures === 0
    ? "\nAll label-parsing checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
