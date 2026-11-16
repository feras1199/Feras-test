import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { currentSession, getRepo } from "@/lib/server/context";
import { acceptEstimate } from "@/lib/server/estimates";
import { HttpError } from "@/lib/server/api";

const Body = z.object({ fullName: z.string().trim().min(2).max(120), agree: z.literal(true) });

/** A customer accepts their own quote. Records who typed their name and when, from which IP. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentSession();
  if (!s || s.role !== "customer" || !s.customerId) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type your full name and tick the box to accept" }, { status: 400 });
  const { id } = await ctx.params;
  const repo = getRepo();
  const e = await repo.get("estimates", id);
  if (!e || !e.customerIds?.includes(s.customerId)) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await acceptEstimate(repo, e, { uid: s.uid, name: s.name, role: s.role }, `${parsed.data.fullName} (portal, IP ${ip})`, "Customer portal");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Nothing was accepted. Please call us." }, { status: 500 });
  }
}
