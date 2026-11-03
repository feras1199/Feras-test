import { HttpError, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { allUsers } from "@/lib/auth/users";
import { PasswordChange, peopleStore } from "@/lib/server/people";

/** Anyone added in the app can change their own password. */
export const POST = route("signed-in", async ({ req, session }) => {
  const i = PasswordChange.parse(await req.json());
  const me = (await allUsers()).find((u) => u.id === session.uid);
  if (!me || me.source !== "database") throw new HttpError(409, "Your password is set on the server, so it can't be changed here. Ask the owner.");
  if (!(await verifyPassword(i.current, me.passwordHash))) throw new HttpError(400, "Your current password isn't right");
  await peopleStore().updateUser(me.id, { passwordHash: await hashPassword(i.next) });
  audit(session, { action: "user.password", entity: "users", recordId: me.id, summary: `${me.name} changed their password` });
  return { ok: true };
});
