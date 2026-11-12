import { useEffect, useState } from 'react';
import type { Entry, FileRef, Reminder } from '../../../server/src/types.ts';
import { api } from '../api.ts';
import { Drawer } from './Drawer.tsx';
import { EntryCard } from './EntryCard.tsx';
import { ReminderCard } from './ReminderCard.tsx';

/** Everything the assistant knows, browsable and correctable. */
export function MemoryPanel({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: (f: FileRef) => void }) {
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [reminders, setReminders] = useState<Reminder[]>([]);

  useEffect(() => {
    api.reminders().then(setReminders).catch(() => {});
  }, []);

  async function load(query: string) {
    try {
      setEntries(await api.entries(query));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Drawer onClose={onClose} title={<input autoFocus className="field font-normal" placeholder="Search memory" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <div className="space-y-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!q && reminders.length > 0 && (
          <section className="space-y-3 border-b border-line pb-4">
            <h3 className="text-xs tracking-wider text-soft uppercase">Waiting reminders</h3>
            {reminders.map((r) => (
              <ReminderCard key={r.id} reminder={r} />
            ))}
          </section>
        )}
        {entries?.length === 0 && <p className="text-sm text-soft">{q ? 'Nothing matches.' : 'Nothing saved yet. Tell the assistant something, or drop in a bill.'}</p>}
        {entries?.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            onOpenFile={onOpenFile}
            onUpdate={async (id, fields) => {
              const updated = await api.updateEntry(id, fields);
              setEntries((list) => list?.map((x) => (x.id === id ? updated : x)) ?? null);
            }}
            onDelete={async (id) => {
              await api.deleteEntry(id);
              setEntries((list) => list?.filter((x) => x.id !== id) ?? null);
            }}
          />
        ))}
      </div>
    </Drawer>
  );
}
