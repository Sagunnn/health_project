import type { Config } from "tailwindcss";

/**
 * Per DESIGN.md the status tiers and primary colour use Tailwind's stock
 * palette (emerald / amber / red / orange / slate, with blue-600 for
 * interactive elements). The exact class strings live in
 * `lib/status-styles.ts` so the JIT scanner can see them.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.2s ease-out both",
        sweep: "sweep 2.2s ease-in-out infinite",
        halo: "halo 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
