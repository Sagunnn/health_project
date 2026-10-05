/**
 * Provider-chain checks that need no credentials: ordering, credential
 * skipping, classification, and the OpenRouter reply parser.
 */
import {
  classify,
  extractionSchema,
  parseJsonObject,
  geminiModels,
  openRouterModels,
  parseImage,
  providerOrder,
  providerSnapshot,
} from "../lib/vision";

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(56)} ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log("\nFailure classification");
check("Gemini daily quota", classify(new Error("RESOURCE_EXHAUSTED quota")), "quota");
check("OpenRouter 429", classify(new Error("HTTP 429: rate limited")), "quota");
check("OpenRouter 402 (no credits)", classify(new Error("HTTP 402: insufficient credits")), "quota");
check("rejected key", classify(new Error("API_KEY_INVALID")), "auth");
check("OpenRouter 401", classify(new Error("No auth credentials found")), "auth");
check("upstream overload", classify(new Error("HTTP 503: unavailable")), "unavailable");
check("socket fault", classify(Object.assign(new Error("fetch failed"), { cause: new Error("ETIMEDOUT") })), "network");
check("our own budget abort", classify(Object.assign(new Error("x"), { name: "TimeoutError" })), "timeout");
check("unknown stays fatal", classify(new Error("something odd")), "other");

console.log("\nConfiguration");
check("default provider order", providerOrder(), ["gemini", "openrouter"]);
check("gemini models are a non-empty chain", geminiModels().length > 0, true);
check("openrouter models are a non-empty chain", openRouterModels().length > 0, true);
check("snapshot exposes no secrets", JSON.stringify(providerSnapshot()).includes("AQ."), false);

console.log("\nImage parsing");
check("data URL media type", parseImage("data:image/png;base64,AAA").mimeType, "image/png");
check("data URL payload", parseImage("data:image/png;base64,AAA").data, "AAA");
check("bare base64 defaults to jpeg", parseImage("AAA").mimeType, "image/jpeg");

console.log("\nOpenRouter reply parsing (free models vary in how they format JSON)");
const GOOD = '{"productName":"X","ingredients":["Ibuprofen 200 mg"],"isSupplement":false}';
check("plain JSON", (parseJsonObject(GOOD) as { productName: string }).productName, "X");
check("fenced in ```json", (parseJsonObject("```json\n" + GOOD + "\n```") as { productName: string }).productName, "X");
check("fenced in bare ```", (parseJsonObject("```\n" + GOOD + "\n```") as { productName: string }).productName, "X");
check("prose wrapped", (parseJsonObject("Sure! Here you go:\n" + GOOD + "\nHope that helps.") as { productName: string }).productName, "X");
check("schema accepts a valid reply", extractionSchema.safeParse(parseJsonObject(GOOD)).success, true);
check("schema rejects a wrong shape", extractionSchema.safeParse(parseJsonObject('{"productName":5,"ingredients":[],"isSupplement":false}')).success, false);
let threw = false;
try { parseJsonObject("I cannot read this label."); } catch { threw = true; }
check("non-JSON reply throws rather than returning junk", threw, true);

console.log(failures === 0 ? "\nAll vision checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
