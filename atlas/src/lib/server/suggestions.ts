import "server-only";
import type { Repository } from "../data/repository";
import { firstPhrase, rankDistinct, STARTERS, type SuggestionKind } from "../domain/suggestions";
import { allUsers } from "../auth/users";

/** Builds the suggestion lists a form needs from what's already saved. */
export async function loadSuggestions<K extends SuggestionKind>(repo: Repository, kinds: K[]): Promise<Record<K, string[]>> {
  const out = {} as Record<K, string[]>;
  for (const k of kinds) {
    let values: (string | null | undefined)[] = [];
    if (k === "suburbs") values = (await repo.list("customers")).map((c) => c.suburb);
    else if (k === "services") values = (await repo.list("enquiries")).map((e) => firstPhrase(e.serviceRequested));
    else if (k === "nextActions") values = (await repo.list("enquiries")).map((e) => e.nextAction);
    else if (k === "areas") values = (await repo.list("measurements")).map((m) => m.zone);
    else if (k === "taskTitles") values = (await repo.list("tasks")).map((t) => t.title).filter((t) => (t ?? "").length <= 40);
    else if (k === "units") values = (await repo.list("costItems")).map((c) => c.unit);
    else if (k === "categories") values = (await repo.list("costItems")).map((c) => c.category);
    else if (k === "suppliers") values = (await repo.list("costItems")).map((c) => c.supplier);
    else if (k === "people") values = [...(await allUsers()).filter((u) => u.active && u.role !== "customer").map((u) => u.name), ...(await repo.list("tasks")).map((t) => t.assignedTo)];
    out[k] = rankDistinct(values, STARTERS[k]);
  }
  return out;
}
