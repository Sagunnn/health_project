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
  photo ──► Gemini vision OCR ──► { productName, ingredients, isSupplement }
                                              │
   athlete profile (sport, event date, route) ─┤
                                              ▼
                              lib/rules-engine.ts  ◄── data/wada-rules.json
                                   (deterministic)
                                              │
                                              ▼
                              status + reasons + next steps
```

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

| Mode | Request | Needs an API key? |
| --- | --- | --- |
| Demo preset | `{ presetId }` | No |
| Photo / camera | `{ imageBase64 }` | Yes |
| Typed by hand | `{ extracted }` | No |

Manual entry is the fallback that matters: no key, no signal, or a label that
will not photograph legibly.

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

### Enabling photo scanning

Only camera and photo-upload scanning needs a key. Get a free one from
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
  demo-presets.ts       The five stakeholder cases
  status-styles.ts      Tier colours and icons
  storage.ts            SSR-safe localStorage helpers
types/index.ts          Shared contracts
scripts/                Engine assertions + browser verification
```

Tech: Next.js 14 (App Router) · TypeScript · Tailwind CSS · `ai` +
`@ai-sdk/google` · `zod` · `lucide-react`

---

## Privacy

Your profile and scan history live in `localStorage` on your device. There is no
database, no account, and no login. Nothing is uploaded except the label image
you choose to scan, which goes to Google's Gemini API for OCR.

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com](https://vercel.com).
2. Add `GEMINI_API_KEY` under **Environment Variables** (optional — presets and
   manual entry work without it).
3. Deploy.
