import type { Db } from './db.ts';
import { localDate } from './time.ts';
import { KINDS, type Entry, type EntryFields, type FileRef, type Kind } from './types.ts';

const STOPWORDS = new Set(
  `a an the is are was were be my me i you it its of for to in on at and or do does did
   where what when which who how have has had can could will would should about with
   this that there any some tell show find give please kept keep put`.split(/\s+/),
);

export const isoToday = (): string => localDate(new Date());

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Turn untrusted input (model tool arguments or a request body) into clean fields.
 * Bad values are dropped and reported, never guessed.
 */
export function normalizeFields(input: unknown): { fields: EntryFields | null; problems: string[] } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];

  const title = text(src.title);
  if (!title) return { fields: null, problems: ['title is required'] };

  let kind: Kind = 'note';
  const rawKind = text(src.kind).toLowerCase();
  if ((KINDS as readonly string[]).includes(rawKind)) kind = rawKind as Kind;
  else if (rawKind) problems.push(`unknown kind "${rawKind}", used "note"`);

  const date = (key: 'purchase_date' | 'expiry_date'): string | null => {
    const v = text(src[key]);
    if (!v) return null;
    if (isIsoDate(v)) return v;
    problems.push(`${key} "${v}" is not a valid YYYY-MM-DD date, left empty`);
    return null;
  };

  return {
    fields: {
      title: title.slice(0, 200),
      kind,
      details: text(src.details).slice(0, 4000),
      location: text(src.location) || null,
      owner: text(src.owner) || null,
      purchase_date: date('purchase_date'),
      expiry_date: date('expiry_date'),
    },
    problems,
  };
}

type Row = Omit<Entry, 'files' | 'days_left'>;
export type StoredFile = FileRef & { stored_name: string; text: string | null };

const FILE_COLS = `id, name, mime, size, (text IS NOT NULL AND text <> '') AS has_text`;
const asRef = (r: FileRef): FileRef => ({ ...r, has_text: Boolean(r.has_text) });

/** Days before expiry at which a reminder goes out. */
export const REMINDER_DAYS = [30, 7, 1, 0];

export class Memory {
  constructor(
    private db: Db,
    private today: () => string = isoToday,
  ) {}

  private hydrate(row: Row): Entry {
    const files = (this.db.prepare(`SELECT ${FILE_COLS} FROM files WHERE entry_id = ? ORDER BY id`).all(row.id) as FileRef[]).map(asRef);
    const days_left = row.expiry_date ? daysBetween(this.today(), row.expiry_date) : null;
    return { ...row, files, days_left };
  }

