import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import type { Provider, Settings } from './types.ts';

/** Everything needed to reach a model. Kept on disk; the key never leaves the server. */
export interface LlmSettings {
  provider: Provider;
  /** OpenAI-compatible base URL, ending in /v1 for Ollama. */
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface Stored {
  name?: string;
  setupDone?: boolean;
  llm?: Partial<LlmSettings>;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** True when the address is this computer, so nothing leaves it. */
export function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The root of an Ollama server, from its OpenAI-style address: http://localhost:11434/v1 becomes http://localhost:11434 */
export function ollamaOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/**
 * Settings changed from the screen, stored as JSON next to the database.
 * Anything not set here falls back to .env, then to built-in defaults, so .env keeps working.
 */
export class SettingsStore {
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'settings.json');
  }

  private stored(): Stored | null {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return v && typeof v === 'object' ? v : {};
    } catch {
      return null; // never set up
    }
  }

  /** Full settings, including the key. For the server's own use. */
  read(): { name: string; setupDone: boolean; llm: LlmSettings } {
    const s = this.stored();
    return {
      name: s?.name || 'Linsia',
      // A settings file from before first-run setup existed counts as already set up.
      setupDone: s ? s.setupDone !== false : false,
      llm: {
        provider: s?.llm?.provider ?? (isLocalUrl(config.llm.baseUrl) ? 'ollama' : 'openai'),
        baseUrl: s?.llm?.baseUrl || config.llm.baseUrl,
        model: s?.llm?.model || config.llm.model,
        apiKey: s?.llm?.apiKey ?? config.llm.apiKey,
      },
    };
  }

  /** What the screen may see: everything except the key itself. */
  public(): Settings {
    const { name, setupDone, llm } = this.read();
    return {
      name,
      setupDone,
      llm: { provider: llm.provider, baseUrl: llm.baseUrl, model: llm.model, hasKey: !!llm.apiKey && llm.apiKey !== 'ollama', local: isLocalUrl(llm.baseUrl) },
    };
  }

  /** Apply a change from the screen. Throws with a readable message when a value is not usable. */
  write(patch: unknown): Settings {
    const src = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const before = this.stored();
    // The very first save happens inside first-run setup, which is not finished until it says so.
    const next: Stored = before ? { ...before } : { setupDone: false };

    const name = text(src.name, 40);
    if (name) next.name = name;
    if (typeof src.setupDone === 'boolean') next.setupDone = src.setupDone;

    if (src.llm && typeof src.llm === 'object') {
      const l = src.llm as Record<string, unknown>;
      const llm: Partial<LlmSettings> = { ...(next.llm ?? {}) };
      if (l.provider === 'ollama' || l.provider === 'openai') llm.provider = l.provider;

      if (l.baseUrl !== undefined) {
        let url: URL;
        try {
          url = new URL(text(l.baseUrl, 300));
        } catch {
          throw new Error('The server address is not a valid URL. Example: http://localhost:11434/v1');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The server address must start with http:// or https://');
        let base = url.toString().replace(/\/+$/, '');
        // Ollama's OpenAI-style API lives under /v1. Accept the bare address too.
        if ((llm.provider ?? 'ollama') === 'ollama' && !/\/v1$/.test(base)) base = `${url.origin}/v1`;
        llm.baseUrl = base;
      }
      if (l.model !== undefined) {
        const model = text(l.model, 100);
        if (!model) throw new Error('Choose a model.');
        llm.model = model;
      }
      // An empty key field means "leave the saved key alone". null clears it.
      if (l.apiKey === null) llm.apiKey = '';
      else if (typeof l.apiKey === 'string' && l.apiKey.trim()) llm.apiKey = l.apiKey.trim().slice(0, 500);
      next.llm = llm;
    }

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return this.public();
  }
}
