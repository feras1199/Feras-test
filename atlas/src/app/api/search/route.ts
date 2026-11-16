import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { searchRecords } from "@/lib/server/search";

export const GET = route("dashboard.view", async ({ req, session }) => {
  return { hits: await searchRecords(getRepo(), session.role, req.nextUrl.searchParams.get("q") ?? "") };
});
