import { NextResponse } from "next/server";
import { getRepo } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/**
 * For the host's health check. Says only whether ATLAS can reach its data store;
 * it needs no sign-in and gives nothing else away.
 */
export async function GET() {
  try {
    const repo = getRepo() as { ping?: () => Promise<void> };
    await repo.ping?.();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(JSON.stringify({ type: "atlas.health", error: String(e) }));
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
