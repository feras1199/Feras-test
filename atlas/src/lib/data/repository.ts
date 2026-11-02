import type { EntityName, Rec } from "./entities";

export interface ListOptions<E extends EntityName> {
  where?: (r: Rec<E>) => boolean;
  sort?: (a: Rec<E>, b: Rec<E>) => number;
  limit?: number;
}

/**
 * The only way the app reads or writes business data. Implementations:
 * AirtableRepository (production) and MemoryRepository (tests and demo, fictional data).
 * There is deliberately no hard delete: records are archived by status.
 */
export interface Repository {
  readonly source: "airtable" | "memory";
  list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]>;
  get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null>;
  create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>>;
  update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>>;
}

export function applyListOptions<E extends EntityName>(rows: Rec<E>[], opts?: ListOptions<E>): Rec<E>[] {
  let out = opts?.where ? rows.filter(opts.where) : rows.slice();
  if (opts?.sort) out.sort(opts.sort);
  if (opts?.limit) out = out.slice(0, opts.limit);
  return out;
}
