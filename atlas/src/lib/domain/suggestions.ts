/**
 * Type-ahead suggestions for boxes where the same words come up again and again.
 * They come from what's already saved in ATLAS (most used first), topped up with a
 * short starter list. Suggestions only help typing: anything can still be typed.
 */

export const STARTERS = {
  services: ["Paving", "New turf", "Retaining wall", "Garden beds and planting", "Drainage", "Concrete driveway", "Decking", "Fencing", "Pergola", "Synthetic turf", "Irrigation", "Garden edging", "Outdoor lighting", "Garden makeover", "Rubbish removal and clean-up"],
  areas: ["Front yard", "Backyard", "Front lawn", "Back lawn", "Side path", "Driveway", "Rear patio", "Entry path", "Pool area", "Garden beds"],
  nextActions: ["First contact", "Call to book site visit", "Send quote", "Follow up quote", "Waiting on customer", "Book start date"],
  taskTitles: ["Call customer back", "Book site visit", "Send quote", "Follow up quote", "Order materials", "Book skip bin", "Confirm start date", "Chase payment"],
  units: ["m2", "lm", "m3", "Each", "Tonne", "hour", "Bag", "Bulka Bag", "Day"],
  suburbs: [] as string[],
  categories: [] as string[],
  suppliers: [] as string[],
  people: [] as string[],
} as const;
export type SuggestionKind = keyof typeof STARTERS;

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Distinct values, most used first, in the spelling people use most; starters fill the rest. */
export function rankDistinct(values: (string | null | undefined)[], starters: readonly string[] = [], limit = 60): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = (raw ?? "").trim().replace(/\s+/g, " ");
    if (v.length < 2 || v.length > 80) continue;
    const g = groups.get(key(v)) ?? new Map<string, number>();
    g.set(v, (g.get(v) ?? 0) + 1);
    groups.set(key(v), g);
  }
  const ranked = [...groups.values()]
    .map((g) => {
      const spellings = [...g.entries()].sort((a, b) => b[1] - a[1]);
      return { text: spellings[0]![0], count: spellings.reduce((n, [, c]) => n + c, 0) };
    })
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .map((x) => x.text);
  const seen = new Set(ranked.map(key));
  return [...ranked, ...starters.filter((s) => !seen.has(key(s)))].slice(0, limit);
}

/** The short first phrase of a request, e.g. "Paving and new turf, about 60 m²" gives "Paving and new turf". */
export function firstPhrase(text: string | null | undefined): string {
  const t = (text ?? "").split(/[.,;\n]/)[0]!.trim();
  return t.length <= 40 ? t : "";
}

/** Suggestions that match what's typed: every typed word starts a word in the option. Exact matches are left out. */
export function matchSuggestions(options: readonly string[], typed: string, limit = 6): string[] {
  const q = key(typed);
  if (!q) return options.slice(0, limit);
  const words = q.split(" ");
  return options
    .filter((o) => {
      const k = key(o);
      if (k === q) return false;
      const ow = k.split(/[\s/-]+/);
      return words.every((w) => ow.some((x) => x.startsWith(w)));
    })
    .sort((a, b) => Number(key(b).startsWith(q)) - Number(key(a).startsWith(q)))
    .slice(0, limit);
}
