import type { Memory } from '../memory.ts';
import type { Reminders } from '../reminders.ts';
import type { Draft, Entry, Reminder } from '../types.ts';

export interface ToolContext {
  memory: Memory;
  reminders: Reminders;
  /** The current moment. Tools never read the clock themselves. */
  now: Date;
  /** Hands a reminder to the operating system's own reminders app. Resolves to its id there, or null when that is unavailable. */
  handOff?: (text: string, due: Date) => Promise<string | null>;
  /** What the user typed or said this turn. */
  userText: string;
  /** Files the user attached to this turn. */
  attachments: number[];
  /** Count of reminders created in this turn, for the per-message cap. */
  remindersThisTurn?: number;
}

export interface ToolResult {
  /** Text the model reads. Keep it short: small models lose the thread in long results. */
  forModel: string;
  /** Records to show the user as cards. */
  cards?: Entry[];
  /** Something to save, pending the user's confirmation. */
  draft?: Draft;
  /** Reminders to show the user as cards. */
  reminders?: Reminder[];
  /** The user asked for something that is not saved. */
  missed?: boolean;
}

export interface Tool {
  name: string;
  /** What this lets the assistant do, in plain words, for the Abilities panel. */
  label: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
}

/**
 * A skill is a group of tools plus the instructions for using them.
 * To teach the assistant something new, add a skill file and list it in registry.ts.
 */
export interface Skill {
  name: string;
  /** Shown in the Abilities panel. */
  title: string;
  summary: string;
  /** Things a user could say. Shown as suggestions. */
  examples: string[];
  instructions: string;
  tools: Tool[];
  /**
   * When set, the skill is offered to the model only if this matches the user's message
   * (or the last exchange). Keeps the tool list short, which small models need.
   * Leave unset for skills that should always be on.
   */
  match?: RegExp;
}
