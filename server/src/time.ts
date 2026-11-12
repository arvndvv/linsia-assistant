// Everything about clocks and calendars lives here, in code. The model is never trusted with date arithmetic.

const pad = (n: number) => String(n).padStart(2, '0');

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** YYYY-MM-DD in the computer's own time zone. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clock(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
}

function offset(d: Date, timeZone?: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName');
  return (part?.value ?? 'GMT').replace('GMT', 'UTC') || 'UTC';
}

/** The part of the day a person would name: "in the morning", "at night". */
function partOfDay(hour: number): string {
  if (hour < 5) return 'at night';
  if (hour < 12) return 'in the morning';
  if (hour < 17) return 'in the afternoon';
  if (hour < 21) return 'in the evening';
  return 'at night';
}

/** "6:10 in the morning" — the time as someone would say it out loud. */
export function spokenTime(d: Date, timeZone: string = localZone()): string {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone }).format(d).split(':').map(Number);
  if (minute === 0 && hour === 12) return 'midday';
  if (minute === 0 && hour === 0) return 'midnight';
  return `${clock(d, timeZone).replace(/\s?[AP]M$/i, '')} ${partOfDay(hour)}`;
}

/** "Thursday 12 November 2026" */
export function spokenDate(d: Date, timeZone: string = localZone()): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).replace(',', '');
}

/** "Thursday, 12 November 2026, 6:10 AM (Asia/Kolkata, UTC+05:30)" — the exact version, for when precision matters. */
export function describeMoment(d: Date, timeZone: string = localZone()): string {
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone });
  return `${day}, ${clock(d, timeZone)} (${timeZone}, ${offset(d, timeZone)})`;
}

/** "today at 5:30 PM", "tomorrow at 9:00 AM", "Sat 14 Nov 2026 at 9:00 AM" */
export function describeWhen(due: Date, now: Date): string {
  const days = Math.round((Date.parse(`${localDate(due)}T00:00:00Z`) - Date.parse(`${localDate(now)}T00:00:00Z`)) / 86_400_000);
  const day =
    days === 0 ? 'today' : days === 1 ? 'tomorrow' : due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${day} at ${clock(due)}`;
}

/** Accepts "17:30", "5:30 pm", "5pm", "9". Returns minutes after midnight, or null. */
export function parseClock(input: string): number | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(input.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const half = m[3]?.toLowerCase().replace(/\./g, '');
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'pm' ? 12 : 0);
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

/** Add calendar time to a YYYY-MM-DD date. Month ends are clamped: 31 Jan + 1 month is the last day of Feb. */
export function addToDate(iso: string, add: { years?: number; months?: number; days?: number }): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = y * 12 + (m - 1) + (add.years ?? 0) * 12 + (add.months ?? 0);
  const year = Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const base = Date.UTC(year, month, Math.min(d, lastDay));
  return new Date(base + (add.days ?? 0) * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const COUNTRY_ZONES: Record<string, string> = {
  india: 'Asia/Kolkata',
  uk: 'Europe/London',
  britain: 'Europe/London',
  england: 'Europe/London',
  japan: 'Asia/Tokyo',
  uae: 'Asia/Dubai',
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  china: 'Asia/Shanghai',
  qatar: 'Asia/Qatar',
  'saudi arabia': 'Asia/Riyadh',
  'new zealand': 'Pacific/Auckland',
  bangalore: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  kochi: 'Asia/Kolkata',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  boston: 'America/New_York',
  washington: 'America/New_York',
};

/** Turn "America/New_York", "new york", "Tokyo" or "India" into a real time zone name, or null. */
export function findZone(input: string): string | null {
  const wanted = input.trim().toLowerCase().replace(/_/g, ' ');
  if (!wanted) return null;
  if (COUNTRY_ZONES[wanted]) return COUNTRY_ZONES[wanted];
  const zones = Intl.supportedValuesOf('timeZone');
  return (
    zones.find((z) => z.toLowerCase().replace(/_/g, ' ') === wanted) ??
    zones.find((z) => z.split('/').pop()!.toLowerCase().replace(/_/g, ' ') === wanted) ??
    (wanted === 'utc' || wanted === 'gmt' ? 'UTC' : null)
  );
}
