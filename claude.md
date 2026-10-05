# CLAUDE.md — BESAFE by AIMS Development Guidelines

## Project Overview
BESAFE by AIMS is an athlete-facing medication and dietary supplement safety platform. It scans product labels, extracts ingredients, checks them against the WADA (World Anti-Doping Agency) Prohibited List contextually, and saves records into an Athlete Passport.

---

## Non-Negotiable Architectural Laws
1. **AI is ONLY for OCR/Extraction, NOT Rule Evaluation:**
   - The Vision LLM (`/api/scan`) only parses packaging into: `{ productName: string, ingredients: string[] }`.
   - The anti-doping determination MUST be computed deterministically in `lib/rules-engine.ts` using `data/wada-rules.json`.
2. **Contextual Status Evaluation:**
   - The engine must check the athlete's competition date. If a substance is prohibited *in-competition* and the athlete's event is within 48 hours, escalate to prohibited.
3. **The 5 Definitive Status Tiers:**
   - `NOT_PROHIBITED` (🟢): No WADA restriction found.
   - `CONDITIONAL` (🟡): Depends on dose, route, or competition timing.
   - `PROHIBITED` (🔴): Banned under applicable WADA regulations.
   - `SUPPLEMENT_RISK` (🟠): Dietary supplement flagged for inherent contamination risk, even if listed ingredients look clear.
   - `UNVERIFIED` (⚪): Unrecognized or foreign product requiring NADO/expert review.
4. **Resilience & Fallbacks:**
   - The demo must run even if `GEMINI_API_KEY` is missing, via the deterministic demo presets and manual ingredient entry.
   - Use `localStorage` for the Athlete Profile and Passport history (no external database or login required for MVP).

---

## Tech Stack & Commands
- **Framework:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Icons:** `lucide-react`
- **AI SDK:** `ai`, `@ai-sdk/google` (Gemini vision OCR), `zod`
- **State/Storage:** Browser `localStorage`

### Key Commands
- Dev Server: `npm run dev`
- Build Check: `npm run build`
- Lint: `npm run lint`

---

## Directory Conventions
```text
├── app/
│   ├── api/scan/route.ts      # Serverless label OCR & rules orchestration
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # Main mobile-first responsive app container
├── components/
│   ├── AthleteProfile.tsx     # Form for sport, discipline, next comp date
│   ├── DemoPresets.tsx        # 5 one-click test cases for stakeholder demos
│   ├── PassportTimeline.tsx   # Longitudinal history view
│   ├── ResultCard.tsx         # 5-tier colored status display
│   └── ScannerModal.tsx       # Camera / file upload trigger
├── data/
│   └── wada-rules.json        # Curated WADA reference database
├── lib/
│   ├── rules-engine.ts        # Pure TypeScript deterministic logic
│   └── storage.ts             # Safe SSR-friendly localStorage helpers
└── types/
    └── index.ts               # Shared TypeScript schemas