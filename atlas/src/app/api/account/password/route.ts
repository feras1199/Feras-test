import { HttpError, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { allUsers, passwordVersion } from "@/lib/auth/users";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { sessionSecret } from "@/lib/server/context";
import { PasswordChange, peopleStore } from "@/lib/server/people";

/** Anyone added in the app can change their own password. */
export const POST = route("signed-in", async ({ req, session }) => {
  const i = PasswordChange.parse(await req.json());
  const me = (await allUsers()).find((u) => u.id === session.uid);
  if (!me || me.source !== "database") throw new HttpError(409, "Your password is set on the server, so it can't be changed here. Ask the owner.");
  if (!(await verifyPassword(i.current, me.passwordHash))) throw new HttpError(400, "Your current password isn't right");
  const passwordHash = await hashPassword(i.next);
  await peopleStore().updateUser(me.id, { passwordHash });
  audit(session, { action: "user.password", entity: "users", recordId: me.id, summary: `${me.name} changed their password` });
  // Every session opened with the old password is now signed out. This one carries on:
  // it gets a fresh cookie for the time it had left.
  const ttl = Math.max(60, session.exp - Math.floor(Date.now() / 1000));
  const token = await signSession({ uid: session.uid, name: session.name, role: session.role, customerId: session.customerId, pv: passwordVersion({ passwordHash }) }, sessionSecret(), ttl);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ttl });
  return res;
});
