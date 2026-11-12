import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { runTurn } from './agent.ts';
import { config } from './config.ts';
import { openDb } from './db.ts';
import { makeChat } from './llm.ts';
import { modelStatus, pullModel, startOllama, testModel, validModelName } from './models.ts';
import { addSystemReminder, notify, ocrEngine, ocrReady, readDocument, removeSystemReminder, systemRemindersState, transcribe, voiceReady } from './local.ts';
import { Memory, normalizeFields } from './memory.ts';
import { Reminders } from './reminders.ts';
import { SettingsStore, isLocalUrl } from './settings.ts';
import { skills } from './skills/registry.ts';
import type { Abilities, ChatMessage, Health } from './types.ts';

const filesDir = path.join(config.dataDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

console.log(`Starting on Node ${process.version}. Opening database in ${config.dataDir} ...`);
const db = openDb(path.join(config.dataDir, 'assistant.sqlite'));
const memory = new Memory(db);
const reminders = new Reminders(db);
console.log('Database ready.');
const settings = new SettingsStore(config.dataDir);
const chat = makeChat(() => settings.read().llm);

const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: filesDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (ALLOWED.test(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs are accepted.'))),
});

const app = express();
app.use(express.json({ limit: '1mb' }));

const idsOf = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

app.get('/api/health', (_req, res) => {
  const health: Health = { ok: true, model: settings.read().llm.model, voice: voiceReady(), ocr: ocrReady() };
  res.json(health);
});

/** Everything it can do, generated from the skills themselves so the list cannot go stale. */
app.get('/api/abilities', (_req, res) => {
  const engine = ocrEngine();
  const abilities: Abilities = {
    skills: skills.map((s) => ({ name: s.name, title: s.title, summary: s.summary, examples: s.examples, tools: s.tools.map((t) => t.label) })),
    extras: [
      { name: 'Voice conversation', ready: voiceReady(), note: voiceReady() ? 'Press Talk and just speak.' : 'Not set up. Run "npm run setup".' },
      {
        name: 'Reading documents',
        ready: !!engine,
        note: engine ? `Reads text from images and PDFs you attach (${engine === 'native' ? "Apple's text recognition" : 'Tesseract'}).` : 'Not set up. Run "npm run setup". Until then, say what a document is when you attach it.',
      },
...(systemRemindersState() === 'off'
        ? []
        : [
            {
              name: 'Apple Reminders',
              ready: systemRemindersState() !== 'blocked',
              note:
                systemRemindersState() === 'blocked'
                  ? 'macOS refused access. Allow it in System Settings, Privacy & Security, Automation. Until then reminders only go off while I am running.'
                  : `Timed reminders are also added to the Reminders app, in a list called "${settings.read().name}", so they go off when I am closed and on your iPhone.`,
            },
          ]),
      { name: 'Expiry watch', ready: true, note: 'Tells you what expires within 30 days when you open it, and notifies at 30, 7, 1 and 0 days.' },
    ],
    limits: [
      'Cannot save anything to memory without your confirmation.',
      'Cannot delete records or cancel reminders. Only you can, with the buttons.',
      'Cannot run commands, open other files, or use the internet.',
      'Does not work dates or times out in its head. The computer does that.',
      systemRemindersState() === 'working' ? 'In the Reminders app, only touches reminders it created itself.' : 'Reminders only go off while the assistant is running.',
    ],
  };
  res.json(abilities);
});

app.get('/api/settings', (_req, res) => {
  res.json(settings.public());
});

app.put('/api/settings', (req, res) => {
  try {
    res.json(settings.write(req.body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not save.' });
  }
});

/** Is the model server there, and does it have the chosen model. */
app.get('/api/model/status', async (_req, res) => {
  res.json(await modelStatus(settings.read().llm));
});

/** Ask the model one real question, to see that it answers and uses tools. */
app.post('/api/model/test', async (_req, res) => {
  res.json(await testModel(chat));
});

app.post('/api/model/start', (_req, res) => {
  if (settings.read().llm.provider !== 'ollama') return res.status(400).json({ error: 'Only Ollama can be started from here.' });
  res.json({ started: startOllama() });
});

/** Download a model through Ollama. Progress comes back line by line. */
app.post('/api/model/pull', async (req, res) => {
  const llm = settings.read().llm;
  const model = req.body?.model;
  if (llm.provider !== 'ollama' || !isLocalUrl(llm.baseUrl)) return res.status(400).json({ error: 'Downloads only work with Ollama on this computer.' });
  if (!validModelName(model)) return res.status(400).json({ error: 'That is not a valid model name.' });

  const abort = new AbortController();
  res.on('close', () => abort.abort());
  res.setHeader('Content-Type', 'application/x-ndjson');
  try {
    await pullModel(llm, model, (line) => res.write(line + '\n'), abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) res.write(JSON.stringify({ error: err instanceof Error ? err.message : 'Download failed.' }) + '\n');
  }
  res.end();
});

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const attachments = idsOf(req.body?.attachments);
  if (!message && !attachments.length) return res.status(400).json({ error: 'Empty message.' });

  const history: ChatMessage[] = (Array.isArray(req.body?.history) ? req.body.history : []).filter(
    (m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string',
  );

  const started = Date.now();
  const result = await runTurn(
    { message: message || 'I attached a file.', history, attachments },
    { llm: chat, memory, reminders, name: settings.read().name, handOff: (text, due) => addSystemReminder(settings.read().name, text, due) },
  );
  console.log(`Answered in ${((Date.now() - started) / 1000).toFixed(1)}s: "${message.slice(0, 60)}"`);
  res.json(result);
});

app.post('/api/files', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'No file received.' });
  // Browsers send the name as latin1 bytes; restore UTF-8.
  const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
  const text = await readDocument(f.path, f.mimetype);
  res.json(memory.addFile({ name, stored_name: f.filename, mime: f.mimetype, size: f.size, text }));
});

