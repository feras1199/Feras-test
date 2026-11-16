import "server-only";
import { ENTITIES, type EntityName, type Rec } from "../data/entities";
import { fileStoreOf, recycleBinOf, type DeletedBatch, type DeletedRecord, type RemovedLink, type Repository } from "../data/repository";
import { can } from "../auth/roles";
import type { SessionPayload } from "../auth/session";
import { HttpError } from "./api";
import { audit } from "./audit";

/**
 * Deleting records safely.
 *
 * Rules:
 * - Deleting a record also deletes what belongs to it (its children below), so
 *   nothing is left pointing at a record that no longer exists. Deleting a
 *   customer takes their enquiries, inspections, estimates, projects and tasks;
 *   a project takes its payment stages, costs, time, schedule and so on.
 * - Links from records that are kept (e.g. an inspection that also named a
 *   deleted enquiry) are removed, not the kept record.
 * - Nothing is lost: everything goes to the recycle bin and can be put back from
 *   Settings > Recently deleted.
 * - Main records (customers, enquiries, inspections, estimates, projects) can
 *   only be deleted by the owner. Small items (tasks, measurements, schedule
 *   entries) by whoever can edit them.
 * - If money is involved (an accepted quote, a paid stage, recorded costs or
 *   time), the person must type DELETE to confirm.
 */

/** Which link fields make a record belong to another. child entity -> its owning link fields. */
const OWNED_BY: Partial<Record<EntityName, string[]>> = {
  enquiries: ["customerIds"],
  tasks: ["customerIds", "enquiryIds", "projectIds"],
  inspections: ["customerIds"],
  measurements: ["inspectionIds"],
  estimates: ["customerIds"],
  estimateLines: ["estimateIds"],
  projects: ["customerIds"],
  components: ["projectIds"],
  actualCosts: ["projectIds"],
  timesheets: ["projectIds"],
  payments: ["projectIds"],
  invoices: ["customerIds", "projectIds"],
  variations: ["projectIds"],
  schedule: ["projectIds"],
  checklists: ["projectIds"],
  clientUpdates: ["projectIds"],
  communications: ["customerIds", "projectIds"],
  files: ["customerIds", "projectIds"],
};

/** What can be deleted directly, who may do it, and how it is named. */
export const DELETABLE = {
  customers: { perm: "records.delete", noun: "customer" },
  enquiries: { perm: "records.delete", noun: "enquiry" },
  inspections: { perm: "records.delete", noun: "site inspection" },
  estimates: { perm: "records.delete", noun: "estimate" },
  projects: { perm: "records.delete", noun: "project" },
  tasks: { perm: "crm.edit", noun: "task" },
  measurements: { perm: "inspections.edit", noun: "measurement" },
  schedule: { perm: "schedule.edit", noun: "schedule entry" },
} as const satisfies Partial<Record<EntityName, { perm: Parameters<typeof can>[1]; noun: string }>>;
export type DeletableEntity = keyof typeof DELETABLE;
export const isDeletable = (e: string): e is DeletableEntity => e in DELETABLE;

const NOUNS: Partial<Record<EntityName, [string, string]>> = {
  customers: ["customer", "customers"],
  enquiries: ["enquiry", "enquiries"],
  tasks: ["task", "tasks"],
  inspections: ["site inspection", "site inspections"],
  measurements: ["measurement", "measurements"],
  estimates: ["estimate", "estimates"],
  estimateLines: ["estimate line", "estimate lines"],
  projects: ["project", "projects"],
  components: ["project component", "project components"],
  actualCosts: ["recorded cost", "recorded costs"],
  timesheets: ["timesheet entry", "timesheet entries"],
  payments: ["payment stage", "payment stages"],
  invoices: ["invoice or claim", "invoices and claims"],
  variations: ["variation", "variations"],
  schedule: ["schedule entry", "schedule entries"],
  checklists: ["checklist", "checklists"],
  clientUpdates: ["customer update", "customer updates"],
  communications: ["contact log entry", "contact log entries"],
  files: ["project file", "project files"],
};
export const nounFor = (e: EntityName, n: number) => (NOUNS[e] ?? [e, e])[n === 1 ? 0 : 1];

