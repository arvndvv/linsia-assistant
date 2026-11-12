import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn } from '../src/agent.ts';
import { openDb } from '../src/db.ts';
import type { LlmFn, LlmMessage } from '../src/llm.ts';
import { findProgram } from '../src/local.ts';
import { Memory, normalizeFields } from '../src/memory.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recommendModels, validModelName } from '../src/models.ts';
import { Reminders } from '../src/reminders.ts';
import { SettingsStore } from '../src/settings.ts';
import { addToDate, describeWhen, findZone, parseClock, spokenTime } from '../src/time.ts';
import type { EntryFields } from '../src/types.ts';

const TODAY = '2026-11-11';
const AT_TODAY = () => new Date(2026, 10, 11, 10, 0);
const newMemory = (today: () => string = () => TODAY) => new Memory(openDb(':memory:'), today);
/** Thursday 12 Nov 2026, 06:10 local. */
const NOW = new Date(2026, 10, 12, 6, 10);
const newReminders = (now: () => Date = () => NOW) => new Reminders(openDb(':memory:'), now);

const base: Omit<EntryFields, 'title' | 'kind'> = { details: '', location: null, owner: null, purchase_date: null, expiry_date: null };

/** A scripted stand-in for the model: returns the given replies in order. */
function scripted(replies: LlmMessage[]): LlmFn & { seen: LlmMessage[][] } {
  const seen: LlmMessage[][] = [];
  const fn: LlmFn = async (messages) => {
    seen.push(structuredClone(messages));
    const next = replies.shift();
    if (!next) throw new Error('script ran out');
    return next;
  };
  return Object.assign(fn, { seen });
}

const call = (name: string, args: unknown): LlmMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }],
});
const say = (content: string): LlmMessage => ({ role: 'assistant', content });

test('normalizeFields drops bad dates and unknown kinds instead of guessing', () => {
  const { fields, problems } = normalizeFields({ title: ' Fridge ', kind: 'appliance', expiry_date: '14/03/2027', purchase_date: '2026-02-30' });
  assert.equal(fields?.title, 'Fridge');
  assert.equal(fields?.kind, 'note');
  assert.equal(fields?.expiry_date, null);
  assert.equal(fields?.purchase_date, null);
  assert.equal(problems.length, 3);
  assert.equal(normalizeFields({ kind: 'warranty' }).fields, null);
});

test('search finds by item, by location, and ignores filler words', () => {
  const m = newMemory();
  m.add({ ...base, title: 'Voltas AC warranty', kind: 'warranty', location: 'blue file, bedroom shelf', expiry_date: '2027-03-14' });
  m.add({ ...base, title: 'Car insurance', kind: 'insurance', details: 'HDFC Ergo, comprehensive' });

  assert.equal(m.search('where is my AC warranty card kept?')[0].title, 'Voltas AC warranty');
  assert.equal(m.search('blue file')[0].title, 'Voltas AC warranty');
  assert.equal(m.search('insurances')[0].title, 'Car insurance'); // stemming
  assert.deepEqual(m.search('where is it'), []);
  assert.deepEqual(m.search('passport'), []);
});

test('days_left and expiring are computed from today', () => {
  const m = newMemory();
  const soon = m.add({ ...base, title: 'Bike insurance', kind: 'insurance', expiry_date: '2026-12-01' });
  const past = m.add({ ...base, title: 'Mixer warranty', kind: 'warranty', expiry_date: '2026-11-01' });
  m.add({ ...base, title: 'Passport', kind: 'document', expiry_date: '2031-05-20' });

  assert.equal(soon.days_left, 20);
  assert.equal(past.days_left, -10);
  assert.deepEqual(m.expiring(60).map((e) => e.title), ['Bike insurance']);
});

test('update re-indexes search; remove detaches files', () => {
  const m = newMemory();
  const file = m.addFile({ name: 'bill.pdf', stored_name: 'x.pdf', mime: 'application/pdf', size: 10 });
  const e = m.add({ ...base, title: 'Fridge warranty', kind: 'warranty' }, { fileIds: [file.id] });
  assert.equal(e.files[0].name, 'bill.pdf');

  m.update(e.id, { ...base, title: 'Refrigerator warranty', kind: 'warranty', location: 'steel almirah' });
  assert.equal(m.search('almirah').length, 1);
  assert.equal(m.search('fridge').length, 0);

  assert.equal(m.remove(e.id), true);
  assert.equal(m.search('refrigerator').length, 0);
  assert.ok(m.getFile(file.id));
});

