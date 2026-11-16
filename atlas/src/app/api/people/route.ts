import { HttpError, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { getRepo } from "@/lib/server/context";
import { hashPassword } from "@/lib/auth/password";
import { allUsers } from "@/lib/auth/users";
import { listPeople, peopleStore, PersonCreate } from "@/lib/server/people";

export const GET = route("users.manage", async () => ({ people: await listPeople() }));

/** Owner adds a staff member or a customer login. They get a password the owner passes on. */
export const POST = route("users.manage", async ({ req, session }) => {
  const i = PersonCreate.parse(await req.json());
  const store = peopleStore();
  if ((await allUsers()).some((u) => u.email.toLowerCase() === i.email.toLowerCase())) throw new HttpError(409, "Someone already signs in with that email");
  if (i.role === "customer" && !(await getRepo().get("customers", i.customerId!))) throw new HttpError(400, "That customer record wasn't found");
  let person;
  try {
    person = await store.createUser({ name: i.name, email: i.email, role: i.role, customerId: i.role === "customer" ? i.customerId : undefined, passwordHash: await hashPassword(i.password) });
  } catch (e) {
    if ((e as Error).message === "email taken") throw new HttpError(409, "Someone already signs in with that email");
    throw e;
  }
  audit(session, { action: "user.create", entity: "users", recordId: person.id, summary: `Added login for ${i.name} (${i.role})`, after: { name: i.name, email: i.email, role: i.role, customerId: i.customerId } });
  return { person: { id: person.id, name: person.name, email: person.email, role: person.role, customerId: person.customerId, active: person.active, source: "database" } };
});
