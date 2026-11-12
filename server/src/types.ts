// Shared between server and web. Types and plain constants only.

export const KINDS = ['warranty', 'insurance', 'document', 'subscription', 'note'] as const;
export type Kind = (typeof KINDS)[number];

export interface FileRef {
  id: number;
  name: string;
  mime: string;
  size: number;
  /** True when text was read out of the file (OCR or PDF text). */
  has_text: boolean;
}

export interface EntryFields {
  title: string;
  kind: Kind;
  details: string;
  /** Where the physical thing is kept, e.g. "blue file, bedroom shelf". */
  location: string | null;
  /** Whose it is. Empty means the user. */
  owner: string | null;
  purchase_date: string | null; // YYYY-MM-DD
  expiry_date: string | null; // YYYY-MM-DD
}

export interface Entry extends EntryFields {
  id: number;
  raw_input: string | null;
  created_at: string;
  updated_at: string;
  files: FileRef[];
  /** Computed in code, never by the model. Negative means already expired. */
  days_left: number | null;
}

/** Something the model wants to save. Nothing is stored until the user confirms it. */
export interface Draft extends EntryFields {
  draftId: string;
  raw_input: string | null;
  files: FileRef[];
}

/** A one-off nudge at a set time. */
export interface Reminder {
  id: number;
  text: string;
  /** When it is due, as an ISO timestamp. */
  due_at: string;
  fired_at: string | null;
  cancelled: boolean;
  /** Also handed to the operating system's own reminders app, so it goes off even when the assistant is closed. */
  in_system: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** How the assistant feels about what just happened. Drives its face, never its words. */
export type Mood = 'neutral' | 'happy' | 'sorry' | 'curious' | 'alert' | 'surprised' | 'sleepy';

export interface ChatResponse {
  reply: string;
  mood: Mood;
  cards: Entry[];
  drafts: Draft[];
  /** Reminders set or listed this turn. */
  reminders: Reminder[];
}

/** What the assistant can do, in plain words, for the Abilities panel. */
export interface Abilities {
  skills: { name: string; title: string; summary: string; examples: string[]; tools: string[] }[];
  extras: { name: string; ready: boolean; note: string }[];
  /** Things it is built not to do. */
  limits: string[];
}

export interface Health {
  ok: true;
  model: string;
  /** Voice input is set up (whisper.cpp binary and model found). */
  voice: boolean;
  /** Document reading is set up (bin/ocr built). */
  ocr: boolean;
}

/** 'ollama' runs models on this computer. 'openai' is any other server that speaks the OpenAI chat API. */
export type Provider = 'ollama' | 'openai';

export interface Settings {
  /** The assistant's name. */
  name: string;
  /** False until first-run setup has been finished or skipped. */
  setupDone: boolean;
  llm: {
    provider: Provider;
    baseUrl: string;
    model: string;
    /** A key is saved. The key itself is never sent to the screen. */
    hasKey: boolean;
    /** The model runs on this computer, so nothing leaves it. */
    local: boolean;
  };
}

export interface ModelChoice {
  name: string;
  sizeGb?: number;
  note?: string;
  recommended?: boolean;
}

export interface ModelStatus {
  provider: Provider;
  /** The model server answered. */
  reachable: boolean;
  /** Ollama is installed on this computer (always true for other servers). */
  installed: boolean;
  /** Models the server has. */
  models: ModelChoice[];
  /** The chosen model is one of them. */
  modelReady: boolean;
  /** Models worth downloading, sized to this computer's memory. */
  recommended: ModelChoice[];
  ramGb: number;
  error?: string;
}

export interface ModelTest {
  ok: boolean;
  seconds: number;
  /** It called a tool when asked to. Without this the assistant cannot remember or look things up. */
  tools: boolean;
  error?: string;
}