test('remember produces a draft and saves nothing', async () => {
  const m = newMemory();
  const file = m.addFile({ name: 'ac-bill.jpg', stored_name: 'a.jpg', mime: 'image/jpeg', size: 5 });
  const llm = scripted([
    call('remember', { title: 'Voltas AC warranty', kind: 'warranty', location: 'blue file', expiry_date: '2027-03-14' }),
    say('Check the card and confirm.'),
  ]);

  const out = await runTurn({ message: 'AC warranty card is in the blue file, valid till 14 March 2027', history: [], attachments: [file.id] }, { llm, memory: m, reminders: newReminders(), name: 'Nila', now: AT_TODAY });

  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].expiry_date, '2027-03-14');
  assert.equal(out.drafts[0].files[0].name, 'ac-bill.jpg');
  assert.match(out.drafts[0].raw_input ?? '', /blue file/);
  assert.equal(m.recent().length, 0);
  assert.match(llm.seen[0][0].content ?? '', /You are Nila/);
  assert.match(llm.seen[0][0].content ?? '', /2026-11-11/);
  assert.match(llm.seen[0].at(-1)?.content ?? '', /ac-bill\.jpg/);
});

test('recall returns cards and tells the model when nothing matches', async () => {
  const m = newMemory();
  m.add({ ...base, title: 'Voltas AC warranty', kind: 'warranty', location: 'blue file', expiry_date: '2027-03-14' });

  const hit = scripted([call('recall', { query: 'AC warranty' }), say('It expires on 14 March 2027. The card is in the blue file.')]);
  const found = await runTurn({ message: 'when does AC warranty end', history: [], attachments: [] }, { llm: hit, memory: m, reminders: newReminders(), name: 'A', now: AT_TODAY });
  assert.equal(found.cards.length, 1);
  assert.equal(found.cards[0].days_left, 123);
  assert.match(hit.seen[1].at(-1)?.content ?? '', /"days_left":123/);

  const miss = scripted([call('recall', { query: 'passport' }), say('I do not have that.')]);
  const none = await runTurn({ message: 'passport expiry?', history: [], attachments: [] }, { llm: miss, memory: m, reminders: newReminders(), name: 'A', now: AT_TODAY });
  assert.equal(none.cards.length, 0);
  assert.match(miss.seen[1].at(-1)?.content ?? '', /Do not guess/);
});

test('bad tool calls are reported back to the model, and loops stop at the step limit', async () => {
  const m = newMemory();
  const llm = scripted([call('recall', '{not json'), call('lookup', {}), say('Sorry, try again.')]);
  const out = await runTurn({ message: 'hi', history: [], attachments: [] }, { llm, memory: m, reminders: newReminders(), name: 'A' });
  assert.equal(out.reply, 'Sorry, try again.');
  assert.match(llm.seen[1].at(-1)?.content ?? '', /not valid JSON/);
  assert.match(llm.seen[2].at(-1)?.content ?? '', /Unknown tool/);

  const looping = scripted(Array.from({ length: 10 }, () => call('recall', { query: 'x' })));
  const stuck = await runTurn({ message: 'hi', history: [], attachments: [] }, { llm: looping, memory: m, reminders: newReminders(), name: 'A' });
  assert.equal(looping.seen.length, 4);
  assert.match(stuck.reply, /could not work that out/);
});

test('text read from a document is searchable and reaches the model', async () => {
  const m = newMemory();
  const file = m.addFile({ name: 'policy.pdf', stored_name: 'p.pdf', mime: 'application/pdf', size: 9, text: 'Star Health Family Optima. Policy period 01/04/2026 to 31/03/2027. Sum insured 5,00,000.' });
  assert.equal(file.has_text, true);

  const llm = scripted([say('What should I call this?')]);
  await runTurn({ message: 'save this', history: [], attachments: [file.id] }, { llm, memory: m, reminders: newReminders(), name: 'A', now: AT_TODAY });
  assert.match(llm.seen[0].at(-1)?.content ?? '', /Family Optima/);

  const e = m.add({ ...base, title: 'Health insurance', kind: 'insurance' }, { fileIds: [file.id] });
  assert.equal(e.files[0].has_text, true);
  assert.equal(m.search('optima')[0]?.title, 'Health insurance'); // word only in the document
  assert.equal(m.search('health insurance').length, 1); // found both ways, listed once
});

