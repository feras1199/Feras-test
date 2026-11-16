import { HttpError, route } from "@/lib/server/api";
import { addressRateLimited, AddressLookupError, suggestAddresses } from "@/lib/server/addressLookup";
import { ADDRESS_ATTRIBUTION, lookupWorthy } from "@/lib/domain/address";

/** Address suggestions for the Street address box. Only what's typed is sent on; nothing is saved. */
export const GET = route("crm.edit", async ({ req, session }) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!lookupWorthy(q)) return { suggestions: [], attribution: "" };
  if (addressRateLimited(session.uid)) throw new HttpError(429, "Slow down a little, then try again.");
  try {
    const { provider, suggestions } = await suggestAddresses(q);
    return { suggestions, attribution: suggestions.length ? ADDRESS_ATTRIBUTION[provider] : "" };
  } catch (e) {
    if (e instanceof AddressLookupError) throw new HttpError(502, e.message);
    throw new HttpError(502, "Address suggestions are unavailable right now. Type the address in full.");
  }
});
