# BESAFE by AIMS

> **B**efore **E**xposure: **S**ubstance **A**ssessment **F**or **E**very Athlete
> *Know before you take it.*

An athlete-facing anti-doping safety tool. Photograph a medication or supplement
label, and BESAFE extracts the ingredients, checks them against the WADA
Prohibited List **in your competition context**, and keeps a private record of
everything you have checked.

> [!WARNING]
> This is an MVP built on a curated subset of the Prohibited List, not an
> official compliance tool. It does not replace a determination by your National
> Anti-Doping Organisation (NADO), your International Federation, or
> [Global DRO](https://www.globaldro.com). Under the WADA Code you are strictly
> liable for whatever is in your body. Always confirm before use.

---

## Why context matters

The same substance can be fine today and a violation tomorrow. Pseudoephedrine —
in ordinary supermarket decongestants — is permitted out-of-competition but
prohibited in-competition. BESAFE knows which situation you are in:

| Your situation | Sudafed (pseudoephedrine) |
| --- | --- |
| No competition scheduled | 🟡 **CONDITIONAL** — permitted, but timing-dependent |
| Competition in 10 days | 🟡 **CONDITIONAL** — out-of-competition rules apply |
| Competition tomorrow | 🔴 **PROHIBITED** — you are inside the 48-hour window |

The same logic covers **route** (inhaled vs injected steroids) and **sport**
(beta-blockers are prohibited in archery, but not in athletics).

---

## The five status tiers

| | Tier | Meaning |
| --- | --- | --- |
| 🟢 | `NOT_PROHIBITED` | No WADA restriction identified for the declared ingredients |
| 🟡 | `CONDITIONAL` | Permitted only under specific dose, route, or timing conditions |
| 🔴 | `PROHIBITED` | Banned under the applicable Prohibited List provisions |
| 🟠 | `SUPPLEMENT_RISK` | Dietary supplement with inherent contamination risk, **even if the label looks clear** |
| ⚪ | `UNVERIFIED` | Cannot be assessed from the label — refer to your NADO |

`SUPPLEMENT_RISK` exists because a clean ingredient list is not a clean product.
Independent testing repeatedly finds undeclared anabolic agents and stimulants in
supplements whose labels look fine, and proprietary blends make the real
composition impossible to verify.

---

## Architecture

The central design rule: **the AI never decides anything.**

```
  photo ──► on-device OCR ──► you confirm what it read
            (Tesseract)                   │
                                          │   ──► AI scan, only if the
                                          │        label won't read
                                          ▼
   athlete profile (sport, event date, route) ─┐
                                               ▼
                               lib/rules-engine.ts  ◄── data/wada-rules.json
                                    (deterministic)
                                               │
                                               ▼
                               status + reasons + next steps
```

The label is read **on your phone first**, and what it read is shown to you to
confirm or correct before anything is judged. That keeps the common case free,
offline and private — the image never leaves the device — and it puts a human
between imperfect OCR and a safety-critical verdict.

**The AI scan is reached for only when the on-device read is weak.** A proper
ingredients panel or an inline list of two or more substances is trustworthy
evidence, so it is used as-is: free, instant, nothing uploaded. But when the
molecule could only be inferred from a brand's brackets (`LAMADOL (Tramadol
HCl)`) or from the title line of a generic pack (`Frusemide Tablets I.P. 40
mg`), no ingredients panel was found at all — which is exactly where an
ingredient gets missed, and a missed ingredient reads as a clean product. Those
escalate automatically, and you can always ask for an AI scan yourself.

| Label | On-device read | Escalates? |
| --- | --- | --- |
| Ingredients panel, or inline list of 2+ | trusted | no |
| Molecule only in brackets | weak | yes |
| Molecule only in the title | weak | yes |
| Nothing readable | weak | yes |

- The vision model is an **OCR engine only**. It is never asked whether something
  is permitted, what WADA class it falls under, or what the athlete should do.
- Every verdict is computed in [`lib/rules-engine.ts`](lib/rules-engine.ts) from
  [`data/wada-rules.json`](data/wada-rules.json). The same label, profile, and
  clock always produce byte-identical output.
- A declared TUE never downgrades a verdict. It only adds a reminder to confirm
  the exemption covers that exact substance, dose, and route.

### Reference data

[`data/wada-rules.json`](data/wada-rules.json) curates the 2025 Prohibited List:

- **39 substance entries** across S0–S9, P1, M1–M2, and the Monitoring Program,
  with aliases, brand names, and botanical cover-names (`geranium extract` →
  DMAA, `Ma Huang` → ephedrine)
- **173 permitted substances**, including inert excipients so a filler like
  sorbitol does not drag a product to `UNVERIFIED`
- Keyword heuristics for supplement-contamination risk and unassessable labels

### Three ways to check a product

| Mode | Reads the label | Needs an API key? |
| --- | --- | --- |
| Photo / camera | On your device, then you confirm | **No** |
| Demo preset | Fixed test data | No |
| Typed by hand | You type it | No |
| AI scan | Gemini, on request | Yes |

Only the last row spends quota. On-device reading takes about **0.8s** once the
language data is cached (the first run downloads it), against 13–30s for a
round trip to the model.

---

## Getting started

**Requires Node.js 18.17+**

```bash
git clone https://github.com/Sagunnn/health_project.git
cd health_project
npm install
npm run dev
```

Open <http://localhost:3000>. The five demo presets work immediately — no API
key needed.

### Enabling the AI scan fallback

Everything works without a key — on-device reading, presets and manual entry.
A key is only needed for the *AI scan* button, used when a label will not read
on the device.

Two providers are supported and tried in order. Configure either, or both for
redundancy — free allowances are small and run out:

| Provider | Variable | Free key |
| --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |

Extra keys rotate: `GEMINI_API_KEY_1..9`, `OPENROUTER_API_KEY_1..9`. A
credential that is out of quota or rejected is skipped for every model behind
it, and a stalled one is capped by `OCR_ATTEMPT_MS` so it cannot starve the
providers after it. Get a free one from
[Google AI Studio](https://aistudio.google.com/apikey):

```bash
cp .env.example .env
```

```env
GEMINI_API_KEY=your_key_here
```

> [!NOTE]
> Google retires Gemini models on a rolling basis — `gemini-1.5-flash` and
> `gemini-2.5-flash` are both already unavailable to new API keys. The route
> walks a fallback chain (`gemini-3.5-flash` → `gemini-flash-latest` →
> `gemini-3-flash-preview`) and advances past retired or throttled models
> automatically. Pin your own with `GEMINI_MODEL` in `.env`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run verify:demo` | **18 rules-engine assertions** — presets, the 48-hour boundary, route and sport sensitivity, determinism |
| `npm run verify:guards` | **16 quota-guard assertions** — rate limits, extraction cache, single-flight. No network required |
| `npm run verify:vision` | **23 provider-chain assertions** — failure classification, ordering, OpenRouter reply parsing. No credentials required |
| `npm run verify:label` | **Label-parsing cases** built from verbatim OCR of real packaging — ingredient blocks, inline lists, bracketed molecules, title-line generics |

