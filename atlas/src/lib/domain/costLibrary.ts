import { z } from "zod";
import type { Rec } from "../data/entities";

/** What the estimate screen needs to know about one Cost Library item. */
export interface CostOption {
  id: string;
  name: string;
  unit: string;
  category: string;
  supplier: string;
  /** Unit price inc GST in cents, or null when the library has no usable price. */
  priceIncCents: number | null;
  /** Estimate line type this item usually becomes. */
  lineType: "Material" | "Labour";
  /** Ticked "Active" in the library. Used to rank, never to hide. */
  active: boolean;
}

const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Pulls the first dollar amount out of free text like "$45 per m2" or "45.50". */
export function parseLegacyCost(text: string | null | undefined): number | null {
  const m = tidy(text).replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function dollarsToCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Price order: the library's own "Effective Unit Cost inc GST" (dollars, worked out in Airtable),
 * then the current unit cost (cents), then a number read from the old free-text cost.
 */
export function toCostOption(c: Rec<"costItems">): CostOption | null {
  const name = tidy(c.name);
  if (!name) return null;
  const category = tidy(c.category);
  const priceIncCents = dollarsToCents(c.effectiveUnitCostInc) ?? c.currentUnitCostInc ?? parseLegacyCost(c.legacyCostText);
  return {
    id: c.id,
    name,
    unit: tidy(c.unit),
    category,
    supplier: tidy(c.supplier),
    priceIncCents,
    lineType: /labou?r/i.test(category) ? "Labour" : "Material",
    active: c.active === true,
  };
}

export function toCostOptions(rows: Rec<"costItems">[]): CostOption[] {
  return rows
    .map(toCostOption)
    .filter((x): x is CostOption => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Type-ahead search. Every typed word must start a word in the name, category or supplier
 * (or, from 3 letters, appear inside one).
 * Best first: name starts with the text, then a name word starts with it, then anywhere.
 * Items ticked Active rank above unticked ones at the same score.
 */
export function searchCostItems(items: CostOption[], query: string, limit = 8): CostOption[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ");
  const scored: { item: CostOption; score: number }[] = [];
  for (const item of items) {
    const name = norm(item.name);
    const hay = `${name} ${norm(item.category)} ${norm(item.supplier)}`;
    const hayWords = hay.split(" ");
    if (!words.every((w) => hayWords.some((h) => h.startsWith(w)) || (w.length >= 3 && hay.includes(w)))) continue;
    let score = 0;
    if (name.startsWith(q)) score += 100;
    const nameWords = name.split(" ");
    score += words.filter((w) => nameWords.some((h) => h.startsWith(w))).length * 20;
    if (name.includes(q)) score += 10;
    if (item.active) score += 5;
    if (item.priceIncCents !== null) score += 2;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((s) => s.item);
}

/** A new Cost Library item saved from the estimate screen. */
export const CostItemCreate = z.object({
  name: z.string().trim().min(2).max(200),
  unit: z.string().trim().max(40).default(""),
  category: z.string().trim().max(80).default(""),
  supplier: z.string().trim().max(120).default(""),
  priceIncCents: z.number().int().min(0).max(100_000_000),
});
export type CostItemCreate = z.infer<typeof CostItemCreate>;
