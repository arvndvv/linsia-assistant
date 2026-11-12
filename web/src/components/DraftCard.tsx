import { useState } from 'react';
import type { Draft, Entry, FileRef } from '../../../server/src/types.ts';
import { api } from '../api.ts';
import { EntryCard, FileChips } from './EntryCard.tsx';
import { EntryForm } from './EntryForm.tsx';

/** What the assistant wants to remember. Stored only when the user presses Save. */
interface Props {
  draft: Draft;
  onOpenFile: (f: FileRef) => void;
  onSaved?: () => void;
  onDiscarded?: () => void;
}

export function DraftCard({ draft, onOpenFile, onSaved, onDiscarded }: Props) {
  const [saved, setSaved] = useState<Entry | null>(null);
  const [discarded, setDiscarded] = useState(false);

  if (saved) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-emerald-300">Saved</p>
        <EntryCard entry={saved} onOpenFile={onOpenFile} />
      </div>
    );
  }
  if (discarded) return <p className="text-xs text-soft">Not saved.</p>;

  return (
    <div className="space-y-3 rounded-xl border border-glow/50 bg-panel p-4">
      <p className="text-xs text-glow">Check this before I remember it</p>
      <FileChips files={draft.files} onOpen={onOpenFile} />
      <EntryForm
        initial={draft}
        saveLabel="Save"
        cancelLabel="Discard"
        onCancel={() => {
          setDiscarded(true);
          onDiscarded?.();
        }}
        onSave={async (fields) => {
          setSaved(await api.createEntry(fields, { raw_input: draft.raw_input, fileIds: draft.files.map((f) => f.id) }));
          onSaved?.();
        }}
      />
    </div>
  );
}
