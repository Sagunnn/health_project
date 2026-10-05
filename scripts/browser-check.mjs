/**
 * Browser verification for BESAFE.
 *
 * Drives the real app in Chromium at phone viewport and fails on any console
 * error, page exception, or React hydration mismatch. Screenshots land in
 * OUT_DIR for visual inspection.
 *
 * Usage: node scripts/browser-check.mjs [baseUrl] [outDir]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "./.playwright-out";
mkdirSync(OUT, { recursive: true });

const problems = [];
const HYDRATION_RE =
  /hydrat|did not match|text content does not match|server rendered/i;

let step = 0;
async function shot(page, name) {
  step += 1;
  const file = `${OUT}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  shot  ${file}`);
}

function attach(page, label) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = msg.text();
    // Next dev emits a benign notice about the Fast Refresh websocket.
    if (/Download the React DevTools/i.test(text)) return;
    const entry = `[${label}] console.${type}: ${text}`;
    problems.push({ hydration: HYDRATION_RE.test(text), entry });
  });
  page.on("pageerror", (err) => {
    problems.push({
      hydration: HYDRATION_RE.test(err.message),
      entry: `[${label}] pageerror: ${err.message}`,
    });
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

const page = await context.newPage();
attach(page, "first-load");

console.log("\n1. First load (empty localStorage)");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=Demo presets");
console.log("   header:", await page.locator("h1").first().innerText());
await shot(page, "scanner-empty");

console.log("\n2. Run the Stanozolol preset -> expect PROHIBITED");
await page.getByRole("button", { name: /Stanozolol/ }).click();
await page.waitForSelector('[role="dialog"]');
const badge1 = await page.locator('[role="dialog"]').innerText();
console.log("   verdict:", badge1.split("\n").slice(0, 6).join(" | "));
if (!/PROHIBITED/.test(badge1)) problems.push({ entry: "Stanozolol did not show PROHIBITED" });
await shot(page, "result-prohibited");

console.log("\n3. Expand the ingredient breakdown");
await page.getByRole("button", { name: /ingredient breakdown/i }).click();
await page.waitForTimeout(250);
await shot(page, "result-breakdown");

console.log("\n4. Save to Passport");
await page.getByRole("button", { name: /Save to Passport/i }).click();
await page.waitForSelector("text=Saved to your Passport");
await shot(page, "result-saved");
await page.getByRole("button", { name: /Close result/i }).click();

console.log("\n5. Passport tab -> timeline should show the saved scan");
await page.getByRole("button", { name: /^Passport/ }).click();
await page.waitForSelector("text=Athlete Passport");
const passportText = await page.locator("main").innerText();
if (!/Stanozolol/.test(passportText)) problems.push({ entry: "Saved scan missing from Passport" });
console.log("   entries visible:", /Stanozolol/.test(passportText) ? "yes" : "NO");
await shot(page, "passport-timeline");

console.log("\n6. Profile tab -> set Archery + competition tomorrow");
await page.getByRole("button", { name: /^Profile/ }).click();
await page.waitForSelector("text=Athlete profile");
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
await page.fill("#athlete-sport", "Archery");
await page.fill("#athlete-discipline", "Recurve");
await page.selectOption("#athlete-level", "National");
await page.fill("#athlete-competition", tomorrow);
// NADO is a <select> backed by data/nados.json, not a free-text input.
await page.selectOption("#athlete-nado", "UKAD");
await shot(page, "profile-filled");
await page.getByRole("button", { name: /Save profile/i }).click();
await page.waitForSelector("text=Profile saved");
console.log("   saved, competition date:", tomorrow);

console.log("\n7. Back to Scanner -> Sudafed must now escalate to PROHIBITED");
await page.getByRole("button", { name: /^Scanner/ }).click();
await page.getByRole("button", { name: /Sudafed/ }).click();
await page.waitForSelector('[role="dialog"]');
const badge2 = await page.locator('[role="dialog"]').innerText();
const escalated = /PROHIBITED/.test(badge2) && /within 48 hours/i.test(badge2);
console.log("   verdict:", badge2.split("\n").slice(0, 6).join(" | "));
console.log("   escalated in UI:", escalated ? "yes" : "NO");
if (!escalated) problems.push({ entry: "Sudafed did not escalate inside the 48h window" });
await shot(page, "result-escalated");

console.log("\n8. Beta-blocker in Archery (sport-specific) via manual ingredient");
await page.getByRole("button", { name: /Close result/i }).click();

// The critical hydration case: reload with localStorage already populated.
console.log("\n9. Reload with populated localStorage (hydration stress test)");
const page2 = await context.newPage();
attach(page2, "reload");
await page2.goto(BASE, { waitUntil: "networkidle" });
await page2.getByRole("button", { name: /^Passport/ }).click();
await page2.waitForSelector("text=Athlete Passport");
const persisted = await page2.locator("main").innerText();
console.log("   passport persisted:", /Stanozolol/.test(persisted) ? "yes" : "NO");
if (!/Stanozolol/.test(persisted)) problems.push({ entry: "Passport did not persist across reload" });
await shot(page2, "passport-after-reload");

await page2.getByRole("button", { name: /^Profile/ }).click();
await page2.waitForSelector("text=Athlete profile");
const sportVal = await page2.inputValue("#athlete-sport");
console.log("   profile persisted: sport =", JSON.stringify(sportVal));
if (sportVal !== "Archery") problems.push({ entry: `Profile did not persist (sport=${sportVal})` });
await shot(page2, "profile-after-reload");

await browser.close();

/* ------------------------------- report ------------------------------- */
const hydration = problems.filter((p) => p.hydration);
console.log("\n==================== RESULT ====================");
console.log(`hydration errors: ${hydration.length}`);
console.log(`other problems:   ${problems.length - hydration.length}`);
for (const p of problems) console.log("  -", p.entry);
if (problems.length === 0) console.log("No console errors, no exceptions, no hydration mismatches.");
console.log("================================================\n");
process.exit(problems.length === 0 ? 0 : 1);
