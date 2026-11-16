import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, passwordVersion } from "@/lib/auth/users";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { sessionSecret } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

// Simple per-process throttle: 8 failed attempts per email+IP per 15 minutes.
const failures = new Map<string, { n: number; until: number }>();

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${parsed.data.email.toLowerCase()}|${ip}`;
  const f = failures.get(key);
  if (f && f.n >= 8 && f.until > Date.now()) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    failures.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    audit(null, { action: "login.failed", summary: `Failed sign-in for ${parsed.data.email}` });
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }
  failures.delete(key);
  const token = await signSession({ uid: user.id, name: user.name, role: user.role, customerId: user.customerId, pv: passwordVersion(user) }, sessionSecret());
  audit({ uid: user.id, name: user.name, role: user.role }, { action: "login.success", summary: `${user.name} signed in` });
  const res = NextResponse.json({ ok: true, redirect: user.role === "customer" ? "/portal" : "/" });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS });
  return res;
}
