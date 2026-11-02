import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/_next\//, /^\/favicon/, /^\/brand\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const secret = process.env.ATLAS_SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-only-secret-not-for-production-use-0123456789");
  const session = secret ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  // Customers only ever reach the portal; staff never land in it by accident.
  const isPortal = pathname.startsWith("/portal") || pathname.startsWith("/api/portal");
  if (session.role === "customer" && !isPortal && !pathname.startsWith("/api/auth")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not available" }, { status: 403 });
    return NextResponse.redirect(new URL("/portal", req.url));
  }
  if (session.role !== "customer" && isPortal) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not available" }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
