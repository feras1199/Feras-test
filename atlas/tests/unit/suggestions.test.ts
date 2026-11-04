import { describe, expect, it, vi } from "vitest";
import { addressProvider, demoSuggest, googleSuggest, lookupWorthy, parseGoogle, parsePhoton, photonSuggest } from "@/lib/domain/address";
import { firstPhrase, matchSuggestions, rankDistinct } from "@/lib/domain/suggestions";

describe("suggestion lists", () => {
  it("puts the most used first, in the most used spelling, then the starters", () => {
    expect(rankDistinct(["Castle Hill", "castle hill", "Castle Hill", "Penrith", " ", null, "Kellyville", "Penrith"], ["Waterloo", "penrith"])).toEqual(["Castle Hill", "Penrith", "Kellyville", "Waterloo"]);
  });

  it("matches every typed word at the start of a word, and leaves out an exact match", () => {
    const opts = ["Front yard", "Front lawn", "Backyard", "Rear patio", "Side path"];
    expect(matchSuggestions(opts, "fr")).toEqual(["Front yard", "Front lawn"]);
    expect(matchSuggestions(opts, "front l")).toEqual(["Front lawn"]);
    expect(matchSuggestions(opts, "Front lawn")).toEqual([]);
    expect(matchSuggestions(opts, "")).toHaveLength(5);
    expect(matchSuggestions(["Sir Walter turf", "Turf underlay"], "tu")[0]).toBe("Turf underlay");
  });

  it("takes the short first phrase of a request", () => {
    expect(firstPhrase("Paving and new turf, about 60 m²")).toBe("Paving and new turf");
    expect(firstPhrase("A very long request that goes on and on about many different things")).toBe("");
  });
});

describe("address suggestions", () => {
  it("uses Google with a key, the free lookup without one, demo addresses in demo mode, or nothing when switched off", () => {
    expect(addressProvider({ GOOGLE_MAPS_API_KEY: "k", ATLAS_DATA_SOURCE: "postgres" } as never)).toBe("google");
    expect(addressProvider({ ATLAS_DATA_SOURCE: "postgres" } as never)).toBe("photon");
    expect(addressProvider({} as never)).toBe("demo");
    expect(addressProvider({ GOOGLE_MAPS_API_KEY: "k", ATLAS_ADDRESS_LOOKUP: "off" } as never)).toBe("off");
  });

  it("only looks up once there are some letters", () => {
    expect(lookupWorthy("135")).toBe(false);
    expect(lookupWorthy("135 P")).toBe(false);
    expect(lookupWorthy("135 Ph")).toBe(true);
  });

  it("reads Google's two lines into street, suburb and state", () => {
    expect(parseGoogle("135 Phillip St", "Waterloo NSW, Australia")).toEqual({ label: "135 Phillip St, Waterloo NSW", street: "135 Phillip St", suburb: "Waterloo", state: "NSW", postcode: "" });
    expect(parseGoogle("2/14 Example Rd", "Castle Hill NSW 2154, Australia")?.postcode).toBe("2154");
    expect(parseGoogle("1 Queen St", "Auckland, New Zealand")).toBeNull();
  });

  it("asks Google for Australian results near Sydney and sends the key in a header, not the address bar", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ suggestions: [{ placePrediction: { structuredFormat: { mainText: { text: "135 Phillip St" }, secondaryText: { text: "Waterloo NSW, Australia" } } } }] })));
    const out = await googleSuggest("135 phil", "KEY", fetchImpl as never);
    expect(out[0]).toMatchObject({ street: "135 Phillip St", suburb: "Waterloo" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(url).not.toContain("KEY");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(JSON.parse(String(init.body))).toMatchObject({ input: "135 phil", includedRegionCodes: ["au"] });
  });

  it("says plainly when Google rejects the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(googleSuggest("135 phil", "BAD", fetchImpl as never)).rejects.toThrow(/key was rejected/);
  });

  it("reads OpenStreetMap results, keeps Australia only and drops repeats", async () => {
    const f = (p: Record<string, string>) => ({ properties: p });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ features: [
      f({ countrycode: "AU", housenumber: "135", street: "Phillip Street", locality: "Waterloo", city: "Sydney", state: "New South Wales", postcode: "2017" }),
      f({ countrycode: "AU", housenumber: "135", street: "Phillip Street", locality: "Waterloo", city: "Sydney", state: "New South Wales", postcode: "2017" }),
      f({ countrycode: "NZ", housenumber: "135", street: "Phillip Street", city: "Auckland" }),
    ] })));
    const out = await photonSuggest("135 phillip", fetchImpl as never);
    expect(out).toEqual([{ label: "135 Phillip Street, Waterloo NSW 2017", street: "135 Phillip Street", suburb: "Waterloo", state: "NSW", postcode: "2017" }]);
    expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?q=135%20phillip/);
    expect(parsePhoton(f({ countrycode: "AU" }))).toBeNull();
  });

  it("demo addresses keep the typed house number", () => {
    expect(demoSuggest("135 exa")[0]).toEqual({ label: "135 Example Street, Waterloo NSW 2017", street: "135 Example Street", suburb: "Waterloo", state: "NSW", postcode: "2017" });
    expect(demoSuggest("12 penr")[0]?.suburb).toBe("Penrith");
  });
});
