/**
 * Guards against Tailwind classes that silently do not compile.
 *
 * An opacity step outside Tailwind's scale (border-white/12) produces no CSS
 * at all, and the property falls back to currentColor — which on a dark shell
 * turned a hairline rail into a solid white bar. Nothing errors, so only a
 * check like this catches it.
 *
 * Usage: node scripts/verify-styles.mjs [baseUrl]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.(tsx?|mjs)$/.test(name)
        ? [full]
        : [];
  });
}

const sources = ["app", "components", "lib"].flatMap(walk);
const used = new Set();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  // Colour utilities carrying an opacity modifier.
  for (const m of text.matchAll(
    /\b(bg|text|border|ring|from|to|via|shadow|fill|stroke)-(?:[a-z]+-\d{2,3}|white|black)\/\d{1,3}\b/g,
  )) {
    used.add(m[0]);
  }
}

const page = await fetch(BASE).then((r) => r.text());
const href = page.match(/\/_next\/static\/css\/[^"]+\.css/)?.[0];
if (!href) {
  console.error("Could not find the stylesheet; is the dev server running?");
  process.exit(1);
}
const css = await fetch(BASE + href).then((r) => r.text());

// Match the escaped class anywhere in a selector: a variant compiles as
// ".focus\:border-cyan-400\/60:focus", which has no leading dot before the
// utility itself, so requiring one reports false positives.
const missing = [...used].filter(
  (cls) => !css.includes(cls.replace("/", "\\/")),
);
console.log(`opacity utilities used : ${used.size}`);
console.log(`not present in the CSS : ${missing.length}`);
for (const m of missing.sort()) console.log("  MISSING  " + m);
console.log(
  missing.length === 0
    ? "\nEvery opacity utility compiled."
    : "\nThese produce no CSS and will fall back to currentColor.",
);

/* ------------------------- contrast ------------------------- */

/**
 * WCAG AA against each element's OWN painted background.
 *
 * Measuring everything against the shell reports dark text on a bright button
 * as a failure, and — worse — misses text sitting on a tinted card, which is
 * exactly where the result modal's explanations live.
 */
const MEASURE = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\\d.]+/g).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c.match(/[\\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0.85)) return c;
      n = n.parentElement;
    }
    return "rgb(10,16,32)";
  };
  const out = [];
  for (const el of document.querySelectorAll("main *, [role=dialog] *")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    if (s.backgroundImage !== "none") continue;
    const size = parseFloat(s.fontSize);
    const bold = +s.fontWeight >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const r = ratio(s.color, bgOf(el));
    if (r < need) out.push({ t: el.textContent.trim().slice(0, 36), r: +r.toFixed(2), size });
  }
  return out;
})()`;

// Playwright is an optional dev tool; without it the CSS check still runs.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log(
    "\nplaywright not installed — skipping the contrast sweep." +
      "\n  npm i -D playwright && npx playwright install chromium",
  );
  process.exit(missing.length === 0 ? 0 : 1);
}

const browser = await chromium.launch();
const view = await (
  await browser.newContext({ viewport: { width: 390, height: 844 } })
).newPage();
await view.goto(BASE, { waitUntil: "networkidle" });

const fails = [];
const sweep = async (label) => {
  for (const row of await view.evaluate(MEASURE)) fails.push({ ...row, label });
};

await sweep("scanner");
// The modal carries the densest text in the app, so it must be measured.
await view.getByRole("button", { name: /Stanozolol/ }).click();
await view.waitForSelector('[role="dialog"]');
await view.getByRole("button", { name: /ingredient breakdown/i }).click();
await view.waitForTimeout(300);
await sweep("result modal");
await view.getByRole("button", { name: /Save to Passport/i }).click();
await view.waitForSelector("text=Saved to your Passport");
await view.getByRole("button", { name: /Close result/i }).click();

for (const [label, tab] of [["passport", /^Passport/], ["profile", /^Profile/]]) {
  await view.getByRole("button", { name: tab }).click();
  await view.waitForTimeout(300);
  await sweep(label);
}
await browser.close();

console.log(`\ntext nodes below WCAG AA : ${fails.length}`);
for (const f of fails) {
  console.log(`  ${String(f.r).padStart(5)}:1  ${f.size}px  [${f.label}]  ${JSON.stringify(f.t)}`);
}
const ok = missing.length === 0 && fails.length === 0;
console.log(ok ? "\nStyles compiled and contrast passes.\n" : "");
process.exit(ok ? 0 : 1);
