import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { can, type Permission } from "../auth/roles";
import type { SessionPayload } from "../auth/session";
import { currentSession } from "./context";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** No form in ATLAS sends anywhere near this; it stops oversized payloads before they are parsed. */
const MAX_BODY_BYTES = 256 * 1024;

type Handler<P> = (ctx: { session: SessionPayload; req: NextRequest; params: P }) => Promise<unknown>;

/**
 * Wrap a route handler: checks the session and permission on the server,
 * rejects cross-site writes, and turns errors into JSON without leaking internals.
 */
export function route<P = Record<string, string>>(perm: Permission, handler: Handler<P>, opts: { maxBodyBytes?: number } = {}) {
  const maxBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.headers.get("host")) throw new HttpError(403, "Cross-site request blocked");
        if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new HttpError(413, "That request is too large");
      }
      const session = await currentSession();
      if (!session) throw new HttpError(401, "Please sign in");
      if (!can(session.role, perm)) throw new HttpError(403, "You don't have permission to do that");
      const data = await handler({ session, req, params: await ctx.params });
      if (data instanceof Response) return data; // e.g. a file download
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...("dupes" in e ? { dupes: (e as { dupes: unknown }).dupes } : {}), ...("blocking" in e ? { blocking: (e as { blocking: unknown }).blocking } : {}) }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      console.error(e);
      const msg = e instanceof Error && /Airtable|calculated|expects/.test(e.message) ? e.message : "Something went wrong. Nothing was saved.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}
