import { useState } from 'react';
import { KINDS, type EntryFields, type Kind } from '../../../server/src/types.ts';

interface Props {
  initial: EntryFields;
  saveLabel: string;
  onSave: (fields: EntryFields) => Promise<void>;
  onCancel: () => void;
  cancelLabel?: string;
}

/** Editable fields for one record. Used to confirm a draft and to edit a saved record. */
export function EntryForm({ initial, saveLabel, onSave, onCancel, cancelLabel = 'Cancel' }: Props) {
  const [f, setF] = useState<EntryFields>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof EntryFields, value: string) =>
    setF((prev) => ({ ...prev, [key]: key === 'title' || key === 'details' || key === 'kind' ? value : value || null }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return setError('Give it a name.');
    setBusy(true);
    setError('');
    try {
      await onSave(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  const label = 'mb-1 block text-xs text-soft';

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <label className="col-span-2">
        <span className={label}>Name</span>
        <input className="field" value={f.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label>
        <span className={label}>Type</span>
        <select className="field" value={f.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>Whose (blank = yours)</span>
        <input className="field" value={f.owner ?? ''} onChange={(e) => set('owner', e.target.value)} />
      </label>
      <label>
        <span className={label}>Bought on</span>
        <input type="date" className="field" value={f.purchase_date ?? ''} onChange={(e) => set('purchase_date', e.target.value)} />
      </label>
      <label>
        <span className={label}>Expires on</span>
        <input type="date" className="field" value={f.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value)} />
      </label>
      <label className="col-span-2">
        <span className={label}>Kept at</span>
        <input className="field" placeholder="e.g. blue file, bedroom shelf" value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} />
      </label>
      <label className="col-span-2">
        <span className={label}>Details</span>
        <textarea className="field" rows={2} value={f.details} onChange={(e) => set('details', e.target.value)} />
      </label>
      {error && <p className="col-span-2 text-sm text-red-400">{error}</p>}
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-soft hover:text-white">
          {cancelLabel}
        </button>
        <button type="submit" disabled={busy} className="rounded-lg bg-glow px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-50">
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>
    </form>
  );
}
