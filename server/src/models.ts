// Looking after the model: is the server there, which models does it have, fetching one, trying it out.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LlmFn } from './llm.ts';
import { findProgram } from './local.ts';
import { ollamaOrigin, type LlmSettings } from './settings.ts';
import type { ModelChoice, ModelStatus, ModelTest } from './types.ts';

const GB = 1024 ** 3;

/** Models that handle tool calls, smallest first, with the memory they need to run comfortably. */
const CHOICES: (ModelChoice & { minRamGb: number })[] = [
  { name: 'qwen2.5:3b', sizeGb: 1.9, note: 'Light. For computers with 8 GB of memory.', minRamGb: 0 },
  { name: 'qwen2.5:7b', sizeGb: 4.7, note: 'More reliable with tools. Wants 16 GB of memory.', minRamGb: 14 },
  { name: 'qwen2.5:14b', sizeGb: 9.0, note: 'Best of the three. Wants 32 GB of memory or a good graphics card.', minRamGb: 28 },
];

/** What to offer on this computer: everything, with the largest one that fits marked as the pick. */
export function recommendModels(totalRamBytes: number = os.totalmem()): ModelChoice[] {
  const ram = totalRamBytes / GB;
  const pick = [...CHOICES].reverse().find((c) => ram >= c.minRamGb) ?? CHOICES[0];
  return CHOICES.map(({ minRamGb: _m, ...c }) => ({ ...c, recommended: c.name === pick.name }));
}

function ollamaProgram(): string | null {
  const extra = [
    '/Applications/Ollama.app/Contents/Resources',
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama'),
    '/usr/local/bin',
  ];
  return findProgram('ollama', { extraDirs: extra });
}

/** Is the model server reachable, what does it have, and is the chosen model among them. */
export async function modelStatus(llm: LlmSettings): Promise<ModelStatus> {
  const base: ModelStatus = {
    provider: llm.provider,
    reachable: false,
    installed: llm.provider === 'ollama' ? !!ollamaProgram() || fs.existsSync('/Applications/Ollama.app') : true,
    models: [],
    modelReady: false,
    recommended: recommendModels(),
    ramGb: Math.round(os.totalmem() / GB),
  };
  try {
    if (llm.provider === 'ollama') {
      const res = await fetch(`${ollamaOrigin(llm.baseUrl)}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const data = (await res.json()) as { models?: { name: string; size?: number }[] };
      base.models = (data.models ?? []).map((m) => ({ name: m.name, sizeGb: m.size ? Math.round((m.size / GB) * 10) / 10 : undefined }));
      base.installed = true;
    } else {
      const res = await fetch(`${llm.baseUrl}/models`, { headers: { Authorization: `Bearer ${llm.apiKey}` }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'the key was refused' : `answered ${res.status}`);
      const data = (await res.json()) as { data?: { id: string }[] };
      base.models = (data.data ?? []).map((m) => ({ name: m.id })).slice(0, 200);
    }
    base.reachable = true;
    base.modelReady = base.models.some((m) => m.name === llm.model || m.name === `${llm.model}:latest`);
  } catch (err) {
    base.error = err instanceof Error && err.name !== 'TimeoutError' ? err.message : 'no answer';
  }
  return base;
}

/** Start Ollama if it is installed but not running. Runs a fixed command, nothing from the request. */
export function startOllama(): boolean {
  try {
    if (process.platform === 'darwin' && fs.existsSync('/Applications/Ollama.app')) {
      spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    const bin = ollamaProgram();
    if (!bin) return false;
    spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

export const validModelName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,99}$/.test(name);

/**
 * Download a model through Ollama, passing its progress lines straight on.
 * Each line is JSON: {"status":"pulling ...","completed":123,"total":456}.
 */
export async function pullModel(llm: LlmSettings, model: string, onLine: (line: string) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${ollamaOrigin(llm.baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of res.body) {
    rest += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  }
  if (rest.trim()) onLine(rest);
}

/** One real question to the model: does it answer, how fast, and does it use tools when it should. */
export async function testModel(chat: LlmFn): Promise<ModelTest> {
  const started = Date.now();
  try {
    const reply = await chat(
      [
        { role: 'system', content: 'You are a test. When asked about saved things, call the lookup tool.' },
        { role: 'user', content: 'Look up what is saved about the fridge.' },
      ],
      [
        {
          type: 'function',
          function: { name: 'lookup', description: 'Search saved records.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
        },
      ],
    );
    return { ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, tools: !!reply.tool_calls?.length };
  } catch (err) {
    return { ok: false, seconds: Math.round((Date.now() - started) / 100) / 10, tools: false, error: err instanceof Error ? err.message.slice(0, 300) : 'failed' };
  }
}
