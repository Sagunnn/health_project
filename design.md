# UI/UX & Design System Guidelines for BESAFE by AIMS

## 1. The Core Vibe: "Cockpit — dark, lit, unambiguous"
Athletes use this right before swallowing something, often in a shop or a
corridor. The UI must be unambiguous, fast and free of clutter. The shell is
dark and softly lit, like an instrument panel: the verdict is the brightest
thing on screen, and everything else recedes.

Dark is not decoration. The five status colours are the product's entire
vocabulary, and they read far more urgently as light on dark than as dark on
light.

## 2. App Shell (Mobile-First Constraints)
- **Container:** a mobile-constraint shell so it reads as a native app even on
  desktop — `relative mx-auto min-h-screen max-w-md overflow-hidden pb-24`,
  with the `.cockpit-shell` horizon glow.
- **Navigation:** fixed bottom bar, glass over `#070c17`, with a luminous
  hairline and a glowing marker above the active tab. It is centred with
  `left-1/2 -translate-x-1/2`; `fixed` + `max-w-md` alone pins it to the
  viewport's left edge on desktop.
- **Icons:** Lucide — `ScanLine` (Scanner), `BookOpen` (Passport), `User`
  (Profile).

## 3. Color System
- **Surfaces:** `--surface-void` `#04070e` behind the shell, `--surface-deep`
  `#0a1020` for the shell. Cards use the `.panel` class (white at 4.5% over a
  10% hairline) so depth is identical everywhere.
- **Interactive:** cyan-400 for accents and links, a sky-400 → blue-600
  gradient for primary actions. Never a flat mid-blue — it disappears at this
  brightness.
- **The 5 Status Outcomes (STRICT):** the hues are fixed, because they are the
  semantics. Each tier is a translucent fill, a luminous border, and a bloom.
  The canonical strings live in `lib/status-styles.ts` and must stay literal so
  Tailwind's JIT can compile them.

  | Tier | Fill / text / border | Icon |
  | --- | --- | --- |
  | NOT_PROHIBITED 🟢 | `bg-emerald-500/15 text-emerald-300 border-emerald-400/60` | `CheckCircle` |
  | CONDITIONAL 🟡 | `bg-amber-500/15 text-amber-200 border-amber-400/60` | `AlertCircle` |
  | PROHIBITED 🔴 | `bg-red-500/20 text-red-200 border-red-400/70` | `XOctagon` |
  | SUPPLEMENT_RISK 🟠 | `bg-orange-500/15 text-orange-200 border-orange-400/60` | `AlertTriangle` |
  | UNVERIFIED ⚪ | `bg-slate-400/15 text-slate-200 border-slate-400/50` | `HelpCircle` |

## 4. Component Layouts
- **The Camera Button:** a 112px gradient lens inside a 160px targeting ring —
  a soft halo, a solid ring and a dashed inner ring. While a read is in flight
  the halo pulses and a scanline sweeps the lens.
- **Demo Presets:** `.panel` cards, each with a glowing dot in its tier colour.
- **Results Modal:** the verdict must be undeniable. The status badge spans the
  card and carries its tier's bloom; the plain-language explanation is
  `text-base` on `text-slate-300`.
- **Passport Timeline:** a left rail (`border-l border-white/10`) with node dots
  ringed in the shell colour so they read as lights on a wire.

## 5. Non-negotiables
- **Contrast:** every text node must clear WCAG AA against its own background —
  4.5:1 normally, 3:1 for large or bold. `npm run verify:styles` catches
  utilities that silently fail to compile, which on a dark shell fall back to
  `currentColor` and turn hairlines into solid white bars.
- **Muted text is slate-400, never slate-500.** At 12px, slate-500 measures
  3.98:1 on the shell and fails AA.
- **Motion respects `prefers-reduced-motion`**; all of it is decorative.
