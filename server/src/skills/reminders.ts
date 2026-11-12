import { MAX_UPCOMING } from '../reminders.ts';
import { describeWhen, localDate, parseClock } from '../time.ts';
import { isIsoDate } from '../memory.ts';
import type { Skill, Tool } from './types.ts';

const MAX_PER_TURN = 3;
const MAX_AHEAD_MS = 2 * 366 * 86_400_000;

const setReminder: Tool = {
  name: 'set_reminder',
  label: 'Set a one-off reminder for a time you name',
  description:
    'Set a one-off reminder. Give EITHER in_minutes (for "in 20 minutes", "in 2 hours") OR date and time (for "tomorrow at 9", "on 14 March"). The exact time is worked out in code and shown to the user.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to remind the user about, in a few words.' },
      in_minutes: { type: 'integer', description: 'Minutes from now. Use for relative times.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Use with time for a specific day.' },
      time: { type: 'string', description: '24-hour HH:MM, e.g. 17:30. Defaults to 09:00 when only a date is given.' },
    },
    required: ['text'],
  },
  async run(args, ctx) {
    const text = typeof args.text === 'string' ? args.text.trim().slice(0, 200) : '';
    if (!text) return { forModel: 'Not set: say what the reminder is about in "text".' };

    let due: Date;
    let note = '';
    const minutes = Number(args.in_minutes);
    if (args.in_minutes !== undefined && args.in_minutes !== null && args.in_minutes !== '') {
      if (!Number.isFinite(minutes) || minutes < 1) return { forModel: 'Not set: in_minutes must be a whole number of at least 1.' };
      due = new Date(ctx.now.getTime() + Math.round(minutes) * 60_000);
    } else {
      const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : localDate(ctx.now);
      if (!isIsoDate(date)) return { forModel: `Not set: date "${date}" is not a valid YYYY-MM-DD date.` };
      const rawTime = typeof args.time === 'string' ? args.time.trim() : '';
      if (!rawTime && !args.date) return { forModel: 'Not set: give in_minutes, or a date and time. Ask the user when they want it.' };
      const mins = rawTime ? parseClock(rawTime) : 9 * 60;
      if (mins === null) return { forModel: `Not set: time "${rawTime}" is not valid. Use 24-hour HH:MM.` };
      if (!rawTime) note = ' No time was given, so 9:00 AM was used. Tell the user that.';
      const [y, m, d] = date.split('-').map(Number);
      due = new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60);
    }

    if (due.getTime() <= ctx.now.getTime()) {
      return { forModel: `Not set: ${describeWhen(due, ctx.now)} has already passed. Ask the user which day they mean.` };
    }
    if (due.getTime() - ctx.now.getTime() > MAX_AHEAD_MS) return { forModel: 'Not set: reminders can be at most two years ahead.' };
    if (ctx.reminders.upcoming().length >= MAX_UPCOMING) {
      return { forModel: `Not set: there are already ${MAX_UPCOMING} reminders waiting. Tell the user to clear some from the Memory panel.` };
    }
    ctx.remindersThisTurn = (ctx.remindersThisTurn ?? 0) + 1;
    if (ctx.remindersThisTurn > MAX_PER_TURN) return { forModel: `Not set: at most ${MAX_PER_TURN} reminders per message.` };

    let reminder = ctx.reminders.add(text, due);
    // The assistant's own copy is saved first, so a failed hand-off never loses the reminder.
    const systemId = await ctx.handOff?.(text, due).catch(() => null);
    if (systemId) reminder = ctx.reminders.linkSystem(reminder.id, systemId);
    return {
      reminders: [reminder],
      forModel: `Reminder set: "${text}" ${describeWhen(due, ctx.now)}.${note} Confirm to the user with exactly that time. They can cancel it from the card.`,
    };
  },
};

const listReminders: Tool = {
  name: 'list_reminders',
  label: 'Show the reminders that are waiting',
  description: 'List the reminders that are waiting.',
  parameters: { type: 'object', properties: {} },
  run(_args, ctx) {
    const waiting = ctx.reminders.upcoming();
    if (!waiting.length) return { forModel: 'No reminders are waiting.' };
    return {
      reminders: waiting,
      forModel: waiting.map((r) => `"${r.text}" ${describeWhen(new Date(r.due_at), ctx.now)}`).join('; '),
    };
  },
};

export const remindersSkill: Skill = {
  name: 'reminders',
  title: 'Reminders',
  summary: 'Nudges you at a set time with a notification and on screen.',
  examples: ['Remind me to call the plumber in 20 minutes', 'Remind me tomorrow at 9 to renew the insurance', 'What reminders do I have?'],
  match: /\bremind|\breminder|\balarm|\bnotify|\bnudge|\bping me|\bwake me|don'?t let me forget/i,
  instructions: `You can set one-off reminders with "set_reminder" and show waiting ones with "list_reminders".
- For "in 20 minutes" or "in 2 hours" pass in_minutes. For a named day or clock time pass date and time. Do not work out clock times yourself.
- If the user did not say when, ask. Do not pick a time for them.
- You cannot cancel or change reminders. Tell the user to press Cancel on the reminder card.`,
  tools: [setReminder, listReminders],
};
