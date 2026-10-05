/**
 * Five one-click stakeholder demo cases, one per status tier.
 *
 * These stand in for Vision-LLM output so the full pipeline can be shown
 * without physical packaging or an API key. They are plain `ExtractedLabel`
 * payloads — the verdict still comes from the rules engine, never from here.
 * `expectedStatus` documents intent and is asserted by `npm run verify:demo`.
 */

import type { DemoPreset } from "@/types";

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "advil",
    label: "Advil (Ibuprofen)",
    caption: "Common painkiller — no restriction",
    expectedStatus: "NOT_PROHIBITED",
    extracted: {
      productName: "Advil Liqui-Gels 200mg",
      ingredients: ["Ibuprofen 200 mg", "Gelatin", "Sorbitol"],
    },
    context: { route: "ORAL" },
  },
  {
    id: "sudafed",
    label: "Sudafed (Pseudoephedrine)",
    caption: "Decongestant — depends on competition timing",
    expectedStatus: "CONDITIONAL",
    extracted: {
      productName: "Sudafed Congestion 60mg Tablets",
      ingredients: ["Pseudoephedrine Hydrochloride 60 mg"],
    },
    context: { route: "ORAL" },
  },
  {
    id: "stanozolol",
    label: "Stanozolol Tablets",
    caption: "Anabolic steroid — banned at all times",
    expectedStatus: "PROHIBITED",
    extracted: {
      productName: "Stanozolol 10mg Oral Tablets",
      ingredients: ["Stanozolol 10 mg", "Lactose", "Magnesium Stearate"],
    },
    context: { route: "ORAL" },
  },
  {
    id: "pre-workout",
    label: "Hardcore Pre-Workout",
    caption: "Label looks clean — inherent supplement risk",
    expectedStatus: "SUPPLEMENT_RISK",
    extracted: {
      productName: "APEX Hardcore Pre-Workout Igniter",
      ingredients: [
        "Caffeine Anhydrous 300 mg",
        "Beta-Alanine 3.2 g",
        "L-Citrulline 6 g",
        "Proprietary Blend 1,250 mg",
      ],
    },
    context: { route: "ORAL", isDietarySupplement: true },
  },
  {
    id: "herbal-extract",
    label: "Imported Herbal Extract",
    caption: "Undisclosed composition — needs NADO review",
    expectedStatus: "UNVERIFIED",
    extracted: {
      productName: "Nine-Treasure Herbal Tonic (Imported)",
      ingredients: [
        "Multi-herb decoction",
        "Undisclosed botanical extracts",
      ],
    },
    context: { route: "ORAL" },
  },
];

export function getPresetById(id: string): DemoPreset | undefined {
  return DEMO_PRESETS.find((preset) => preset.id === id);
}
