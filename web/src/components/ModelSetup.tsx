import { useCallback, useEffect, useState } from 'react';
import type { ModelStatus, ModelTest, Provider, Settings } from '../../../server/src/types.ts';
import { api } from '../api.ts';

const OLLAMA_URL = 'http://localhost:11434/v1';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Tells the parent whether the model answered a real question. */
  onTested?: (ok: boolean) => void;
}

/**
 * Choosing where the model runs and which one, used by first-run setup and the Settings panel.
 * Walks an Ollama user through install, start, download and a test. Other servers get address, model and key.
 */
export function ModelSetup({ settings, onChange, onTested }: Props) {
  const [provider, setProvider] = useState<Provider>(settings.llm.provider);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [pull, setPull] = useState<{ model: string; status: string; fraction: number | null } | null>(null);
  const [test, setTest] = useState<ModelTest | 'running' | null>(null);
  // Fields for a server that is not Ollama.
  const [baseUrl, setBaseUrl] = useState(settings.llm.provider === 'openai' ? settings.llm.baseUrl : '');
  const [model, setModel] = useState(settings.llm.provider === 'openai' ? settings.llm.model : '');
  const [apiKey, setApiKey] = useState('');
  const [custom, setCustom] = useState('');

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.modelStatus());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check.');
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function runTest() {
    setTest('running');
    const result = await api.testModel().catch((e: Error): ModelTest => ({ ok: false, seconds: 0, tools: false, error: e.message }));
    setTest(result);
    onTested?.(result.ok && result.tools);
  }

  async function save(patch: Parameters<typeof api.saveSettings>[0]['llm']) {
    try {
      onChange(await api.saveSettings({ llm: patch }));
      setError('');
      setTest(null);
      onTested?.(false);
      await check();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    }
  }

  async function chooseProvider(next: Provider) {
    setProvider(next);
    setTest(null);
    if (next === 'ollama' && settings.llm.provider !== 'ollama') {
      const pick = status?.recommended.find((m) => m.recommended)?.name ?? 'qwen2.5:3b';
      await save({ provider: 'ollama', baseUrl: OLLAMA_URL, model: pick });
    }
  }

  async function download(name: string) {
    setPull({ model: name, status: 'Starting', fraction: null });
    try {
      await api.pullModel(name, (s, fraction) => setPull({ model: name, status: s, fraction }));
      setPull(null);
      if (await save({ model: name })) await runTest();
    } catch (e) {
      setPull(null);
      setError(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  const has = (name: string) => !!status?.models.some((m) => m.name === name || m.name === `${name}:latest`);
  const label = 'mb-1 block text-xs text-soft';
  const button = 'rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:border-glow hover:text-white disabled:opacity-40';
  const primary = 'rounded-lg bg-glow px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40';
  const ollamaActive = provider === 'ollama' && settings.llm.provider === 'ollama';

  return (
    <div className="space-y-4 text-left">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['ollama', 'On this computer', 'Private. Uses Ollama. Nothing leaves this machine.'],
            ['openai', 'Another server', 'Any OpenAI-compatible service, such as Mistral or LM Studio.'],
          ] as const
        ).map(([value, title, note]) => (
          <button
            key={value}
            onClick={() => void chooseProvider(value)}
            aria-pressed={provider === value}
            className={`rounded-xl border p-3 text-left ${provider === value ? 'border-glow bg-glow/10' : 'border-line hover:border-soft'}`}
          >
            <span className="block text-sm font-medium">{title}</span>
            <span className="block text-xs text-soft">{note}</span>
          </button>
        ))}
      </div>

      {provider === 'ollama' && (
        <div className="space-y-3">
          {!status || !ollamaActive ? (
            <p className="text-sm text-soft">Checking for Ollama…</p>
          ) : !status.installed ? (
            <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
              <p className="text-sm">Ollama is the free program that runs the model on your computer. It is not installed yet.</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-soft">
                <li>Download and install it from ollama.com.</li>
                <li>Open it once, so it is running.</li>
                <li>Come back here and press Check again.</li>
              </ol>
              <div className="flex gap-2">
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className={primary}>
                  Get Ollama
                </a>
                <button onClick={() => void check()} disabled={checking} className={button}>
                  {checking ? 'Checking…' : 'Check again'}
                </button>
              </div>
            </div>
          ) : !status.reachable ? (
            <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
              <p className="text-sm">Ollama is installed but not running.</p>
              <div className="flex gap-2">
                <button
                  className={primary}
                  onClick={async () => {
                    await api.startOllama().catch(() => {});
                    window.setTimeout(() => void check(), 3000);
                  }}
                >
                  Start Ollama
                </button>
                <button onClick={() => void check()} disabled={checking} className={button}>
                  {checking ? 'Checking…' : 'Check again'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-soft">
                Ollama is running. This computer has {status.ramGb} GB of memory. Pick a model:
              </p>
              <div className="space-y-2">
                {[...status.recommended, ...status.models.filter((m) => !status.recommended.some((r) => r.name === m.name))].map((m) => {
                  const chosen = settings.llm.model === m.name;
                  const ready = has(m.name);
                  const busy = pull?.model === m.name;
                  return (
                    <div key={m.name} className={`rounded-xl border p-3 ${chosen ? 'border-glow bg-glow/10' : 'border-line'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {m.name}
                            {m.recommended && <span className="ml-2 text-xs font-normal text-glow">suggested for this computer</span>}
                          </p>
                          <p className="text-xs text-soft">
                            {m.sizeGb ? `${m.sizeGb} GB` : ''}
                            {m.note ? ` · ${m.note}` : ''}
                          </p>
                        </div>
                        {ready ? (
                          <button className={chosen ? 'text-xs text-emerald-300' : button} disabled={chosen || !!pull} onClick={() => void save({ model: m.name })}>
                            {chosen ? 'In use' : 'Use'}
                          </button>
                        ) : (
                          <button className={primary} disabled={!!pull} onClick={() => void download(m.name)}>
                            {busy ? 'Downloading…' : 'Download'}
                          </button>
                        )}
                      </div>
                      {busy && pull && (
                        <div className="mt-3">
                          <div className="h-1.5 overflow-hidden rounded-full bg-line">
                            <div className="h-full bg-glow transition-[width]" style={{ width: `${Math.round((pull.fraction ?? 0) * 100)}%` }} />
                          </div>
                          <p className="mt-1 text-xs text-soft">
                            {pull.status}
                            {pull.fraction !== null ? ` · ${Math.round(pull.fraction * 100)}%` : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-soft hover:text-white">Use a different model</summary>
                <div className="mt-2 flex gap-2">
                  <input className="field" placeholder="Model name from ollama.com/library, e.g. llama3.2:3b" value={custom} onChange={(e) => setCustom(e.target.value)} />
                  <button className={button} disabled={!custom.trim() || !!pull} onClick={() => void download(custom.trim())}>
                    Download
                  </button>
                </div>
                <p className="mt-1 text-xs text-soft">It must support tool calling, or remembering and looking things up will not work.</p>
              </details>
            </>
          )}
        </div>
      )}

      {provider === 'openai' && (
        <div className="space-y-3">
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
            With another server, what you say and the text of documents you attach are sent to that server. Use this only with a service you trust with your records.
          </p>
          <label className="block">
            <span className={label}>Server address</span>
            <input className="field" placeholder="https://api.mistral.ai/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Model</span>
            <input className="field" list="model-names" placeholder="mistral-large-latest" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="model-names">{settings.llm.provider === 'openai' && status?.models.map((m) => <option key={m.name} value={m.name} />)}</datalist>
          </label>
          <label className="block">
            <span className={label}>Key {settings.llm.provider === 'openai' && settings.llm.hasKey ? '(one is saved; leave blank to keep it)' : ''}</span>
            <input className="field" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <button
            className={primary}
            disabled={!baseUrl.trim() || !model.trim()}
            onClick={async () => {
              if (await save({ provider: 'openai', baseUrl, model, apiKey })) {
                setApiKey('');
                await runTest();
              }
            }}
          >
            Save and test
          </button>
          {settings.llm.provider === 'openai' && status && !status.reachable && <p className="text-sm text-amber-300">That server did not answer ({status.error}).</p>}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {((ollamaActive && status?.reachable && status.modelReady) || (provider === 'openai' && settings.llm.provider === 'openai')) && (
        <div className="rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>
              Using <span className="font-medium">{settings.llm.model}</span>
            </span>
            <button className={button} disabled={test === 'running'} onClick={() => void runTest()}>
              {test === 'running' ? 'Testing…' : 'Test it'}
            </button>
          </div>
          {test && test !== 'running' && (
            <p className={`mt-2 ${test.ok && test.tools ? 'text-emerald-300' : 'text-amber-300'}`}>
              {!test.ok
                ? `It did not answer: ${test.error}`
                : test.tools
                  ? `Works. Answered in ${test.seconds} seconds and used a tool when asked.`
                  : `It answered in ${test.seconds} seconds but did not use a tool when asked. Remembering and looking things up will be unreliable with this model. Pick another.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