function labelOf(entity: EntityName, r: Rec<EntityName>): string {
  const primary = ENTITIES[entity].primary;
  return String((r as Record<string, unknown>)[primary] ?? "").trim() || "untitled";
}

const linkFields = (entity: EntityName) => Object.entries(ENTITIES[entity].fields).filter(([, f]) => f.kind === "links").map(([k]) => k);

export interface DeletePlan {
  root: { entity: EntityName; id: string; label: string };
  /** Everything that will be deleted, root first. */
  records: { entity: EntityName; rec: Rec<EntityName> }[];
  unlinks: RemovedLink[];
  /** Counts of what goes with the root, in words, e.g. "2 site inspections". */
  alsoDeleted: string[];
  /** Why typing DELETE is needed, if money is involved. */
  money: string[];
}

/** Works out what deleting this record would remove, without changing anything. */
export async function planDelete(repo: Repository, entity: EntityName, id: string): Promise<DeletePlan> {
  const root = await repo.get(entity, id);
  if (!root) throw new HttpError(404, `That ${nounFor(entity, 1)} no longer exists`);
  const cache = new Map<EntityName, Rec<EntityName>[]>();
  const all = async (e: EntityName) => {
    if (!cache.has(e)) cache.set(e, (await repo.list(e)) as Rec<EntityName>[]);
    return cache.get(e)!;
  };

  const doomed = new Map<string, { entity: EntityName; rec: Rec<EntityName> }>();
  const key = (e: EntityName, i: string) => `${e}:${i}`;
  doomed.set(key(entity, id), { entity, rec: root as Rec<EntityName> });
  const queue: { entity: EntityName; id: string }[] = [{ entity, id }];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const [child, fields] of Object.entries(OWNED_BY) as [EntityName, string[]][]) {
      // A link field points at one kind of record; only follow fields that point at the parent's kind.
      const relevant = fields.filter((f) => FIELD_TARGET[f] === parent.entity);
      if (!relevant.length) continue;
      for (const r of await all(child)) {
        if (doomed.has(key(child, r.id))) continue;
        if (relevant.some((f) => ((r as Record<string, unknown>)[f] as string[] | undefined)?.includes(parent.id))) {
          doomed.set(key(child, r.id), { entity: child, rec: r });
          queue.push({ entity: child, id: r.id });
        }
      }
    }
  }

  // Links from kept records to deleted ones are removed so nothing points at a missing record.
  const goneIds = new Set([...doomed.values()].map((d) => d.rec.id));
  const unlinks: RemovedLink[] = [];
  for (const e of Object.keys(ENTITIES) as EntityName[]) {
    const fields = linkFields(e);
    if (!fields.length) continue;
    for (const r of await all(e)) {
      if (doomed.has(key(e, r.id))) continue;
      for (const f of fields) {
        const v = (r as Record<string, unknown>)[f];
        if (!Array.isArray(v)) continue;
        const hit = v.filter((x) => goneIds.has(x));
        if (hit.length) unlinks.push({ entity: e, id: r.id, field: f, ids: hit });
      }
    }
  }

  const records = [...doomed.values()];
  const counts = new Map<EntityName, number>();
  for (const d of records.slice(1)) counts.set(d.entity, (counts.get(d.entity) ?? 0) + 1);
  const alsoDeleted = [...counts].map(([e, n]) => `${n} ${nounFor(e, n)}`);

  const money: string[] = [];
  const of = <E extends EntityName>(e: E) => records.filter((d) => d.entity === e).map((d) => d.rec as Rec<E>);
  const accepted = of("estimates").filter((e) => e.status === "Accepted");
  if (accepted.length) money.push(`${accepted.length} accepted quote${accepted.length > 1 ? "s" : ""}`);
  const paid = of("payments").filter((p) => p.status === "Paid");
  if (paid.length) money.push(`${paid.length} payment${paid.length > 1 ? "s" : ""} already received`);
  if (of("invoices").length) money.push("invoices or claims");
  if (of("actualCosts").length) money.push("recorded job costs");
  if (of("timesheets").length) money.push("logged staff time");

  return { root: { entity, id, label: labelOf(entity, root as Rec<EntityName>) }, records, unlinks, alsoDeleted, money };
}

