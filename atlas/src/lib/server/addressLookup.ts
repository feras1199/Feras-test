import "server-only";
import { addressProvider, AddressLookupError, demoSuggest, googleSuggest, photonSuggest, type AddressSuggestion } from "../domain/address";

const cache = new Map<string, { at: number; hits: AddressSuggestion[] }>();
const CACHE_MS = 10 * 60_000;
const recent = new Map<string, number[]>();

/** 60 lookups a minute per person is plenty for typing; it stops a stuck page running up a bill. */
export function addressRateLimited(uid: string, now = Date.now()) {
  const list = (recent.get(uid) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(uid, list);
  return list.length > 60;
}

export async function suggestAddresses(q: string): Promise<{ provider: ReturnType<typeof addressProvider>; suggestions: AddressSuggestion[] }> {
  const provider = addressProvider();
  const key = `${provider}:${q.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { provider, suggestions: hit.hits };
  let suggestions: AddressSuggestion[] = [];
  if (provider === "google") suggestions = await googleSuggest(q, process.env.GOOGLE_MAPS_API_KEY!);
  else if (provider === "photon") suggestions = await photonSuggest(q);
  else if (provider === "demo") suggestions = demoSuggest(q);
  suggestions = suggestions.slice(0, 6);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), hits: suggestions });
  return { provider, suggestions };
}

export { AddressLookupError };
