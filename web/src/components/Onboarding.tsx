import { useState } from 'react';
import type { Settings } from '../../../server/src/types.ts';
import { api } from '../api.ts';
import { ModelSetup } from './ModelSetup.tsx';
import { Presence } from './Presence.tsx';

/** First run: give it a name, then get a model working. Can be skipped and finished later in Settings. */
export function Onboarding({ settings, onChange, onDone }: { settings: Settings; onChange: (s: Settings) => void; onDone: (s: Settings) => void }) {
  const [step, setStep] = useState<'name' | 'model'>('name');
  const [name, setName] = useState(settings.name === 'Assistant' ? '' : settings.name);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function saveName() {
    try {
      onChange(await api.saveSettings({ name: name.trim() || 'Assistant' }));
      setStep('model');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  async function finish() {
    try {
      onDone(await api.saveSettings({ setupDone: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-ink">
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-10 text-center">
        <Presence state="idle" mood={step === 'name' ? 'happy' : working ? 'happy' : 'curious'} gesture={null} size={170} />

        {step === 'name' ? (
          <div className="stage-in mt-6 w-full space-y-5">
            <div>
              <h1 className="text-2xl">Hello. I am your assistant.</h1>
              <p className="mt-2 text-soft">I remember things for you: warranties, insurance, where papers are kept, and when things run out. What would you like to call me?</p>
            </div>
            <input autoFocus className="field text-center text-lg" maxLength={40} placeholder="Assistant" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveName()} />
            <button onClick={() => void saveName()} className="rounded-lg bg-glow px-5 py-2 font-medium text-ink">
              Continue
            </button>
            <p className="text-xs text-soft">You can change the name later.</p>
          </div>
        ) : (
          <div className="stage-in mt-6 w-full space-y-5">
            <div>
              <h1 className="text-2xl">{settings.name} needs a model to think with.</h1>
              <p className="mt-2 text-soft">Running it on this computer keeps everything private. That is the suggested choice.</p>
            </div>
            <ModelSetup settings={settings} onChange={onChange} onTested={setWorking} />
            <div className="flex items-center justify-center gap-4 pt-2">
              <button onClick={() => setStep('name')} className="text-sm text-soft hover:text-white">
                Back
              </button>
              <button onClick={() => void finish()} className={working ? 'rounded-lg bg-glow px-5 py-2 font-medium text-ink' : 'rounded-lg border border-line px-5 py-2 text-soft hover:text-white'}>
                {working ? 'Finish' : 'Skip for now'}
              </button>
            </div>
            {!working && <p className="text-xs text-soft">Without a working model I cannot answer. You can finish this later in Settings.</p>}
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