  add(fields: EntryFields, opts: { raw_input?: string | null; fileIds?: number[] } = {}): Entry {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO entries (title, kind, details, location, owner, purchase_date, expiry_date, raw_input, created_at, updated_at)
         VALUES (@title, @kind, @details, @location, @owner, @purchase_date, @expiry_date, @raw_input, @now, @now)`,
      )
      .run({ ...fields, raw_input: opts.raw_input ?? null, now });
    const id = Number(info.lastInsertRowid);
    const attach = this.db.prepare('UPDATE files SET entry_id = ? WHERE id = ? AND entry_id IS NULL');
    for (const fileId of opts.fileIds ?? []) attach.run(id, fileId);
    return this.get(id)!;
  }

  update(id: number, fields: EntryFields): Entry | null {
    const info = this.db
      .prepare(
        `UPDATE entries SET title=@title, kind=@kind, details=@details, location=@location, owner=@owner,
           purchase_date=@purchase_date, expiry_date=@expiry_date, updated_at=@now WHERE id=@id`,
      )
      .run({ ...fields, id, now: new Date().toISOString() });
    return info.changes ? this.get(id) : null;
  }

  /** Removes the record. Attached files stay on disk, detached. */
  remove(id: number): boolean {
    this.db.prepare('DELETE FROM notices WHERE entry_id = ?').run(id);
    return this.db.prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
  }

  get(id: number): Entry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  recent(limit = 100): Entry[] {
    const rows = this.db.prepare('SELECT * FROM entries ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[];
    return rows.map((r) => this.hydrate(r));
  }

  /** Keyword search over records, then over text read from their documents. Best matches first. */
  search(query: string, limit = 5): Entry[] {
    const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w));
    if (!words.length) return [];
    const match = [...new Set(words)].map((w) => `"${w}"*`).join(' OR ');
    const byRecord = this.db
      .prepare(
        `SELECT e.* FROM entries_fts f JOIN entries e ON e.id = f.rowid
         WHERE entries_fts MATCH ? ORDER BY bm25(entries_fts, 5.0, 1.0, 2.0, 2.0, 2.0) LIMIT ?`,
      )
      .all(match, limit) as Row[];
    const byDocument = this.db
      .prepare(
        `SELECT e.* FROM files_fts t JOIN files f ON f.id = t.rowid JOIN entries e ON e.id = f.entry_id
         WHERE files_fts MATCH ? ORDER BY bm25(files_fts) LIMIT ?`,
      )
      .all(match, limit) as Row[];
    const seen = new Set<number>();
    const rows = [...byRecord, ...byDocument].filter((r) => !seen.has(r.id) && seen.add(r.id));
    return rows.slice(0, limit).map((r) => this.hydrate(r));
  }

  /** Entries expiring within `days` from today, soonest first. Excludes already expired. */
  expiring(days: number): Entry[] {
    const today = this.today();
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const rows = this.db
      .prepare('SELECT * FROM entries WHERE expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date')
      .all(today, until) as Row[];
    return rows.map((r) => this.hydrate(r));
  }

  /** Expiring within `days`, plus anything that expired in the last `past` days. Soonest first. */
  attention(days = 30, past = 14): Entry[] {
    const shift = (n: number) => new Date(Date.parse(`${this.today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const rows = this.db
      .prepare('SELECT * FROM entries WHERE expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date')
      .all(shift(-past), shift(days)) as Row[];
    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Records that have crossed a reminder threshold since the last call.
   * Each record is returned once per threshold, even across restarts.
   */
  dueReminders(): Entry[] {
    const seen = this.db.prepare('SELECT 1 FROM notices WHERE entry_id = ? AND expiry_date = ? AND threshold = ?');
    const mark = this.db.prepare('INSERT OR IGNORE INTO notices (entry_id, expiry_date, threshold, sent_at) VALUES (?, ?, ?, ?)');
    const due: Entry[] = [];
    for (const e of this.expiring(Math.max(...REMINDER_DAYS))) {
      const crossed = REMINDER_DAYS.filter((t) => e.days_left! <= t);
      const nearest = Math.min(...crossed);
      if (!seen.get(e.id, e.expiry_date, nearest)) due.push(e);
      for (const t of crossed) mark.run(e.id, e.expiry_date, t, new Date().toISOString());
    }
    return due;
  }

  addFile(f: { name: string; stored_name: string; mime: string; size: number; text?: string | null }): FileRef {
    const text = f.text?.trim() || null;
    const info = this.db
      .prepare('INSERT INTO files (name, stored_name, mime, size, text, created_at) VALUES (@name, @stored_name, @mime, @size, @text, @now)')
      .run({ name: f.name, stored_name: f.stored_name, mime: f.mime, size: f.size, text, now: new Date().toISOString() });
    return { id: Number(info.lastInsertRowid), name: f.name, mime: f.mime, size: f.size, has_text: !!text };
  }

  getFile(id: number): StoredFile | null {
    const row = this.db.prepare(`SELECT ${FILE_COLS}, stored_name, text FROM files WHERE id = ?`).get(id) as StoredFile | undefined;
    return row ? { ...row, has_text: Boolean(row.has_text) } : null;
  }

  filesByIds(ids: number[]): FileRef[] {
    return ids
      .map((id) => this.getFile(id))
      .filter((f): f is StoredFile => !!f)
      .map(({ stored_name: _s, text: _t, ...ref }) => ref);
  }
}
