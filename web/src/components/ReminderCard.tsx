import { useState } from 'react';
import type { Reminder } from '../../../server/src/types.ts';
import { api } from '../api.ts';

export function formatDue(iso: string): string {
  const due = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(due) - day(new Date())) / 86_400_000);
  const date = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${date}, ${due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** One reminder, with the exact time it will go off and a way to call it off. */
export function ReminderCard({ reminder, onCancelled }: { reminder: Reminder; onCancelled?: (id: number) => void }) {
  const [state, setState] = useState<'waiting' | 'cancelled' | 'gone'>(reminder.cancelled ? 'cancelled' : reminder.fired_at ? 'gone' : 'waiting');

  async function cancel() {
    try {
      await api.cancelReminder(reminder.id);
      setState('cancelled');
      onCancelled?.(reminder.id);
    } catch {
      setState('gone'); // it already went off
    }
  }

  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border border-line bg-panel p-4 ${state === 'waiting' ? '' : 'opacity-60'}`}>
      <div className="min-w-0">
        <p className="text-xs tracking-wider text-glow uppercase">Reminder</p>
        <p className={`truncate font-medium ${state === 'cancelled' ? 'line-through' : ''}`}>{reminder.text}</p>
        <p className="text-sm text-soft">
          {formatDue(reminder.due_at)}
          {reminder.in_system && <span className="text-glow"> · also in Reminders app</span>}
        </p>
      </div>
      {state === 'waiting' ? (
        <button onClick={() => void cancel()} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:border-red-400 hover:text-red-400">
          Cancel
        </button>
      ) : (
        <span className="shrink-0 text-xs text-soft">{state === 'cancelled' ? 'Cancelled' : 'Done'}</span>
      )}
    </div>
  );
}