/** Which kind of record each link field points at. */
const FIELD_TARGET: Record<string, EntityName> = {
  customerIds: "customers",
  enquiryIds: "enquiries",
  projectIds: "projects",
  inspectionIds: "inspections",
  estimateIds: "estimates",
};

export function checkDeletePermission(session: SessionPayload, entity: DeletableEntity) {
  const rule = DELETABLE[entity];
  if (!can(session.role, rule.perm)) throw new HttpError(403, rule.perm === "records.delete" ? `Only the owner can delete a ${rule.noun}` : `You don't have permission to delete a ${rule.noun}`);
}

/** Deletes the record and what belongs to it, keeping a copy in the recycle bin. All or nothing. */
export async function deleteRecord(repo: Repository, session: SessionPayload, entity: DeletableEntity, id: string, confirm: unknown): Promise<{ batch: DeletedBatch; plan: DeletePlan }> {
  checkDeletePermission(session, entity);
  if (!recycleBinOf(repo)) throw new HttpError(409, "Deleting needs ATLAS's own database (it isn't available in Airtable mode)");
  const out = await repo.atomic("records:delete", async (tx) => {
    const bin = recycleBinOf(tx)!;
    const plan = await planDelete(tx, entity, id);
    if (plan.money.length && confirm !== "DELETE") throw Object.assign(new HttpError(400, `This includes ${plan.money.join(", ")}. Type DELETE to confirm.`), { blocking: plan.money });
    if (!plan.money.length && confirm !== true && confirm !== "DELETE") throw new HttpError(400, "Confirm the delete first");

    for (const u of plan.unlinks) {
      const now = (await tx.get(u.entity, u.id)) as Record<string, unknown> | null;
      if (!now) continue;
      const kept = ((now[u.field] as string[] | undefined) ?? []).filter((x) => !u.ids.includes(x));
      await tx.update(u.entity, u.id, { [u.field]: kept } as never);
    }

    // Photos and recordings of deleted records are hidden with them (and come back on restore).
    const fileIds: string[] = [];
    const files = fileStoreOf(tx);
    if (files) {
      for (const d of plan.records) {
        for (const f of await files.listFiles(d.entity, d.rec.id)) {
          if (f.archived) continue;
          await files.setFileArchived(f.id, true);
          fileIds.push(f.id);
        }
      }
    }

    // A deleted customer's portal login is switched off.
    const userIds: string[] = [];
    const people = tx as Partial<{ listUsers(): Promise<{ id: string; customerId?: string; active: boolean }[]>; updateUser(id: string, p: { active: boolean }): Promise<unknown> }>;
    const customerIds = new Set(plan.records.filter((d) => d.entity === "customers").map((d) => d.rec.id));
    if (customerIds.size && people.listUsers && people.updateUser) {
      for (const u of await people.listUsers()) {
        if (u.active && u.customerId && customerIds.has(u.customerId)) {
          await people.updateUser(u.id, { active: false });
          userIds.push(u.id);
        }
      }
    }

    const records: DeletedRecord[] = plan.records.map(({ entity: e, rec }) => {
      const { id: rid, createdTime, ...data } = rec as Record<string, unknown> & { id: string; createdTime: string };
      return { entity: e, id: rid, createdTime, data };
    });
    const batch = await bin.moveToBin({
      by: session.name,
      label: plan.root.label.toLowerCase().includes(nounFor(entity, 1)) ? plan.root.label : `${capitalise(nounFor(entity, 1))} ${plan.root.label}`,
      rootEntity: entity,
      rootId: id,
      records,
      unlinks: plan.unlinks,
      fileIds,
      userIds,
    });
    return { batch, plan };
  });
  audit(session, {
    action: `${singular(entity)}.delete`,
    entity,
    recordId: id,
    summary: `Deleted ${nounFor(entity, 1)} ${out.plan.root.label}${out.plan.alsoDeleted.length ? `, with ${out.plan.alsoDeleted.join(", ")}` : ""}. It can be restored from Settings > Recently deleted.`,
    before: { recycleBin: out.batch.id, records: out.batch.records.map((r) => `${r.entity}:${r.id}`) },
  });
  return out;
}

