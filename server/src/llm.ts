import { config } from './config.ts';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** One model call. Swappable so tests can run without a model. */
export type LlmFn = (messages: LlmMessage[], tools: ToolSpec[]) => Promise<LlmMessage>;

/**
 * Talks to any OpenAI-compatible /chat/completions endpoint (Ollama, LM Studio, Mistral, OpenAI).
 * Settings are read on every call, so a change on the Settings page takes effect at once.
 */
export function makeChat(settings: () => { baseUrl: string; model: string; apiKey: string }): LlmFn {
  return async (messages, tools) => {
    const { baseUrl, model, apiKey } = settings();
    const timeoutMs = config.llm.timeoutMs;
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || 'none'}` },
        body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, temperature: 0.2, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : 'connection failed';
      throw new Error(`Cannot reach the model at ${baseUrl} (${why}). Open Settings to check the model.`);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      if (res.status === 404 && /not found/i.test(body)) throw new Error(`The model "${model}" is not downloaded. Open Settings to get it.`);
      if (res.status === 401 || res.status === 403) throw new Error('The model server refused the key. Open Settings to fix it.');
      throw new Error(`Model "${model}" returned ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { choices?: { message?: LlmMessage }[] };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('Model returned an empty response.');
    return { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls };
  };
}