test('reminders fire once per threshold, attention lists soon and just expired', () => {
  let today = '2026-11-11';
  const m = newMemory(() => today);
  m.add({ ...base, title: 'Bike insurance', kind: 'insurance', expiry_date: '2026-12-01' }); // 20 days
  m.add({ ...base, title: 'Mixer warranty', kind: 'warranty', expiry_date: '2026-11-05' }); // expired 6 days ago
  m.add({ ...base, title: 'Passport', kind: 'document', expiry_date: '2031-05-20' });

  assert.deepEqual(m.attention().map((e) => e.title), ['Mixer warranty', 'Bike insurance']);
  assert.deepEqual(m.dueReminders().map((e) => e.title), ['Bike insurance']); // crossed 30
  assert.deepEqual(m.dueReminders(), []); // not again
  today = '2026-11-20';
  assert.deepEqual(m.dueReminders(), []); // 11 days: no new threshold
  today = '2026-11-25';
  assert.equal(m.dueReminders()[0]?.days_left, 6); // crossed 7
  today = '2026-12-01';
  assert.equal(m.dueReminders()[0]?.days_left, 0); // skipped 1, caught at 0
  assert.deepEqual(m.dueReminders(), []);
});

test('mood follows what happened, not what the model said', async () => {
  const m = newMemory();
  m.add({ ...base, title: 'Passport', kind: 'document', expiry_date: '2031-05-20' });
  m.add({ ...base, title: 'Bike insurance', kind: 'insurance', expiry_date: '2026-11-20' });
  const turn = (replies: LlmMessage[]) => runTurn({ message: 'x', history: [], attachments: [] }, { llm: scripted(replies), memory: m, reminders: newReminders(), name: 'A', now: AT_TODAY });

  assert.equal((await turn([say('Hello!')])).mood, 'neutral');
  assert.equal((await turn([call('recall', { query: 'passport' }), say('ok')])).mood, 'happy');
  assert.equal((await turn([call('recall', { query: 'bike' }), say('ok')])).mood, 'alert');
  assert.equal((await turn([call('recall', { query: 'fridge' }), say('ok')])).mood, 'sorry');
  assert.equal((await turn([call('remember', { title: 'Fridge', kind: 'warranty' }), say('ok')])).mood, 'curious');
});

test('clock helpers: times, month ends, places', () => {
  assert.equal(parseClock('17:30'), 17 * 60 + 30);
  assert.equal(parseClock('5:30 pm'), 17 * 60 + 30);
  assert.equal(parseClock('12am'), 0);
  assert.equal(parseClock('12 pm'), 12 * 60);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('soon'), null);

  assert.equal(addToDate('2026-01-03', { years: 2 }), '2028-01-03');
  assert.equal(addToDate('2026-01-31', { months: 1 }), '2026-02-28');
  assert.equal(addToDate('2024-02-29', { years: 1 }), '2025-02-28');
  assert.equal(addToDate('2026-12-25', { days: 10 }), '2027-01-04');

  assert.equal(findZone('new york'), 'America/New_York');
  assert.equal(findZone('India'), 'Asia/Kolkata');
  assert.equal(findZone('Europe/London'), 'Europe/London');
  assert.equal(findZone('Atlantis'), null);

  const spoken = (h: number, m: number) => spokenTime(new Date(2026, 10, 12, h, m), 'Asia/Kolkata');
  assert.equal(spoken(6, 10), '6:10 in the morning');
  assert.equal(spoken(13, 30), '1:30 in the afternoon');
  assert.equal(spoken(18, 45), '6:45 in the evening');
  assert.equal(spoken(23, 5), '11:05 at night');
  assert.equal(spoken(12, 0), 'midday');
  assert.equal(spoken(0, 0), 'midnight');

  assert.equal(describeWhen(new Date(2026, 10, 12, 17, 30), NOW), 'today at 5:30 PM');
  assert.equal(describeWhen(new Date(2026, 10, 13, 9, 0), NOW), 'tomorrow at 9:00 AM');
});

test('the model is told the real time, and only gets the tools the message calls for', async () => {
  const m = newMemory();
  const tools = async (message: string) => {
    let offered: string[] = [];
    const llm: LlmFn = async (_messages, specs) => {
      offered = specs.map((t) => t.function.name);
      return say('ok');
    };
    await runTurn({ message, history: [], attachments: [] }, { llm, memory: m, reminders: newReminders(), name: 'A', now: () => NOW });
    return offered;
  };

  const llm = scripted([say('It is 6:10 AM.')]);
  await runTurn({ message: 'what time is it', history: [], attachments: [] }, { llm, memory: m, reminders: newReminders(), name: 'A', now: () => NOW });
  assert.match(llm.seen[0][0].content ?? '', /6:10 in the morning, on Thursday 12 November 2026/);

  assert.deepEqual(await tools('hello there'), ['remember', 'recall', 'list_expiring']);
  assert.ok((await tools('what time is it in Tokyo')).includes('time_in'));
  assert.ok(!(await tools('what time is it in Tokyo')).includes('set_reminder'));
  assert.ok((await tools('remind me to call the plumber')).includes('set_reminder'));
});

