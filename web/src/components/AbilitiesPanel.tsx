import { useEffect, useState } from 'react';
import type { Abilities } from '../../../server/src/types.ts';
import { api } from '../api.ts';
import { Drawer } from './Drawer.tsx';

/** What the assistant can do, what is optional, and what it will not do. Examples are clickable. */
export function AbilitiesPanel({ onClose, onTry }: { onClose: () => void; onTry: (text: string) => void }) {
  const [data, setData] = useState<Abilities | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.abilities().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  const heading = 'mb-3 text-xs tracking-wider text-soft uppercase';

  return (
    <Drawer title="What I can do" onClose={onClose}>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {data && (
        <div className="space-y-8">
          <section className="space-y-4">
            {data.skills.map((s) => (
              <div key={s.name} className="rounded-xl border border-line bg-panel p-4">
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-soft">{s.summary}</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {s.tools.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-glow">+</span>
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.examples.map((ex) => (
                    <button key={ex} onClick={() => onTry(ex)} title="Put this in the message box" className="rounded-full border border-line px-3 py-1 text-left text-xs text-soft hover:border-glow hover:text-white">
                      “{ex}”
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h3 className={heading}>Also</h3>
            <ul className="space-y-3 text-sm">
              {data.extras.map((x) => (
                <li key={x.name} className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.ready ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span>
                    {x.name} <span className="text-soft">· {x.ready ? 'ready' : 'not ready'}</span>
                    <span className="block text-soft">{x.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className={heading}>By design, I cannot</h3>
            <ul className="space-y-2 text-sm text-soft">
              {data.limits.map((l) => (
                <li key={l} className="flex gap-2">
                  <span>–</span>
                  {l}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}
