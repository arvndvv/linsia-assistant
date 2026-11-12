import type { LlmFn, LlmMessage, ToolSpec } from './llm.ts';
import type { Memory } from './memory.ts';
import type { Reminders } from './reminders.ts';
import { describeMoment, localDate } from './time.ts';
import { skills as allSkills } from './skills/registry.ts';
import type { Skill, Tool, ToolContext } from './skills/types.ts';
import type { ChatMessage, ChatResponse, Draft, Entry, Mood, Reminder } from './types.ts';

const MAX_STEPS = 4;
const HISTORY_TURNS = 12;
/** How much text from an attached document the model gets to read. Small models have small windows. */
const DOC_CHARS = 2500;

export interface TurnInput {
  message: string;
  history: ChatMessage[];
  attachments: number[];
}

export interface AgentDeps {
  llm: LlmFn;
  memory: Memory;
  reminders: Reminders;
  name: string;
  skills?: Skill[];
  /** Puts reminders into the operating system's reminders app too. Optional. */
  handOff?: (text: string, due: Date) => Promise<string | null>;
  /** The clock. Tests pass a fixed one. */
  now?: () => Date;
}

/** Always-on skills, plus those whose pattern matches this message or the exchange just before it. */
export function pickSkills(all: Skill[], message: string, history: ChatMessage[]): Skill[] {
  const recent = [message, ...history.slice(-2).map((m) => m.content)].join('\n');
  return all.filter((s) => !s.match || s.match.test(recent));
}

function systemPrompt(name: string, now: Date, skills: Skill[]): string {
  return `You are ${name}, a personal assistant that runs privately on the user's own computer.
Right now: ${describeMoment(now)}. Today's date is ${localDate(now)}.
This is the only clock you have. Never state a time or date that does not come from here or from a tool.
Replies may be read aloud: keep them short and plain, one to three sentences, no markdown.
If you do not know something, say so. Never make up facts about the user's things.

${skills.map((s) => s.instructions).join('\n\n')}`;
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** One user turn: let the model call tools until it answers, within a step limit. */
export async function runTurn(input: TurnInput, deps: AgentDeps): Promise<ChatResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const skills = pickSkills(deps.skills ?? allSkills, input.message, input.history);
  const tools = new Map<string, Tool>(skills.flatMap((s) => s.tools).map((t) => [t.name, t]));
  const specs: ToolSpec[] = [...tools.values()].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const files = deps.memory.filesByIds(input.attachments);
  const attachedNote = files
    .map((f) => {
      const text = deps.memory.getFile(f.id)?.text;
      return text
        ? `\n[Attached file: ${f.name}. Text read from it:]\n${text.slice(0, DOC_CHARS)}\n[End of ${f.name}]`
        : `\n[Attached file: ${f.name}. Its contents could not be read.]`;
    })
    .join('');

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(deps.name, now, skills) },
    ...input.history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.message + attachedNote },
  ];

  const cards = new Map<number, Entry>();
  const drafts: Draft[] = [];
  let missed = false;

  const done = (reply: string): ChatResponse => {
    const found = [...cards.values()];
    let mood: Mood = 'neutral';
    if (drafts.length) mood = 'curious';
    else if (found.some((c) => c.days_left !== null && c.days_left <= 30)) mood = 'alert';
    else if (found.length || reminders.size) mood = 'happy';
    else if (missed) mood = 'sorry';
    return { reply, mood, cards: found, drafts, reminders: [...reminders.values()] };
  };
  const reminders = new Map<number, Reminder>();
  const ctx: ToolContext = { memory: deps.memory, reminders: deps.reminders, handOff: deps.handOff, now, userText: input.message, attachments: files.map((f) => f.id) };

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await deps.llm(messages, specs);
    const calls = reply.tool_calls ?? [];

    if (!calls.length) {
      return done((reply.content ?? '').trim() || 'I have nothing to add.');
    }

    messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: calls });

    for (const call of calls) {
      const tool = tools.get(call.function.name);
      const args = parseArgs(call.function.arguments);
      let forModel: string;
      if (!tool) {
        forModel = `Unknown tool "${call.function.name}". Available: ${[...tools.keys()].join(', ')}.`;
      } else if (!args) {
        forModel = 'Arguments were not valid JSON. Call the tool again with a JSON object.';
      } else {
        try {
          const result = await tool.run(args, ctx);
          forModel = result.forModel;
          for (const card of result.cards ?? []) cards.set(card.id, card);
          if (result.draft) drafts.push(result.draft);
          if (result.missed) missed = true;
          for (const r of result.reminders ?? []) reminders.set(r.id, r);
        } catch (err) {
          forModel = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: forModel });
    }
  }

  // Step limit reached without a plain answer. Report honestly instead of looping.
  const fallback = drafts.length
    ? 'Please check the card and confirm.'
    : cards.size
      ? 'Here is what I found.'
      : reminders.size
        ? 'Done. The reminder is on the card.'
        : 'I could not work that out. Try asking in a different way.';
  return done(fallback);
}
