import { HttpError, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { getRepo } from "@/lib/server/context";
import { hashPassword } from "@/lib/auth/password";
import { allUsers } from "@/lib/auth/users";
import { peopleStore, PersonUpdate } from "@/lib/server/people";

/** Change role, name, linked customer, reset a password, or switch a login off/on. */
export const PATCH = route<{ id: string }>("users.manage", async ({ req, params, session }) => {
  const i = PersonUpdate.parse(await req.json());
  const store = peopleStore();
  const current = (await allUsers()).find((u) => u.id === params.id);
  if (!current) throw new HttpError(404, "Login not found");
  if (current.source !== "database") throw new HttpError(409, "This login is set on the server (host variables) and can't be changed here");
  if (current.id === session.uid && (i.active === false || (i.role && i.role !== current.role))) throw new HttpError(409, "You can't switch off or change the role of your own login");
  const role = i.role ?? current.role;
  const customerId = i.customerId === undefined ? current.customerId : i.customerId ?? undefined;
  if (role === "customer" && !customerId) throw new HttpError(400, "A customer login needs a linked customer");
  if (role === "customer" && customerId && customerId !== current.customerId && !(await getRepo().get("customers", customerId))) throw new HttpError(400, "That customer record wasn't found");
  const updated = await store.updateUser(params.id, {
    name: i.name,
    role: i.role,
    ...(i.customerId !== undefined || i.role ? { customerId: role === "customer" ? customerId : undefined } : {}),
    active: i.active,
    passwordHash: i.password ? await hashPassword(i.password) : undefined,
  });
  const { password: _p, ...shown } = i;
  audit(session, { action: "user.update", entity: "users", recordId: params.id, summary: `Updated login for ${current.name}${i.password ? " (password reset)" : ""}${i.active === false ? " (switched off)" : i.active ? " (switched on)" : ""}`, before: { role: current.role, active: current.active, customerId: current.customerId }, after: shown });
  return { person: updated && { id: updated.id, name: updated.name, email: updated.email, role: updated.role, customerId: updated.customerId, active: updated.active, source: "database" } };
});
