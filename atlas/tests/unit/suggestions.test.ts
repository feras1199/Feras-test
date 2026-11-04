import { describe, expect, it, vi } from "vitest";
import { addressProvider, demoSuggest, googleSuggest, lookupWorthy, parseGoogle, parsePhoton, photonSuggest, splitAddress } from "@/lib/domain/address";
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
  it("uses Google with a key, the free lookup without one (demo site too), made-up addresses only for tests, or nothing when switched off", () => {
    expect(addressProvider({ GOOGLE_MAPS_API_KEY: "k", ATLAS_DATA_SOURCE: "postgres" } as never)).toBe("google");
    expect(addressProvider({ ATLAS_DATA_SOURCE: "postgres" } as never)).toBe("photon");
    expect(addressProvider({} as never)).toBe("photon");
    expect(addressProvider({ ATLAS_ADDRESS_DEMO: "1" } as never)).toBe("demo");
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

  it("splits off the house number and spells out road abbreviations", () => {
    expect(splitAddress("135 Phillip St, Waterloo")).toEqual({ number: "135", rest: "Phillip Street Waterloo" });
    expect(splitAddress("2/14a sample rd")).toEqual({ number: "2/14A", rest: "sample Road" });
    expect(splitAddress("Phillip")).toEqual({ number: "", rest: "Phillip" });
    expect(splitAddress("13")).toEqual({ number: "13", rest: "" });
  });

  // Shapes copied from live photon.komoot.io answers for "Phillip St Waterl" (4 Nov 2026).
  const f = (p: Record<string, string>) => ({ properties: { countrycode: "AU", state: "New South Wales", city: "Sydney", ...p } });
  const LIVE = [
    f({ osm_key: "highway", type: "house", name: "Elizabeth St at Phillip St", street: "Elizabeth Street", district: "Waterloo", postcode: "2017" }),
    f({ osm_key: "highway", type: "street", name: "Phillip Street", district: "Waterloo", postcode: "2017" }),
    f({ osm_key: "highway", type: "street", name: "Phillip Street", district: "Waterloo", postcode: "2017" }),
    f({ osm_key: "highway", type: "street", name: "Phillip Street", locality: "Wynyard", district: "Sydney", postcode: "2000" }),
    f({ osm_key: "building", type: "house", housenumber: "12", street: "Macquarie Street", locality: "Cromer Heights", district: "Cromer", postcode: "2099" }),
    { properties: { countrycode: "CA", type: "house", housenumber: "135", street: "Phil Chris Way", city: "Winnipeg" } },
  ];

  it("searches the street without the number, keeps NSW addresses and streets, drops bus stops and repeats, and puts the typed number back", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ features: LIVE })));
    const out = await photonSuggest("135 Phillip St Waterl", fetchImpl as never);
    expect(out.map((o) => o.label)).toEqual(["135 Phillip Street, Waterloo NSW 2017", "135 Phillip Street, Sydney NSW 2000"]);
    expect(out[0]).toMatchObject({ street: "135 Phillip Street", suburb: "Waterloo", state: "NSW", postcode: "2017" });
    const url = String((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url).toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?q=Phillip%20Street%20Waterl&/);
    expect(url).toContain("bbox=140.9,-37.6,153.7,-28.1");
  });

  it("uses a real house when the numbers match, and its suburb", () => {
    expect(parsePhoton(LIVE[4]!, "12")).toMatchObject({ street: "12 Macquarie Street", suburb: "Cromer", postcode: "2099" });
    expect(parsePhoton(LIVE[4]!, "14")).toBeNull();
    expect(parsePhoton(LIVE[0]!)).toBeNull();
    expect(parsePhoton(LIVE[5]! as never)).toBeNull();
  });

  it("doesn't look anything up for a house number alone", async () => {
    const fetchImpl = vi.fn();
    expect(await photonSuggest("135", fetchImpl as never)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("demo addresses keep the typed house number", () => {
    expect(demoSuggest("135 exa")[0]).toEqual({ label: "135 Example Street, Waterloo NSW 2017", street: "135 Example Street", suburb: "Waterloo", state: "NSW", postcode: "2017" });
    expect(demoSuggest("12 penr")[0]?.suburb).toBe("Penrith");
  });
});
