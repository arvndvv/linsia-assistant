import type { Abilities, ChatMessage, ChatResponse, Entry, EntryFields, FileRef, Health, ModelStatus, ModelTest, Provider, Reminder, Settings } from '../../server/src/types.ts';

export interface SettingsPatch {
  name?: string;
  setupDone?: boolean;
  llm?: { provider?: Provider; baseUrl?: string; model?: string; apiKey?: string | null };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Cannot reach the assistant server. Is "npm run dev" still running?');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  abilities: () => request<Abilities>('/api/abilities'),
  health: () => request<Health>('/api/health'),
  attention: () => request<Entry[]>('/api/attention'),
  transcribe: (wav: Blob) => request<{ text: string }>('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }),

  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: SettingsPatch) => request<Settings>('/api/settings', json('PUT', patch)),

  modelStatus: () => request<ModelStatus>('/api/model/status'),
  testModel: () => request<ModelTest>('/api/model/test', { method: 'POST' }),
  startOllama: () => request<{ started: boolean }>('/api/model/start', { method: 'POST' }),

  /** Download a model. `onProgress` gets a status line and, when known, a fraction from 0 to 1. */
  async pullModel(model: string, onProgress: (status: string, fraction: number | null) => void): Promise<void> {
    const res = await fetch('/api/model/pull', json('POST', { model }));
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? 'Download could not start.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
        if (msg.error) throw new Error(msg.error);
        onProgress(msg.status ?? '', msg.total ? (msg.completed ?? 0) / msg.total : null);
      }
    }
  },

  chat: (message: string, history: ChatMessage[], attachments: number[]) =>
    request<ChatResponse>('/api/chat', json('POST', { message, history, attachments })),

  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<FileRef>('/api/files', { method: 'POST', body: form });
  },

  reminders: () => request<Reminder[]>('/api/reminders'),
  firedReminders: () => request<Reminder[]>('/api/reminders/fired'),
  cancelReminder: (id: number) => request<{ ok: true }>(`/api/reminders/${id}`, { method: 'DELETE' }),

  entries: (q = '') => request<Entry[]>(`/api/entries${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createEntry: (fields: EntryFields, extra: { raw_input: string | null; fileIds: number[] }) =>
    request<Entry>('/api/entries', json('POST', { ...fields, ...extra })),
  updateEntry: (id: number, fields: EntryFields) => request<Entry>(`/api/entries/${id}`, json('PUT', fields)),
  deleteEntry: (id: number) => request<{ ok: true }>(`/api/entries/${id}`, { method: 'DELETE' }),
};
