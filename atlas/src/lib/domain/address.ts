/**
 * Address suggestions while typing. The browser asks ATLAS's server, which asks
 * Google Places (best for Australian street numbers, needs GOOGLE_MAPS_API_KEY) or,
 * without a key, the free OpenStreetMap lookup Photon. Keys never reach the browser.
 */

export interface AddressSuggestion {
  /** What the person sees, e.g. "135 Phillip St, Waterloo NSW". */
  label: string;
  /** What goes in the Street address box. */
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

export type AddressProvider = "google" | "photon" | "demo" | "off";

export function addressProvider(env: NodeJS.ProcessEnv = process.env): AddressProvider {
  if (env.ATLAS_ADDRESS_LOOKUP === "off") return "off";
  if (env.GOOGLE_MAPS_API_KEY) return "google";
  const memory = !env.ATLAS_DATA_SOURCE || (env.ATLAS_DATA_SOURCE !== "postgres" && env.ATLAS_DATA_SOURCE !== "airtable");
  return memory ? "demo" : "photon";
}

export const ADDRESS_ATTRIBUTION: Record<AddressProvider, string> = {
  google: "Suggestions powered by Google",
  photon: "Suggestions from © OpenStreetMap contributors",
  demo: "Demo addresses (made up for testing)",
  off: "",
};

/** Sydney, where the business works. Suggestions near here come first. */
const NEAR = { latitude: -33.8688, longitude: 151.2093 };
const STATES = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/;

/** Worth looking up: a few letters, not just a house number. */
export function lookupWorthy(q: string): boolean {
  const t = q.trim();
  return t.length >= 4 && t.length <= 120 && /[a-z]{2}/i.test(t);
}

/** Google's second line looks like "Waterloo NSW, Australia" or "Waterloo NSW 2017, Australia". */
export function parseGoogle(main: string, secondary: string): AddressSuggestion | null {
  const street = main.trim();
  if (!street) return null;
  const parts = secondary.split(",").map((s) => s.trim()).filter(Boolean);
  const local = parts[0] ?? "";
  const m = new RegExp(`^(.*?)\\s+${STATES.source}(?:\\s+(\\d{4}))?$`).exec(local);
  const suburb = (m ? m[1]! : local).trim();
  const state = m?.[2] ?? "";
  const postcode = m?.[3] ?? "";
  if (parts.length > 1 && !/australia/i.test(parts[parts.length - 1]!)) return null;
  return { label: [street, [suburb, state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "), street, suburb, state, postcode };
}

type GoogleResponse = { suggestions?: { placePrediction?: { structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; text?: { text?: string } } }[] };

export async function googleSuggest(q: string, key: string, fetchImpl: typeof fetch = fetch): Promise<AddressSuggestion[]> {
  const res = await fetchImpl("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: q, includedRegionCodes: ["au"], languageCode: "en-AU", locationBias: { circle: { center: NEAR, radius: 50000 } } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new AddressLookupError(res.status === 403 || res.status === 401 ? "The Google Maps key was rejected. The owner needs to check it." : "Address suggestions are unavailable right now.");
  const json = (await res.json()) as GoogleResponse;
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction?.structuredFormat)
    .map((f) => (f ? parseGoogle(f.mainText?.text ?? "", f.secondaryText?.text ?? "") : null))
    .filter((x): x is AddressSuggestion => !!x);
}

type PhotonFeature = { properties?: { countrycode?: string; housenumber?: string; street?: string; name?: string; locality?: string; district?: string; city?: string; state?: string; postcode?: string } };

const STATE_ABBR: Record<string, string> = { "New South Wales": "NSW", Victoria: "VIC", Queensland: "QLD", "South Australia": "SA", "Western Australia": "WA", Tasmania: "TAS", "Australian Capital Territory": "ACT", "Northern Territory": "NT" };

export function parsePhoton(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties;
  if (!p || (p.countrycode ?? "").toUpperCase() !== "AU") return null;
  const road = p.street ?? p.name ?? "";
  if (!road) return null;
  const street = [p.housenumber, road].filter(Boolean).join(" ");
  const suburb = p.locality ?? p.district ?? p.city ?? "";
  const state = STATE_ABBR[p.state ?? ""] ?? p.state ?? "";
  const postcode = p.postcode ?? "";
  return { label: [street, [suburb, state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "), street, suburb, state, postcode };
}

export async function photonSuggest(q: string, fetchImpl: typeof fetch = fetch): Promise<AddressSuggestion[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&lat=${NEAR.latitude}&lon=${NEAR.longitude}`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "ATLAS business system (landscaping company, Sydney)" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new AddressLookupError("Address suggestions are unavailable right now.");
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const out = (json.features ?? []).map(parsePhoton).filter((x): x is AddressSuggestion => !!x);
  return out.filter((s, i) => out.findIndex((o) => o.label === s.label) === i);
}

/** Made-up streets in real Sydney suburbs, for the demo and tests. */
const DEMO_STREETS: [string, string, string][] = [
  ["Example Street", "Waterloo", "2017"],
  ["Sample Avenue", "Penrith", "2750"],
  ["Placeholder Road", "Castle Hill", "2154"],
  ["Fictional Close", "Kellyville", "2155"],
  ["Demo Parade", "Parramatta", "2150"],
];

export function demoSuggest(q: string): AddressSuggestion[] {
  const m = /^\s*(\d+[a-z]?(?:\/\d+)?)?\s*(.*)$/i.exec(q);
  const num = m?.[1] ?? "";
  const rest = (m?.[2] ?? "").toLowerCase().trim();
  return DEMO_STREETS.filter(([s, sub]) => !rest || s.toLowerCase().startsWith(rest) || sub.toLowerCase().startsWith(rest) || rest.split(/\s+/).every((w) => `${s} ${sub}`.toLowerCase().includes(w)))
    .map(([s, suburb, postcode]) => {
      const street = [num, s].filter(Boolean).join(" ");
      return { label: `${street}, ${suburb} NSW ${postcode}`, street, suburb, state: "NSW", postcode };
    });
}

export class AddressLookupError extends Error {}
