import { useEffect, useState } from 'react';
import type { Settings } from '../../../server/src/types.ts';
import { api } from '../api.ts';
import { isFeminine, listVoices, savedVoiceName, saveVoiceName, speak, whenVoicesReady } from '../speech.ts';
import { Drawer } from './Drawer.tsx';
import { ModelSetup } from './ModelSetup.tsx';

/** Name and model, changeable at any time. Changes apply at once, no restart. */
export function SettingsPanel({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const [name, setName] = useState(settings.name);
  const [note, setNote] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(listVoices());
  const [voice, setVoice] = useState(savedVoiceName());

  // Browsers hand over the list of voices a moment after the page loads.
  useEffect(() => whenVoicesReady(setVoices), []);

  async function saveName() {
    const next = name.trim();
    if (!next || next === settings.name) return;
    try {
      onChange(await api.saveSettings({ name: next }));
      setNote('Saved.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  const heading = 'mb-3 text-xs tracking-wider text-soft uppercase';

  return (
    <Drawer title="Settings" onClose={onClose}>
      <div className="space-y-8">
        <section>
          <h3 className={heading}>Name</h3>
          <div className="flex gap-2">
            <input className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveName()} />
            <button onClick={() => void saveName()} disabled={!name.trim() || name.trim() === settings.name} className="rounded-lg bg-glow px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40">
              Save
            </button>
          </div>
          {note && <p className="mt-1 text-xs text-soft">{note}</p>}
        </section>

        <section>
          <h3 className={heading}>Voice</h3>
          {voices.length === 0 ? (
            <p className="text-sm text-soft">This browser offers no voices, so replies cannot be read aloud.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <select
                  className="field"
                  value={voice}
                  onChange={(e) => {
                    setVoice(e.target.value);
                    saveVoiceName(e.target.value);
                  }}
                >
                  <option value="">Suggested ({voices[0].name})</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} · {v.lang}
                      {isFeminine(v) ? ' · feminine' : ''}
                    </option>
                  ))}
                </select>
                <button onClick={() => speak(`Hello, I'm ${settings.name}.`, () => {})} className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:border-glow hover:text-white">
                  Hear it
                </button>
              </div>
              <p className="mt-1 text-xs text-soft">Kept for this browser. Which voices exist depends on the computer; macOS and Windows both offer more under their own speech settings.</p>
            </>
          )}
        </section>

        <section>
          <h3 className={heading}>Model</h3>
          <ModelSetup settings={settings} onChange={onChange} />
        </section>

        <p className="text-xs text-soft">
          These are saved in <code>data/settings.json</code>. Values in <code>.env</code> are only the starting defaults.
        </p>
      </div>
    </Drawer>
  );
}
