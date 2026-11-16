import "server-only";
import { z } from "zod";
import { ROLES } from "../auth/roles";
import { allUsers, type UserSource } from "../auth/users";
import { PostgresRepository } from "../data/postgres/repository";
import { HttpError } from "./api";
import { getRepo } from "./context";

/** A login as the People screen shows it. Password hashes never leave the server. */
export interface PersonView { id: string; name: string; email: string; role: (typeof ROLES)[number]; customerId?: string; active: boolean; source: UserSource }

export async function listPeople(): Promise<PersonView[]> {
  return (await allUsers()).map(({ id, name, email, role, customerId, active, source }) => ({ id, name, email, role, customerId, active, source }));
}

/** Logins can only be added in the app when ATLAS runs on its own database. */
export function peopleStore(): PostgresRepository {
  const repo = getRepo();
  if (!(repo instanceof PostgresRepository)) throw new HttpError(409, "Adding people in the app needs ATLAS's own database. In this mode, logins come from ATLAS_USERS_JSON.");
  return repo;
}

const Password = z.string().min(10, "Passwords need at least 10 characters").max(200);

export const PersonCreate = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(200),
    role: z.enum(ROLES),
    customerId: z.string().regex(/^rec[A-Za-z0-9]{14}$/).optional(),
    password: Password,
  })
  .refine((p) => p.role !== "customer" || !!p.customerId, { message: "Pick which customer this login is for", path: ["customerId"] });

export const PersonUpdate = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  customerId: z.string().regex(/^rec[A-Za-z0-9]{14}$/).nullable().optional(),
  active: z.boolean().optional(),
  password: Password.optional(),
});

export const PasswordChange = z.object({ current: z.string().min(1).max(200), next: Password });
