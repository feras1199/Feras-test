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
 * Records are not deleted through this interface. Deleting goes through the
 * recycle bin (RecycleBin below), which keeps a full copy so it can be undone.
 */
export interface Repository {
  readonly source: "airtable" | "memory" | "postgres";
  list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]>;
  get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null>;
  create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>>;
  update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>>;
  /**
   * Runs fn as one unit of work: every write it makes through the repository it is
   * given is saved, or none are. Calls with the same key run one after another, so
   * a step that checks then writes (accepting a quote, taking the next quote number)
   * can't be run twice at once. Airtable has no transactions: there it only queues.
   */
  atomic<T>(key: string, fn: (repo: Repository) => Promise<T>): Promise<T>;
}

/** Runs tasks with the same key one at a time, in the order they arrive. */
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return next;
  }
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

/**
 * A photo, voice note or PDF. Site inspection files belong to the inspection;
 * files shared in Ask ATLAS belong to the person who shared them ("assistant", record id = their user id).
 */
export type FileKind = "photo" | "voice" | "document";
export type FileOwner = EntityName | "assistant";
export interface StoredFile {
  id: string;
  entity: FileOwner;
  recordId: string;
  kind: FileKind;
  mime: string;
  name: string;
  size: number;
  durationS?: number;
  createdBy: string;
  createdTime: string;
  archived: boolean;
  /** Speech-to-text of a voice note, once it has been transcribed. */
  transcript?: string;
}
export type NewFile = Omit<StoredFile, "id" | "createdTime" | "archived" | "transcript">;

/**
 * Where ATLAS keeps photos and voice notes. The database and demo stores have
 * one; Airtable mode does not. Files are never hard-deleted, only archived.
 */
export interface FileStore {
  listFiles(entity: FileOwner, recordId: string): Promise<StoredFile[]>;
  /** The file's details and bytes. With a range, only those bytes are read (end is inclusive). */
  getFile(id: string, range?: { start: number; end: number }): Promise<{ meta: StoredFile; bytes: Buffer } | null>;
  getFileMeta(id: string): Promise<StoredFile | null>;
  /** Every file's details (no bytes), oldest first. For backups. */
  listAllFiles(): Promise<StoredFile[]>;
  addFile(meta: NewFile, bytes: Buffer): Promise<StoredFile>;
  setFileArchived(id: string, archived: boolean): Promise<StoredFile | null>;
  setFileTranscript(id: string, transcript: string): Promise<StoredFile | null>;
}

export function fileStoreOf(repo: Repository): FileStore | null {
  const r = repo as Partial<FileStore>;
  return typeof r.listFiles === "function" && typeof r.addFile === "function" ? (repo as unknown as FileStore) : null;
}

export function newFileId(): string {
  return "fil" + newRecordId().slice(3);
}

/** A record as it was when it was deleted, so it can be put back exactly. */
export interface DeletedRecord { entity: EntityName; id: string; createdTime: string; data: Record<string, unknown> }
/** A link removed from a record that was kept, because it pointed at a deleted record. */
export interface RemovedLink { entity: EntityName; id: string; field: string; ids: string[] }
/** One delete: the record someone deleted and everything that went with it. */
export interface DeletedBatch {
  id: string;
  at: string;
  by: string;
  /** What was deleted, in words, e.g. "Customer Jane Smith". */
  label: string;
  rootEntity: EntityName;
  rootId: string;
  records: DeletedRecord[];
  unlinks: RemovedLink[];
  /** Photos and recordings that were hidden with the records. */
  fileIds: string[];
  /** Customer portal logins switched off with the customer. */
  userIds: string[];
  restoredAt?: string;
  restoredBy?: string;
}
export type NewDeletedBatch = Omit<DeletedBatch, "id" | "at" | "restoredAt" | "restoredBy">;

/**
 * Where deleted records go. Deleting removes them from the app and keeps a full
 * copy here, so the owner can put them back from Settings > Recently deleted.
 * The database and demo stores have one; Airtable mode does not.
 */
export interface RecycleBin {
  /** Removes the records and keeps the copy, as one step. */
  moveToBin(batch: NewDeletedBatch): Promise<DeletedBatch>;
  listBin(limit: number): Promise<DeletedBatch[]>;
  getBinBatch(id: string): Promise<DeletedBatch | null>;
  /** Puts the records back (any whose id is in use again is skipped) and marks the batch restored. */
  restoreFromBin(id: string, by: string): Promise<{ restored: number; skipped: number }>;
}

export function recycleBinOf(repo: Repository): RecycleBin | null {
  const r = repo as Partial<RecycleBin>;
  return typeof r.moveToBin === "function" && typeof r.restoreFromBin === "function" ? (repo as unknown as RecycleBin) : null;
}

export function newBinId(): string {
  return "del" + newRecordId().slice(3);
}
