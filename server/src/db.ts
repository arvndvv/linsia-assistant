import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'note',
  details       TEXT NOT NULL DEFAULT '',
  location      TEXT,
  owner         TEXT,
  purchase_date TEXT,
  expiry_date   TEXT,
  raw_input     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  entry_id    INTEGER NOT NULL,
  expiry_date TEXT NOT NULL,
  threshold   INTEGER NOT NULL,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (entry_id, expiry_date, threshold)
);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY,
  text       TEXT NOT NULL,
  due_at     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fired_at   TEXT,
  seen_at    TEXT,
  cancelled  INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, kind, details, location, owner,
  content='entries', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, kind, details, location, owner)
  VALUES (new.id, new.title, new.kind, new.details, new.location, new.owner);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, kind, details, location, owner)
  VALUES ('delete', old.id, old.title, old.kind, old.details, old.location, old.owner);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, kind, details, location, owner)
  VALUES ('delete', old.id, old.title, old.kind, old.details, old.location, old.owner);
  INSERT INTO entries_fts(rowid, title, kind, details, location, owner)
  VALUES (new.id, new.title, new.kind, new.details, new.location, new.owner);
END;
`;

// Text read out of attached documents, searchable separately from the records.
const FILE_TEXT = `
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  text, content='files', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
`;

/** Pass ':memory:' for tests. */
export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Databases created before document reading existed lack this column.
  const columns = db.prepare('PRAGMA table_info(files)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'text')) db.exec('ALTER TABLE files ADD COLUMN text TEXT');
  db.exec(FILE_TEXT);
  const reminderCols = db.prepare('PRAGMA table_info(reminders)').all() as { name: string }[];
  if (!reminderCols.some((c) => c.name === 'system_id')) db.exec('ALTER TABLE reminders ADD COLUMN system_id TEXT');
  return db;
}
