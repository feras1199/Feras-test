import { randomBytes } from "node:crypto";
import { ENTITIES, type EntityName, type FieldSpec, type Rec } from "./entities";

export interface ListOptions<E extends EntityName> {
  where?: (r: Rec<E>) => boolean;
  sort?: (a: Rec<E>, b: Rec<E>) => number;
  limit?: number;
}

/**
 * The only way the app reads or writes business data. Implementations:
 * PostgresRepository (ATLAS's own database), AirtableRepository (the old base) and
 * MemoryRepository (tests and demo, fictional data).
 * There is deliberately no hard delete: records are archived by status.
 */
export interface Repository {
  readonly source: "airtable" | "memory" | "postgres";
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

/**
 * Same write rules everywhere: known fields only, no writing calculated fields,
 * money in whole cents, dates as YYYY-MM-DD.
 */
export function validateWrite<E extends EntityName>(entity: E, data: Partial<Rec<E>>) {
  const fields = ENTITIES[entity].fields as Record<string, FieldSpec>;
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || k === "createdTime" || v === undefined) continue;
    const spec = fields[k];
    if (!spec) throw new Error(`Unknown field ${entity}.${k}`);
    if (spec.readOnly) throw new Error(`${entity}.${k} is calculated and cannot be written`);
    if (spec.kind === "currency" && v !== null && !Number.isInteger(v)) throw new TypeError(`${spec.field} expects integer cents`);
    if (spec.kind === "date" && v !== null && v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new TypeError(`${spec.field} expects YYYY-MM-DD`);
  }
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Record ids keep Airtable's shape (rec + 14 characters) so imported and new records look alike. */
export function newRecordId(): string {
  const bytes = randomBytes(14);
  return "rec" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** A photo or voice note attached to a record (only site inspections for now). */
export type FileKind = "photo" | "voice";
export interface StoredFile {
  id: string;
  entity: EntityName;
  recordId: string;
  kind: FileKind;
  mime: string;
  name: string;
  size: number;
  durationS?: number;
  createdBy: string;
  createdTime: string;
  archived: boolean;
}
export type NewFile = Omit<StoredFile, "id" | "createdTime" | "archived">;

/**
 * Where ATLAS keeps photos and voice notes. The database and demo stores have
 * one; Airtable mode does not. Files are never hard-deleted, only archived.
 */
export interface FileStore {
  listFiles(entity: EntityName, recordId: string): Promise<StoredFile[]>;
  getFile(id: string): Promise<{ meta: StoredFile; bytes: Buffer } | null>;
  addFile(meta: NewFile, bytes: Buffer): Promise<StoredFile>;
  setFileArchived(id: string, archived: boolean): Promise<StoredFile | null>;
}

export function fileStoreOf(repo: Repository): FileStore | null {
  const r = repo as Partial<FileStore>;
  return typeof r.listFiles === "function" && typeof r.addFile === "function" ? (repo as unknown as FileStore) : null;
}

export function newFileId(): string {
  return "fil" + newRecordId().slice(3);
}
