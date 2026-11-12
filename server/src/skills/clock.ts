import { isIsoDate } from '../memory.ts';
import { addToDate, daysBetween, findZone, localDate, longDate, spokenDate, spokenTime } from '../time.ts';
import type { Skill, Tool } from './types.ts';

const whole = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

const timeIn: Tool = {
  name: 'time_in',
  label: 'Tell the time in another city or country',
  description: 'Current date and time in another place. For the user\'s own local time, read it from "Right now" above instead.',
  parameters: {
    type: 'object',
    properties: { place: { type: 'string', description: 'A city, country or time zone, e.g. "New York", "Japan", "Europe/London".' } },
    required: ['place'],
  },
  run(args, ctx) {
    const place = typeof args.place === 'string' ? args.place : '';
    const zone = findZone(place);
    if (!zone) return { forModel: `No time zone found for "${place}". Try the nearest major city, or say you cannot tell.` };
    return { forModel: `In ${place} it is ${spokenTime(ctx.now, zone)}, on ${spokenDate(ctx.now, zone)}.` };
  },
};

const dateMath: Tool = {
  name: 'date_math',
  label: 'Work out dates exactly: add a warranty period, count days until something',
  description:
    'Exact calendar arithmetic. Either add years, months and days to a date (e.g. purchase date plus a 2-year warranty), or count the days from one date until another. Always use this instead of working dates out yourself.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Starting date, YYYY-MM-DD. Defaults to today.' },
      add_years: { type: 'integer' },
      add_months: { type: 'integer' },
      add_days: { type: 'integer' },
      until: { type: 'string', description: 'YYYY-MM-DD. When given, returns the number of days from date until this date.' },
    },
  },
  run(args, ctx) {
    const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : localDate(ctx.now);
    if (!isIsoDate(date)) return { forModel: `"${date}" is not a valid YYYY-MM-DD date.` };

    if (typeof args.until === 'string' && args.until.trim()) {
      const until = args.until.trim();
      if (!isIsoDate(until)) return { forModel: `"${until}" is not a valid YYYY-MM-DD date.` };
      const n = daysBetween(date, until);
      return { forModel: n >= 0 ? `That is ${n} days away.` : `That was ${-n} days ago.` };
    }

    const add = { years: whole(args.add_years), months: whole(args.add_months), days: whole(args.add_days) };
    if (!add.years && !add.months && !add.days) return { forModel: `${date} is ${longDate(date)}.` };

    if (Math.abs(add.years) > 200 || Math.abs(add.months) > 2400 || Math.abs(add.days) > 73_000) return { forModel: 'That is too far away to work out.' };
    const result = addToDate(date, add);
    return { forModel: `That comes to ${longDate(result)}. In tool arguments it is ${result}.` };
  },
};

export const clockSkill: Skill = {
  name: 'clock',
  title: 'Time and dates',
  summary: "Knows this computer's date, time and time zone, and does calendar arithmetic in code.",
  examples: ['What time is it in Tokyo?', 'How many days until 14 March 2027?', 'Bought on 3 January 2026 with a two year warranty. When does it end?'],
  match: /\btime\b|\bo'?clock\b|\btimezone|\btime zone|\bdate\b|\bday\b|\bdays\b|\bweeks?\b|\bmonths?\b|\byears?\b|\buntil\b|\bfrom now\b|\bago\b|\bhow long\b|\bwarranty\b|\bvalid\b|\bexpir/i,
  instructions: `Dates and times:
- The current time and date are at the top of these instructions. Answer "what time is it" with just the time, in the words given there.
- For the time anywhere else, call "time_in".
- For any date arithmetic (a purchase date plus a warranty period, days until something), call "date_math". Never do it in your head.`,
  tools: [timeIn, dateMath],
};
