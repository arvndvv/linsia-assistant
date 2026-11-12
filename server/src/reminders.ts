import type { Db } from './db.ts';
import type { Reminder } from './types.ts';

type Row = Omit<Reminder, 'cancelled' | 'in_system'> & { cancelled: number; system_id: string | null };
const COLS = 'id, text, due_at, fired_at, cancelled, system_id';
const clean = ({ system_id, ...r }: Row): Reminder => ({ ...r, cancelled: Boolean(r.cancelled), in_system: !!system_id });

/** Most reminders that may be waiting at once. A runaway model cannot flood the list. */
export const MAX_UPCOMING = 50;

export class Reminders {
  constructor(
    private db: Db,
    private now: () => Date = () => new Date(),
  ) {}

  add(text: string, due: Date): Reminder {
    const info = this.db
      .prepare('INSERT INTO reminders (text, due_at, created_at) VALUES (?, ?, ?)')
      .run(text, due.toISOString(), this.now().toISOString());
    return clean(this.db.prepare(`SELECT ${COLS} FROM reminders WHERE id = ?`).get(Number(info.lastInsertRowid)) as Row);
  }

  /** Record that the operating system's reminders app holds a copy, under this id. */
  linkSystem(id: number, systemId: string): Reminder {
    this.db.prepare('UPDATE reminders SET system_id = ? WHERE id = ?').run(systemId, id);
    return clean(this.db.prepare(`SELECT ${COLS} FROM reminders WHERE id = ?`).get(id) as Row);
  }

  /** The id of the copy in the system's reminders app, if there is one. */
  systemIdOf(id: number): string | null {
    return (this.db.prepare('SELECT system_id FROM reminders WHERE id = ?').get(id) as { system_id: string | null } | undefined)?.system_id ?? null;
  }

  /** Waiting reminders, soonest first. */
  upcoming(): Reminder[] {
    return (this.db.prepare(`SELECT ${COLS} FROM reminders WHERE fired_at IS NULL AND cancelled = 0 ORDER BY due_at`).all() as Row[]).map(clean);
  }

  cancel(id: number): boolean {
    return this.db.prepare('UPDATE reminders SET cancelled = 1 WHERE id = ? AND fired_at IS NULL AND cancelled = 0').run(id).changes > 0;
  }

  /** Reminders whose time has come. Each is returned once, including ones missed while the server was off. */
  takeDue(): Reminder[] {
    const now = this.now().toISOString();
    const rows = this.db.prepare(`SELECT ${COLS} FROM reminders WHERE fired_at IS NULL AND cancelled = 0 AND due_at <= ? ORDER BY due_at`).all(now) as Row[];
    const mark = this.db.prepare('UPDATE reminders SET fired_at = ? WHERE id = ?');
    for (const r of rows) mark.run(now, r.id);
    return rows.map((r) => clean({ ...r, fired_at: now }));
  }

  /** Fired reminders the screen has not shown yet. Each is returned once. */
  takeUnseen(): Reminder[] {
    const rows = this.db.prepare(`SELECT ${COLS} FROM reminders WHERE fired_at IS NOT NULL AND seen_at IS NULL ORDER BY due_at`).all() as Row[];
    const mark = this.db.prepare('UPDATE reminders SET seen_at = ? WHERE id = ?');
    for (const r of rows) mark.run(this.now().toISOString(), r.id);
    return rows.map(clean);
  }
}