app.get('/files/:id', (req, res) => {
  const file = memory.getFile(Number(req.params.id));
  if (!file) return res.status(404).send('Not found');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.sendFile(file.stored_name, { root: filesDir });
});

app.post('/api/transcribe', express.raw({ type: 'audio/wav', limit: '30mb' }), async (req, res) => {
  if (!voiceReady()) return res.status(501).json({ error: 'Voice input is not set up yet. Run "npm run setup" once in the assistant folder.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'No audio received.' });
  const started = Date.now();
  const seconds = ((req.body.length - 44) / 32_000).toFixed(1); // 16 kHz, 16-bit mono
  const text = await transcribe(req.body);
  console.log(`Heard ${seconds}s of audio in ${((Date.now() - started) / 1000).toFixed(1)}s: ${text ? `"${text}"` : '(no words)'}`);
  res.json({ text });
});

/** Records expiring soon or just expired, for the greeting. */
app.get('/api/attention', (_req, res) => {
  res.json(memory.attention());
});

app.get('/api/reminders', (_req, res) => {
  res.json(reminders.upcoming());
});

/** Reminders that have gone off and not yet been shown on screen. */
app.get('/api/reminders/fired', (_req, res) => {
  res.json(reminders.takeUnseen());
});

app.delete('/api/reminders/:id', (req, res) => {
  const id = Number(req.params.id);
  const systemId = reminders.systemIdOf(id);
  if (!reminders.cancel(id)) return res.status(404).json({ error: 'Not found, or it already went off.' });
  if (systemId) void removeSystemReminder(systemId);
  res.json({ ok: true });
});

app.get('/api/entries', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  res.json(q ? memory.search(q, 50) : memory.recent(200));
});

app.post('/api/entries', (req, res) => {
  const { fields, problems } = normalizeFields(req.body);
  if (!fields) return res.status(400).json({ error: problems.join('; ') });
  const raw_input = typeof req.body?.raw_input === 'string' ? req.body.raw_input : null;
  res.status(201).json(memory.add(fields, { raw_input, fileIds: idsOf(req.body?.fileIds) }));
});

app.put('/api/entries/:id', (req, res) => {
  const { fields, problems } = normalizeFields(req.body);
  if (!fields) return res.status(400).json({ error: problems.join('; ') });
  const updated = memory.update(Number(req.params.id), fields);
  if (!updated) return res.status(404).json({ error: 'Not found.' });
  res.json(updated);
});

app.delete('/api/entries/:id', (req, res) => {
  if (!memory.remove(Number(req.params.id))) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

// The built screen, when there is one ("npm start" and "npm run autostart" build it).
// "npm run dev" serves the screen from Vite instead and never reaches this.
const dist = path.join(config.root, 'web', 'dist');
const hasScreen = !config.dev && fs.existsSync(path.join(dist, 'index.html'));
if (hasScreen) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/|files\/).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.message);
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message.slice(0, 400) });
});

/** One notification per record per threshold (30, 7, 1, 0 days before expiry). */
function sendReminders() {
  try {
    const name = settings.read().name;
    for (const e of memory.dueReminders()) {
      const when = e.days_left === 0 ? 'expires today' : e.days_left === 1 ? 'expires tomorrow' : `expires in ${e.days_left} days`;
      notify(name, `${e.title} ${when}.`);
    }
  } catch (err) {
    console.error(`Reminder check failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Fire timed reminders as macOS notifications. The open page picks them up too. */
function fireReminders() {
  try {
    // Ones that live in the system's reminders app are announced by it. A second popup would be noise.
    for (const r of reminders.takeDue()) if (!r.in_system) notify(`${settings.read().name}: reminder`, r.text);
  } catch (err) {
    console.error(`Reminder check failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Bound to this machine only: the records here are private.
app.listen(config.port, '127.0.0.1', () => {
  console.log(hasScreen ? `Assistant ready. Open http://127.0.0.1:${config.port}` : `Assistant server on http://127.0.0.1:${config.port}${config.dev ? ' (development)' : ''}`);
  console.log(`Model: ${settings.read().llm.model} at ${settings.read().llm.baseUrl}`);
  console.log(`Data:  ${config.dataDir}`);
  console.log(`Voice input: ${voiceReady() ? 'ready' : 'not set up (npm run setup)'}`);
  console.log(`Document reading: ${ocrReady() ? `ready (${ocrEngine()})` : 'not set up (npm run setup)'}`);
  setTimeout(sendReminders, 5_000);
  setInterval(sendReminders, 6 * 60 * 60 * 1000);
  fireReminders();
  setInterval(fireReminders, 15_000);
});