/** Puts a deleted batch back, with its links, photos and portal logins. Owner only. */
export async function restoreDeleted(repo: Repository, session: SessionPayload, batchId: string) {
  if (!can(session.role, "records.delete")) throw new HttpError(403, "Only the owner can restore deleted records");
  if (!recycleBinOf(repo)) throw new HttpError(409, "The recycle bin needs ATLAS's own database");
  const out = await repo.atomic("records:delete", async (tx) => {
    const bin = recycleBinOf(tx)!;
    const b = await bin.getBinBatch(batchId);
    if (!b) throw new HttpError(404, "That delete isn't in the recycle bin");
    if (b.restoredAt) throw new HttpError(409, `Already restored by ${b.restoredBy ?? "someone"}`);
    const res = await bin.restoreFromBin(batchId, session.name);
    for (const u of b.unlinks) {
      const now = (await tx.get(u.entity, u.id)) as Record<string, unknown> | null;
      if (!now) continue;
      const cur = (now[u.field] as string[] | undefined) ?? [];
      await tx.update(u.entity, u.id, { [u.field]: [...cur, ...u.ids.filter((x) => !cur.includes(x))] } as never);
    }
    const files = fileStoreOf(tx);
    if (files) for (const f of b.fileIds) await files.setFileArchived(f, false);
    const people = tx as Partial<{ updateUser(id: string, p: { active: boolean }): Promise<unknown> }>;
    if (people.updateUser) for (const u of b.userIds) await people.updateUser(u, { active: true });
    return { batch: b, ...res };
  });
  audit(session, { action: "records.restore", entity: out.batch.rootEntity, recordId: out.batch.rootId, summary: `Restored ${out.batch.label} (${out.restored} record${out.restored === 1 ? "" : "s"}${out.skipped ? `, ${out.skipped} skipped` : ""})` });
  return out;
}

/** Where to go after deleting: the parent's page, or the list. */
export function afterDeleteHref(entity: DeletableEntity, rec: Rec<EntityName>): string {
  const r = rec as unknown as Record<string, string[] | undefined>;
  switch (entity) {
    case "customers": return "/customers";
    case "enquiries": return r.customerIds?.[0] ? `/customers/${r.customerIds[0]}` : "/pipeline";
    case "inspections": return r.customerIds?.[0] ? `/customers/${r.customerIds[0]}` : "/inspections";
    case "estimates": return r.customerIds?.[0] ? `/customers/${r.customerIds[0]}` : "/estimates";
    case "projects": return r.customerIds?.[0] ? `/customers/${r.customerIds[0]}` : "/projects";
    case "tasks": return "/tasks";
    case "measurements": return r.inspectionIds?.[0] ? `/inspections/${r.inspectionIds[0]}` : "/inspections";
    case "schedule": return r.projectIds?.[0] ? `/projects/${r.projectIds[0]}` : "/projects";
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const singular = (e: EntityName) => ({ customers: "customer", enquiries: "enquiry", inspections: "inspection", estimates: "estimate", projects: "project", tasks: "task", measurements: "measurement", schedule: "schedule" } as Record<string, string>)[e] ?? e;