test('reminders: times resolved in code, guardrails hold', async () => {
  const m = newMemory();
  const r = newReminders();
  const turn = (replies: LlmMessage[]) => runTurn({ message: 'remind me', history: [], attachments: [] }, { llm: scripted(replies), memory: m, reminders: r, name: 'A', now: () => NOW });

  const relative = await turn([call('set_reminder', { text: 'Call plumber', in_minutes: 20 }), say('ok')]);
  assert.equal(new Date(relative.reminders[0].due_at).getTime(), NOW.getTime() + 20 * 60_000);
  assert.equal(relative.mood, 'happy');

  const absolute = await turn([call('set_reminder', { text: 'Renew insurance', date: '2026-11-13', time: '17:30' }), say('ok')]);
  assert.equal(new Date(absolute.reminders[0].due_at).getTime(), new Date(2026, 10, 13, 17, 30).getTime());

  // In the past, no time at all, nonsense time, too far ahead: nothing is created.
  const refused = scripted([
    call('set_reminder', { text: 'x', date: '2026-11-12', time: '05:00' }),
    call('set_reminder', { text: 'x' }),
    call('set_reminder', { text: 'x', date: '2026-11-13', time: 'evening' }),
    say('When?'),
  ]);
  const out = await runTurn({ message: 'remind me', history: [], attachments: [] }, { llm: refused, memory: m, reminders: r, name: 'A', now: () => NOW });
  assert.equal(out.reminders.length, 0);
  assert.match(refused.seen[1].at(-1)?.content ?? '', /already passed/);
  assert.match(refused.seen[2].at(-1)?.content ?? '', /Ask the user when/);
  assert.match(refused.seen[3].at(-1)?.content ?? '', /not valid/);
  assert.equal(r.upcoming().length, 2);

  // At most three per message.
  const flood = await turn([...Array.from({ length: 3 }, (_, i) => call('set_reminder', { text: `r${i}`, in_minutes: 5 + i })), say('ok')]);
  assert.equal(flood.reminders.length, 3);
  const four = scripted([
    { role: 'assistant', content: null, tool_calls: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, type: 'function' as const, function: { name: 'set_reminder', arguments: JSON.stringify({ text: `f${i}`, in_minutes: 60 + i }) } })) },
    say('ok'),
  ]);
  const capped = await runTurn({ message: 'remind me', history: [], attachments: [] }, { llm: four, memory: m, reminders: r, name: 'A', now: () => NOW });
  assert.equal(capped.reminders.length, 3);
});

test('reminders fire once, can be cancelled, and reach the screen once', () => {
  let now = NOW;
  const r = newReminders(() => now);
  const soon = r.add('Call plumber', new Date(NOW.getTime() + 10 * 60_000));
  const later = r.add('Pay rent', new Date(NOW.getTime() + 60 * 60_000));
  const dropped = r.add('Skip me', new Date(NOW.getTime() + 5 * 60_000));

  assert.equal(r.cancel(dropped.id), true);
  assert.deepEqual(r.takeDue(), []);
  now = new Date(NOW.getTime() + 11 * 60_000);
  assert.deepEqual(r.takeDue().map((x) => x.text), ['Call plumber']);
  assert.deepEqual(r.takeDue(), []);
  assert.equal(r.cancel(soon.id), false); // already went off
  assert.deepEqual(r.takeUnseen().map((x) => x.text), ['Call plumber']);
  assert.deepEqual(r.takeUnseen(), []);
  assert.deepEqual(r.upcoming().map((x) => x.id), [later.id]);
});

test('programs are found the way each operating system installs them', () => {
  const has = (...files: string[]) => (f: string) => files.includes(f);

  // Windows: extension added, PATH split on semicolons, default Tesseract folder known.
  assert.equal(
    findProgram('whisper-cli', { platform: 'win32', pathVar: 'C:\\Windows;C:\\tools', pathExt: '.EXE;.CMD', exists: has('C:\\tools\\whisper-cli.EXE') }),
    'C:\\tools\\whisper-cli.EXE',
  );
  assert.equal(
    findProgram('tesseract', { platform: 'win32', pathVar: 'C:\\Windows', pathExt: '.EXE', exists: has('C:\\Program Files\\Tesseract-OCR\\tesseract.EXE') }),
    'C:\\Program Files\\Tesseract-OCR\\tesseract.EXE',
  );
  // macOS: Homebrew folder is checked even when PATH lacks it.
  assert.equal(findProgram('whisper-cli', { platform: 'darwin', pathVar: '/usr/bin', exists: has('/opt/homebrew/bin/whisper-cli') }), '/opt/homebrew/bin/whisper-cli');
  // The project's own bin folder wins over the system copy.
  assert.equal(findProgram('tesseract', { platform: 'linux', pathVar: '/usr/bin', extraDirs: ['/app/bin'], exists: has('/app/bin/tesseract', '/usr/bin/tesseract') }), '/app/bin/tesseract');
  assert.equal(findProgram('nope', { platform: 'linux', pathVar: '/usr/bin', exists: () => false }), null);
});