There is also [`scripts/browser-check.mjs`](scripts/browser-check.mjs), which
drives the app in Chromium and fails on any console error, exception, or React
hydration mismatch. It needs Playwright, which is not a saved dependency:

```bash
npm i -D playwright && npx playwright install chromium
node scripts/browser-check.mjs
```

---

## Demo presets

Five one-tap cases, one per tier, for demonstrations without physical packaging:

| Preset | Expected | Demonstrates |
| --- | --- | --- |
| Advil (Ibuprofen) | 🟢 | Common medicine, no restriction |
| Sudafed (Pseudoephedrine) | 🟡 → 🔴 | Escalates inside the competition window |
| Stanozolol Tablets | 🔴 | Anabolic agent, prohibited at all times |
| Hardcore Pre-Workout | 🟠 | Clean label, inherent supplement risk |
| Imported Herbal Extract | ⚪ | Undisclosed composition |

Set a competition date in **Profile** and re-run Sudafed to watch the verdict
change.

---

## Project layout

```text
app/
  api/scan/route.ts     Hybrid route: preset | Gemini OCR | manual entry
  page.tsx              Tab container (scanner / passport / profile)
components/             UI, one component per screen concern
data/wada-rules.json    Curated WADA reference database
lib/
  rules-engine.ts       Deterministic evaluation — the heart of the app
  local-ocr.ts          On-device label reading (Tesseract, dynamic import)
  label-text.ts         Parses OCR text into candidate ingredients
  extraction-cache.ts   Image-hash cache + single-flight, to spare quota
  rate-limit.ts         Per-client and global caps on the AI scan path
  vision.ts             AI fallback across Gemini and OpenRouter
  demo-presets.ts       The five stakeholder cases
  status-styles.ts      Tier colours and icons
  storage.ts            SSR-safe localStorage helpers
types/index.ts          Shared contracts
scripts/                Engine assertions + browser verification
```

Tech: Next.js 14 (App Router) · TypeScript · Tailwind CSS · `tesseract.js` ·
`ai` + `@ai-sdk/google` · `zod` · `lucide-react`

---

## Privacy

Your profile and scan history live in `localStorage` on your device. There is no
database, no account, and no login.

Label photos are read **on your device** and are not uploaded. An image only
leaves your phone if you explicitly choose the AI scan fallback, which sends it
to Google's Gemini API for transcription.

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com](https://vercel.com).
2. Add `GEMINI_API_KEY` under **Environment Variables** (optional — presets and
   manual entry work without it).
3. Deploy.
