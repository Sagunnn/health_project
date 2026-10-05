/**
 * National Anti-Doping Organisations offered in the athlete profile.
 *
 * The profile stores the short `code`, because that is what the rules engine
 * prints verbatim in its referral advice — "Contact KADA or your team
 * physician" reads better than the full legal name. Anything not listed can
 * still be typed freely, so an athlete under a NADO we have not catalogued is
 * never blocked.
 */

import nadoData from "@/data/nados.json";

export interface Nado {
  code: string;
  name: string;
  country: string;
  region: string;
}

interface NadoFile {
  note: string;
  organisations: Nado[];
}

const DATA = nadoData as NadoFile;

export const NADOS: Nado[] = DATA.organisations;

/** Sentinel for the free-text escape hatch in the profile form. */
export const NADO_OTHER = "__other__";

/** Regions in display order; International last since it is not a NADO. */
const REGION_ORDER = [
  "Asia",
  "Europe",
  "Americas",
  "Oceania",
  "Africa",
  "International",
];

export function nadosByRegion(): Array<{ region: string; items: Nado[] }> {
  const groups = new Map<string, Nado[]>();
  for (const nado of NADOS) {
    const list = groups.get(nado.region) ?? [];
    list.push(nado);
    groups.set(nado.region, list);
  }
  return REGION_ORDER.filter((r) => groups.has(r)).map((region) => ({
    region,
    items: (groups.get(region) ?? []).sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
  }));
}

export function findNado(code: string): Nado | undefined {
  return NADOS.find((n) => n.code === code);
}

/** True when a stored value came from the list rather than free text. */
export function isKnownNado(code: string): boolean {
  return NADOS.some((n) => n.code === code);
}
