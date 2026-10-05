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
    ? "\nEvery opacity utility compiled.\n"
    : "\nThese produce no CSS and will fall back to currentColor.\n",
);
process.exit(missing.length === 0 ? 0 : 1);
