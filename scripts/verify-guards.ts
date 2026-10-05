/**
 * Deterministic tests for the quota guards. No network, no model calls —
 * these must hold regardless of Gemini's state.
 */
import {
  __resetRateLimitState,
  LIMITS,
  checkRateLimit,
  recordScan,
} from "../lib/rate-limit";
import {
  __resetExtractionCache,
  getCached,
  imageKey,
  setCached,
  singleFlight,
} from "../lib/extraction-cache";

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(54)} ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log("\nRate limiting");
__resetRateLimitState();
const now = Date.now();
check("fresh client is allowed", checkRateLimit("a", now).allowed, true);
for (let i = 0; i < LIMITS.perClientPerHour; i++) recordScan("a", now);
check("blocked after the hourly allowance", checkRateLimit("a", now).allowed, false);
check("reason is the hourly window", checkRateLimit("a", now).reason, "client-hour");
check("a different client is unaffected", checkRateLimit("b", now).allowed, true);
check("hourly window frees up later", checkRateLimit("a", now + 61 * 60 * 1000).allowed, true);

__resetRateLimitState();
for (let i = 0; i < LIMITS.globalPerDay; i++) recordScan(`client-${i}`, now);
check("global cap blocks an unseen client", checkRateLimit("brand-new", now).allowed, false);
check("reason is the global cap", checkRateLimit("brand-new", now).reason, "global-day");

console.log("\nExtraction cache");
__resetExtractionCache();
const k1 = imageKey("data:image/jpeg;base64,AAAA");
const k2 = imageKey("data:image/jpeg;base64,BBBB");
check("identical bytes hash alike", imageKey("data:image/jpeg;base64,AAAA"), k1);
check("different bytes hash differently", k1 === k2, false);
check("miss before write", getCached(k1), undefined);
setCached(k1, { extracted: { productName: "X", ingredients: ["Ibuprofen"] }, isSupplement: false, model: "m" });
check("hit after write", getCached(k1)?.extracted.ingredients, ["Ibuprofen"]);
setCached(k2, { extracted: { productName: "Y", ingredients: [] }, isSupplement: false, model: "m" });
check("an empty extraction is not cached", getCached(k2), undefined);

async function main() {
console.log("\nSingle-flight");
__resetExtractionCache();
let calls = 0;
const slow = () => new Promise<void>((r) => setTimeout(r, 60)).then(() => {
  calls += 1;
  return { extracted: { productName: "P", ingredients: ["Caffeine"] }, isSupplement: true, model: "m" };
});
const out = await Promise.all(Array.from({ length: 5 }, () => singleFlight("same", slow)));
check("five concurrent callers -> one execution", calls, 1);
check("four of them are marked deduped", out.filter((o) => o.deduped).length, 4);
check("all five get the same result", new Set(out.map((o) => o.result.extracted.productName)).size, 1);
calls = 0;
await singleFlight("same", slow);
check("a later call runs again (not stuck)", calls, 1);

}

void main().then(() => {
  console.log(failures === 0 ? "\nAll guard checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
});
