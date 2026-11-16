import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { EntityName, Rec } from "../entities";
import { applyListOptions, KeyedQueue, newBinId, newFileId, newRecordId, validateWrite, type DeletedBatch, type FileStore, type FileOwner, type ListOptions, type NewDeletedBatch, type NewFile, type RecycleBin, type Repository, type StoredFile } from "../repository";
import { buildFixtures } from "./fixtures";

export { newRecordId };

type Store = { [E in EntityName]?: Rec<E>[] };

/**
 * In-process store with clearly fictional data. Used by tests, local demos and
 * the end-to-end run. It applies the same read-only rules as Airtable so code
 * cannot rely on writing calculated fields. Optional JSON persistence for dev.
 */
export class MemoryRepository implements Repository, FileStore, RecycleBin {
  readonly source = "memory" as const;
  private store: Store;
  /** Photos and voice notes; kept in memory only, so they reset on restart like the rest of the demo. */
  private files = new Map<string, { meta: StoredFile; bytes: Buffer }>();
  /** Deleted records, newest first. Kept in memory only, like the demo data. */
  private bin: DeletedBatch[] = [];

  constructor(private persistPath?: string, seed: Store = buildFixtures()) {
    if (persistPath && fs.existsSync(persistPath)) {
      this.store = JSON.parse(fs.readFileSync(persistPath, "utf8")) as Store;
    } else {
      this.store = structuredClone(seed);
    }
  }

  private rows<E extends EntityName>(entity: E): Rec<E>[] {
    return ((this.store[entity] as Rec<E>[] | undefined) ??= [] as never);
  }

  private save() {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify(this.store));
  }

  async list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]> {
    return applyListOptions(structuredClone(this.rows(entity)), opts);
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null> {
    const r = this.rows(entity).find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>> {
    validateWrite(entity, data);
    const { id: _i, createdTime: _c, ...rest } = data as Record<string, unknown>;
    const rec = { ...rest, id: newRecordId(), createdTime: new Date().toISOString() } as Rec<E>;
    this.rows(entity).push(rec);
    this.save();
    return structuredClone(rec);
  }

  async update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>> {
    validateWrite(entity, data);
    const rows = this.rows(entity);
    const i = rows.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`${entity} ${id} not found`);
    const { id: _i, createdTime: _c, ...rest } = data as Record<string, unknown>;
    rows[i] = { ...rows[i]!, ...rest } as Rec<E>;
    this.save();
    return structuredClone(rows[i]!);
  }

  async listFiles(entity: FileOwner, recordId: string): Promise<StoredFile[]> {
    return [...this.files.values()].filter((f) => f.meta.entity === entity && f.meta.recordId === recordId).map((f) => ({ ...f.meta }));
  }

  async getFile(id: string, range?: { start: number; end: number }) {
    const f = this.files.get(id);
    return f ? { meta: { ...f.meta }, bytes: range ? f.bytes.subarray(range.start, range.end + 1) : f.bytes } : null;
  }

  async getFileMeta(id: string) {
    const f = this.files.get(id);
    return f ? { ...f.meta } : null;
  }

  async listAllFiles() {
    return [...this.files.values()].map((f) => ({ ...f.meta }));
  }

  private queue = new KeyedQueue();
  /** Set while code is running inside atomic(), so a nested call joins it instead of waiting on itself. */
  private inside = new AsyncLocalStorage<true>();
  /** One unit of work at a time; if it fails, the store goes back to how it was. */
  async atomic<T>(_key: string, fn: (repo: Repository) => Promise<T>): Promise<T> {
    if (this.inside.getStore()) return fn(this);
    return this.queue.run("all", async () => {
      const before = structuredClone(this.store);
      const binBefore = structuredClone(this.bin);
      try {
        return await this.inside.run(true, () => fn(this));
      } catch (e) {
        this.store = before;
        this.bin = binBefore;
        this.save();
        throw e;
      }
    });
  }

  async addFile(m: NewFile, bytes: Buffer): Promise<StoredFile> {
    const meta: StoredFile = { ...m, id: newFileId(), createdTime: new Date().toISOString(), archived: false };
    this.files.set(meta.id, { meta, bytes });
    return { ...meta };
  }

  async setFileArchived(id: string, archived: boolean): Promise<StoredFile | null> {
    const f = this.files.get(id);
    if (!f) return null;
    f.meta.archived = archived;
    return { ...f.meta };
  }

  async setFileTranscript(id: string, transcript: string): Promise<StoredFile | null> {
    const f = this.files.get(id);
    if (!f) return null;
    f.meta.transcript = transcript;
    return { ...f.meta };
  }

  async moveToBin(b: NewDeletedBatch): Promise<DeletedBatch> {
    for (const r of b.records) {
      const rows = this.rows(r.entity);
      const i = rows.findIndex((x) => x.id === r.id);
      if (i >= 0) rows.splice(i, 1);
    }
    const batch: DeletedBatch = { ...structuredClone(b), id: newBinId(), at: new Date().toISOString() };
    this.bin.unshift(batch);
    this.save();
    return structuredClone(batch);
  }

  async listBin(limit: number): Promise<DeletedBatch[]> {
    return structuredClone(this.bin.slice(0, limit));
  }

  async getBinBatch(id: string): Promise<DeletedBatch | null> {
    const b = this.bin.find((x) => x.id === id);
    return b ? structuredClone(b) : null;
  }

  async restoreFromBin(id: string, by: string): Promise<{ restored: number; skipped: number }> {
    const b = this.bin.find((x) => x.id === id);
    if (!b || b.restoredAt) return { restored: 0, skipped: 0 };
    let restored = 0;
    for (const r of b.records) {
      const rows = this.rows(r.entity);
      if (rows.some((x) => x.id === r.id)) continue;
      rows.push({ ...structuredClone(r.data), id: r.id, createdTime: r.createdTime } as never);
      restored++;
    }
    b.restoredAt = new Date().toISOString();
    b.restoredBy = by;
    this.save();
    return { restored, skipped: b.records.length - restored };
  }
}
