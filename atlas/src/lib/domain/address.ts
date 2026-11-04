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
  // Made-up addresses only for automated tests; the demo site uses the real free lookup.
  if (env.ATLAS_ADDRESS_DEMO === "1") return "demo";
  return "photon";
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

type PhotonFeature = { properties?: { countrycode?: string; osm_key?: string; type?: string; housenumber?: string; street?: string; name?: string; locality?: string; district?: string; city?: string; state?: string; postcode?: string } };

const STATE_ABBR: Record<string, string> = { "New South Wales": "NSW", Victoria: "VIC", Queensland: "QLD", "South Australia": "SA", "Western Australia": "WA", Tasmania: "TAS", "Australian Capital Territory": "ACT", "Northern Territory": "NT" };
const ROAD_WORDS: Record<string, string> = { st: "Street", rd: "Road", ave: "Avenue", av: "Avenue", dr: "Drive", pl: "Place", cres: "Crescent", cr: "Crescent", ct: "Court", cl: "Close", pde: "Parade", hwy: "Highway", ln: "Lane", tce: "Terrace", cct: "Circuit", bvd: "Boulevard", blvd: "Boulevard", gr: "Grove", wy: "Way" };

/** Splits "135 Phillip St, Waterloo" into the house number ("135", "2/14", "14A") and the rest, with road abbreviations spelled out. */
export function splitAddress(q: string): { number: string; rest: string } {
  const m = /^\s*((?:\d+[a-z]?\s*\/\s*)?\d+[a-z]?(?:-\d+[a-z]?)?)\b\s*(.*)$/i.exec(q);
  const number = m ? m[1]!.replace(/\s+/g, "").toUpperCase() : "";
  const rest = (m ? m[2]! : q).replace(/,/g, " ").split(/\s+/).filter(Boolean).map((w) => ROAD_WORDS[w.toLowerCase().replace(/\.$/, "")] ?? w).join(" ");
  return { number, rest };
}

/**
 * Reads one OpenStreetMap result. Keeps real addresses and streets; drops bus stops,
 * shops and the like. A street with no house number takes the number that was typed.
 */
export function parsePhoton(f: PhotonFeature, typedNumber = ""): AddressSuggestion | null {
  const p = f.properties;
  if (!p || (p.countrycode ?? "").toUpperCase() !== "AU") return null;
  const isStreet = p.type === "street" && !!p.name;
  const isHouse = p.type === "house" && !!p.housenumber && !!p.street && p.osm_key !== "highway";
  if (!isStreet && !isHouse) return null;
  if (isHouse && typedNumber && p.housenumber!.toUpperCase() !== typedNumber) return null;
  const road = isHouse ? p.street! : p.name!;
  const street = [isHouse ? p.housenumber : typedNumber, road].filter(Boolean).join(" ");
  // In Australian OpenStreetMap data the suburb is usually the "district".
  const suburb = p.district ?? p.locality ?? p.city ?? "";
  const state = STATE_ABBR[p.state ?? ""] ?? p.state ?? "";
  const postcode = p.postcode ?? "";
  return { label: [street, [suburb, state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "), street, suburb, state, postcode };
}

/** NSW and the ACT, where the business works. */
const PHOTON_BBOX = "140.9,-37.6,153.7,-28.1";

export async function photonSuggest(q: string, fetchImpl: typeof fetch = fetch): Promise<AddressSuggestion[]> {
  // The free lookup can't match a house number it doesn't know, so search the street and add the number back.
  const { number, rest } = splitAddress(q);
  if (!/[a-z]{2}/i.test(rest)) return [];
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(rest)}&limit=20&lang=en&lat=${NEAR.latitude}&lon=${NEAR.longitude}&bbox=${PHOTON_BBOX}`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "ATLAS business system (landscaping company, Sydney)" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new AddressLookupError("Address suggestions are unavailable right now.");
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const out = (json.features ?? []).map((f) => parsePhoton(f, number)).filter((x): x is AddressSuggestion => !!x);
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
