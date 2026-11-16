/**
 * Money helpers. All financial maths in ATLAS works in integer cents so that
 * totals are exact and repeatable. Convert to dollars only for display or for
 * writing back to Airtable currency fields.
 */

export type Cents = number;

/** Convert a dollar amount (possibly with float noise) to integer cents. */
export function toCents(dollars: number | null | undefined): Cents {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return 0;
  // toPrecision strips binary float noise such as 0.1 + 0.2 = 0.30000000000000004
  return Math.round(Number((dollars * 100).toPrecision(15)));
}

export function toDollars(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Multiply cents by a rate and round half away from zero to whole cents. */
export function mulRate(cents: Cents, rate: number): Cents {
  const raw = Number((cents * rate).toPrecision(15));
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

export function sumCents(values: Array<Cents | null | undefined>): Cents {
  let total = 0;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) total += Math.round(v);
  return total;
}

const audFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const audWhole = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

export function formatAud(cents: Cents, opts: { whole?: boolean } = {}): string {
  return (opts.whole ? audWhole : audFormatter).format(toDollars(cents));
}

export function formatPct(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "–";
  return `${(rate * 100).toFixed(digits)}%`;
}
