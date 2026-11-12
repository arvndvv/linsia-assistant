import { useState } from 'react';
import type { Entry, EntryFields, FileRef } from '../../../server/src/types.ts';
import { EntryForm } from './EntryForm.tsx';

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Expiry({ entry }: { entry: Entry }) {
  if (!entry.expiry_date || entry.days_left === null) return null;
  const d = entry.days_left;
  const tone = d < 0 ? 'text-red-400' : d <= 30 ? 'text-amber-300' : 'text-emerald-300';
  const when = d < 0 ? `expired ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'expires today' : `${d} day${d === 1 ? '' : 's'} left`;
  return (
    <p className="text-sm">
      <span className="text-soft">Expires </span>
      {formatDate(entry.expiry_date)} <span className={tone}>· {when}</span>
    </p>
  );
}

export function FileChips({ files, onOpen }: { files: FileRef[]; onOpen: (f: FileRef) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => (
        <button key={f.id} onClick={() => onOpen(f)} className="max-w-full truncate rounded-md border border-line px-2 py-1 text-xs text-glow hover:border-glow">
          {f.mime === 'application/pdf' ? 'PDF' : 'Image'} · {f.name}
        </button>
      ))}
    </div>
  );
}

interface Props {
  entry: Entry;
  onOpenFile: (f: FileRef) => void;
  /** When given, the card shows Edit and Delete. */
  onUpdate?: (id: number, fields: EntryFields) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

export function EntryCard({ entry, onOpenFile, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);

  if (editing && onUpdate) {
    return (
      <div className="rounded-xl border border-glow/50 bg-panel p-4">
        <EntryForm
          initial={entry}
          saveLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSave={async (fields) => {
            await onUpdate(entry.id, fields);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium">{entry.title}</h3>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-soft">{entry.kind}</span>
      </div>
      <Expiry entry={entry} />
      {entry.location && (
        <p className="text-sm">
          <span className="text-soft">Kept at </span>
          {entry.location}
        </p>
      )}
      {entry.owner && (
        <p className="text-sm">
          <span className="text-soft">Belongs to </span>
          {entry.owner}
        </p>
      )}
      {entry.purchase_date && (
        <p className="text-sm">
          <span className="text-soft">Bought </span>
          {formatDate(entry.purchase_date)}
        </p>
      )}
      {entry.details && <p className="text-sm whitespace-pre-wrap text-soft">{entry.details}</p>}
      <FileChips files={entry.files} onOpen={onOpenFile} />
      {(onUpdate || onDelete) && (
        <div className="flex justify-end gap-3 pt-1 text-xs text-soft">
          {onUpdate && (
            <button onClick={() => setEditing(true)} className="hover:text-white">
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => {
                if (window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) void onDelete(entry.id);
              }}
              className="hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