test('hand-off to the system reminders app: linked when it works, still saved when it fails', async () => {
  const m = newMemory();
  const r = newReminders();
  const handed: string[] = [];
  const turn = (handOff: (text: string, due: Date) => Promise<string | null>) =>
    runTurn({ message: 'remind me', history: [], attachments: [] }, { llm: scripted([call('set_reminder', { text: 'Call plumber', in_minutes: 20 }), say('ok')]), memory: m, reminders: r, name: 'A', now: () => NOW, handOff });

  const ok = await turn(async (text) => (handed.push(text), 'x-apple-reminder://ABC'));
  assert.deepEqual(handed, ['Call plumber']);
  assert.equal(ok.reminders[0].in_system, true);
  assert.equal(r.systemIdOf(ok.reminders[0].id), 'x-apple-reminder://ABC');

  const refused = await turn(async () => null);
  assert.equal(refused.reminders[0].in_system, false);
  const crashed = await turn(async () => { throw new Error('osascript failed'); });
  assert.equal(crashed.reminders[0].in_system, false);
  assert.equal(r.upcoming().length, 3); // none lost
});

test('settings: first run is detected, values are checked, the key stays on the server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-settings-'));
  const store = new SettingsStore(dir);

  assert.equal(store.public().setupDone, false); // nothing saved yet
  assert.equal(store.public().name, 'Linsia'); // the name it has before anyone chooses one

  assert.equal(store.write({ name: 'Draft' }).setupDone, false); // naming it does not end setup

  const saved = store.write({ name: '  Nila  ', setupDone: true, llm: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5:3b' } });
  assert.equal(saved.name, 'Nila');
  assert.equal(saved.setupDone, true);
  assert.equal(saved.llm.baseUrl, 'http://localhost:11434/v1'); // /v1 added for Ollama
  assert.equal(saved.llm.local, true);

  const remote = store.write({ llm: { provider: 'openai', baseUrl: 'https://api.mistral.ai/v1/', model: 'mistral-large-latest', apiKey: 'sk-secret' } });
  assert.equal(remote.llm.baseUrl, 'https://api.mistral.ai/v1');
  assert.equal(remote.llm.local, false);
  assert.equal(remote.llm.hasKey, true);
  assert.ok(!JSON.stringify(remote).includes('sk-secret'));
  assert.equal(store.read().llm.apiKey, 'sk-secret');

  store.write({ llm: { model: 'mistral-small-latest', apiKey: '' } }); // empty field keeps the key
  assert.equal(store.read().llm.apiKey, 'sk-secret');
  assert.equal(store.read().name, 'Nila'); // untouched

  assert.throws(() => store.write({ llm: { baseUrl: 'not a url' } }), /valid URL/);
  assert.throws(() => store.write({ llm: { baseUrl: 'ftp://example.com' } }), /http/);
  assert.throws(() => store.write({ llm: { model: '   ' } }), /Choose a model/);

  // A settings file from before first-run setup existed counts as set up.
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-settings-'));
  fs.writeFileSync(path.join(legacy, 'settings.json'), '{"name":"Old"}');
  assert.equal(new SettingsStore(legacy).public().setupDone, true);
});

test('model picks fit the memory; odd model names are refused', () => {
  const pick = (gb: number) => recommendModels(gb * 1024 ** 3).find((m) => m.recommended)?.name;
  assert.equal(pick(8), 'qwen2.5:3b');
  assert.equal(pick(16), 'qwen2.5:7b');
  assert.equal(pick(64), 'qwen2.5:14b');
  assert.equal(recommendModels(8 * 1024 ** 3).length, 3);

  assert.ok(validModelName('qwen2.5:3b'));
  assert.ok(validModelName('hf.co/org/model:Q4_K_M'));
  assert.ok(!validModelName('x; rm -rf /'));
  assert.ok(!validModelName(''));
  assert.ok(!validModelName('--help'));
});
