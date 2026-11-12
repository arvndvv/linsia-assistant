import { randomUUID } from 'node:crypto';
import { normalizeFields } from '../memory.ts';
import { KINDS, type Entry } from '../types.ts';
import type { Skill, Tool } from './types.ts';

/** Compact view of a record for the model. */
function brief(e: Entry) {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    details: e.details || undefined,
    kept_at: e.location ?? undefined,
    owner: e.owner ?? undefined,
    purchase_date: e.purchase_date ?? undefined,
    expiry_date: e.expiry_date ?? undefined,
    days_left: e.days_left ?? undefined,
    files: e.files.length ? e.files.map((f) => f.name) : undefined,
  };
}

const remember: Tool = {
  name: 'remember',
  label: 'Save a fact or document you give it, after you confirm the card',
  description:
    'Propose saving something the user told you or sent you: a warranty, insurance policy, document, subscription, or any fact such as where a paper is kept. The user sees a card and confirms it. Nothing is saved until they do.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short name of the thing, e.g. "LG fridge warranty".' },
      kind: { type: 'string', enum: [...KINDS] },
      details: { type: 'string', description: 'Other facts worth keeping: provider, model, policy name, notes.' },
      location: { type: 'string', description: 'Where the physical item or paper is kept, if the user said.' },
      owner: { type: 'string', description: 'Whose it is, if not the user, e.g. "mother".' },
      purchase_date: { type: 'string', description: 'YYYY-MM-DD. Only if the user gave it.' },
      expiry_date: { type: 'string', description: 'YYYY-MM-DD. Only if the user gave it or it follows directly from what they said.' },
    },
    required: ['title', 'kind'],
  },
  run(args, ctx) {
    const { fields, problems } = normalizeFields(args);
    if (!fields) return { forModel: `Not drafted: ${problems.join('; ')}. Call remember again with a title.` };
    const draft = {
      ...fields,
      draftId: randomUUID(),
      raw_input: ctx.userText || null,
      files: ctx.memory.filesByIds(ctx.attachments),
    };
    const note = problems.length ? ` Problems: ${problems.join('; ')}.` : '';
    return {
      draft,
      forModel: `Draft shown to the user as a card. It is NOT saved yet.${note} Tell the user in one short sentence to check the card and confirm.`,
    };
  },
};

const recall: Tool = {
  name: 'recall',
  label: 'Search what you have saved, including text inside documents',
  description:
    'Search what the user has saved. Use before answering any question about their warranties, expiries, insurance, documents, or where something is kept.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Keywords, e.g. "fridge warranty".' } },
    required: ['query'],
  },
  run(args, ctx) {
    const query = typeof args.query === 'string' ? args.query : '';
    const found = ctx.memory.search(query, 5);
    if (!found.length) return { missed: true, forModel: `Nothing saved matches "${query}". Say you do not have it. Do not guess.` };
    return { cards: found, forModel: JSON.stringify(found.map(brief)) };
  },
};

const listExpiring: Tool = {
  name: 'list_expiring',
  label: 'List what expires in the coming days',
  description: 'List saved items that expire within the next N days.',
  parameters: {
    type: 'object',
    properties: { days: { type: 'integer', description: 'How many days ahead to look. Default 60.' } },
  },
  run(args, ctx) {
    const n = Number(args.days);
    const days = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 3650) : 60;
    const found = ctx.memory.expiring(days);
    if (!found.length) return { forModel: `Nothing expires in the next ${days} days.` };
    return { cards: found, forModel: JSON.stringify(found.map(brief)) };
  },
};

export const memorySkill: Skill = {
  name: 'memory',
  title: 'Memory',
  summary: 'Keeps your warranties, insurance, documents, expiry dates, and where the papers are.',
  examples: ['My passport is in the grey locker', 'When does the AC warranty end?', 'What expires in the next two months?'],
  instructions: `You keep the user's records: warranties, insurance, documents, expiry dates, and where physical papers are kept.
- When the user tells you a fact worth keeping or attaches a file, call "remember". If an attached file comes with text read from it, take the name, dates and details from that text. If its contents could not be read and they did not say what it is, ask before calling it.
- When the user asks about anything they may have saved, call "recall" first. Answer only from what it returns.
- Dates in tool calls are YYYY-MM-DD. Never invent a date. If the user gave a purchase date and a warranty length, get the expiry date from "date_math".
- "days_left" in results is already computed. Use it as given.
- The user sees matching records as cards next to your reply, so keep the reply to the answer itself.`,
  tools: [remember, recall, listExpiring],
};
