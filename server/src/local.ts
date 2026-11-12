// Things that run on this computer next to the server: reading documents, hearing speech, notifications.
// Each one is optional and differs by operating system. When a tool is missing, the feature
// reports itself as unavailable and the rest of the assistant carries on.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';

function run(bin: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export interface FindOptions {
  platform?: NodeJS.Platform;
  pathVar?: string;
  pathExt?: string;
  /** Folders to look in before PATH. */
  extraDirs?: string[];
  exists?: (file: string) => boolean;
}

/** Folders where installers put these tools without adding them to PATH. */
const KNOWN_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin'],
  linux: ['/usr/local/bin', '/usr/bin'],
  win32: ['C:\\Program Files\\Tesseract-OCR', 'C:\\Program Files\\poppler\\Library\\bin'],
};

/** Full path of a program, or null. Like `which`, but also knows Windows extensions and common install folders. */
export function findProgram(name: string, opts: FindOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? fs.existsSync;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const exts = win ? ['', ...(opts.pathExt ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  const withExt = (base: string) => exts.map((e) => base + e).find((f) => exists(f)) ?? null;

  if (p.isAbsolute(name)) return withExt(name);
  const dirs = [...(opts.extraDirs ?? []), ...(opts.pathVar ?? process.env.PATH ?? '').split(win ? ';' : ':'), ...(KNOWN_DIRS[platform] ?? [])];
  for (const dir of dirs) {
    const hit = dir && withExt(p.join(dir, name));
    if (hit) return hit;
  }
  return null;
}

// ---------- hearing ----------

/** whisper.cpp: the path in .env, else the copy `npm run setup` put in bin/, else whatever is installed. */
function findWhisper(): string | null {
  const local = [path.join(config.root, 'bin', 'whisper', 'Release'), path.join(config.root, 'bin', 'whisper'), path.join(config.root, 'bin')];
  return findProgram(config.whisper.bin, { extraDirs: local });
}

export const voiceReady = () => fs.existsSync(config.whisper.model) && !!findWhisper();

/** Speech to text with whisper.cpp. `wav` must be 16 kHz mono 16-bit PCM. */
export async function transcribe(wav: Buffer): Promise<string> {
  const bin = findWhisper();
  if (!bin) throw new Error('whisper.cpp is not installed. Run "npm run setup".');
  const tmp = path.join(os.tmpdir(), `assistant-${randomUUID()}.wav`);
  fs.writeFileSync(tmp, wav);
  try {
    const out = await run(bin, ['-m', config.whisper.model, '-f', tmp, '-l', 'en', '-nt', '-np'], 60_000);
    return out
      .replace(/\[[A-Z_ ]+\]|\([a-z ]+\)/g, ' ') // [BLANK_AUDIO], (silence) and similar markers
      .replace(/\s+/g, ' ')
      .trim();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- reading documents ----------

/** How many pages of a PDF get read. */
const MAX_PAGES = 8;

const nativeReader = () => (process.platform === 'darwin' && fs.existsSync(config.ocrBin) ? config.ocrBin : null);

/** 'native' is the macOS reader built by setup; 'tesseract' works everywhere; null means not set up. */
export function ocrEngine(): 'native' | 'tesseract' | null {
  return nativeReader() ? 'native' : findProgram('tesseract') ? 'tesseract' : null;
}
export const ocrReady = () => ocrEngine() !== null;

async function readWithTesseract(file: string, mime: string): Promise<string> {
  const tesseract = findProgram('tesseract')!;
  if (mime !== 'application/pdf') return run(tesseract, [file, 'stdout'], 60_000);

  // PDFs that carry real text need no OCR at all.
  const pdftotext = findProgram('pdftotext');
  if (pdftotext) {
    const text = await run(pdftotext, ['-l', String(MAX_PAGES), '-layout', file, '-'], 30_000);
    if (text.trim().length > 20) return text;
  }
  // Scanned PDF: turn pages into pictures and read those.
  const pdftoppm = findProgram('pdftoppm');
  if (!pdftoppm) return '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-pdf-'));
  try {
    await run(pdftoppm, ['-r', '150', '-l', String(MAX_PAGES), '-png', file, path.join(dir, 'page')], 60_000);
    const pages: string[] = [];
    for (const png of fs.readdirSync(dir).sort()) pages.push(await run(tesseract, [path.join(dir, png), 'stdout'], 60_000));
    return pages.join('\n\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Text from an image or PDF, or null when reading is not set up or finds nothing. Never throws. */
export async function readDocument(file: string, mime: string): Promise<string | null> {
  const engine = ocrEngine();
  if (!engine) return null;
  try {
    const raw = engine === 'native' ? await run(config.ocrBin, [file], 90_000) : await readWithTesseract(file, mime);
    const text = raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text ? text.slice(0, 20_000) : null;
  } catch (err) {
    console.error(`Could not read ${path.basename(file)}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return null;
  }
}

// ---------- notifications ----------

// Title and body reach PowerShell through environment variables, never through the command text.
const WINDOWS_TOAST = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName('text')
$text.Item(0).AppendChild($xml.CreateTextNode($env:ASSISTANT_TITLE)) | Out-Null
$text.Item(1).AppendChild($xml.CreateTextNode($env:ASSISTANT_BODY)) | Out-Null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

/** A system notification, in whatever way this operating system does them. Never throws. */
export function notify(title: string, body: string): void {
  const done = () => {};
  try {
    if (process.platform === 'darwin') {
      const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      execFile('osascript', ['-e', `display notification ${quote(body)} with title ${quote(title)}`], done);
    } else if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_TOAST], { env: { ...process.env, ASSISTANT_TITLE: title, ASSISTANT_BODY: body }, windowsHide: true }, done);
    } else {
      const bin = findProgram('notify-send');
      if (bin) execFile(bin, [title, body], done);
    }
  } catch {
    // Notifications are a nicety. The reminder still shows on screen.
  }
}

// ---------- the system's own reminders app (macOS) ----------

// Values are passed as arguments, never pasted into the script text.
// The day is set to 1 first: changing the month of the 31st to a 30-day month would otherwise roll over.
const APPLE_ADD = `
on run argv
  set d to current date
  set day of d to 1
  set year of d to (item 3 of argv as integer)
  set month of d to (item 4 of argv as integer)
  set day of d to (item 5 of argv as integer)
  set time of d to (item 6 of argv as integer)
  tell application "Reminders"
    if not (exists list (item 1 of argv)) then make new list with properties {name:(item 1 of argv)}
    set r to make new reminder at end of list (item 1 of argv) with properties {name:(item 2 of argv), remind me date:d}
    return id of r
  end tell
end run`;

const APPLE_REMOVE = `
on run argv
  tell application "Reminders" to delete (first reminder whose id is (item 1 of argv))
end run`;

let appleState: 'untried' | 'working' | 'blocked' = 'untried';

/** Whether reminders are being handed to Apple's Reminders app: not applicable, untried, working or blocked. */
export function systemRemindersState(): 'off' | 'untried' | 'working' | 'blocked' {
  return process.platform === 'darwin' && config.systemReminders ? appleState : 'off';
}

/**
 * Add a reminder to Apple's Reminders app, in a list named after the assistant.
 * Resolves to the reminder's id there, or null when this is not a Mac, it is switched off, or macOS refused.
 * The first call makes macOS ask the user for permission; the wait is why the timeout is long.
 */
export async function addSystemReminder(list: string, text: string, due: Date): Promise<string | null> {
  if (systemRemindersState() === 'off') return null;
  try {
    const secs = due.getHours() * 3600 + due.getMinutes() * 60;
    const args = [list, text, due.getFullYear(), due.getMonth() + 1, due.getDate(), secs].map(String);
    const id = (await run('osascript', ['-e', APPLE_ADD, ...args], 90_000)).trim();
    appleState = id ? 'working' : 'blocked';
    return id || null;
  } catch (err) {
    if (appleState !== 'blocked') {
      console.error(`Could not add to the Reminders app: ${(err instanceof Error ? err.message : String(err)).split('\n').pop()?.slice(0, 200)}`);
      console.error('Reminders will still go off while the assistant is running. To allow the hand-off: System Settings, Privacy & Security, Automation, then enable Reminders for your terminal.');
    }
    appleState = 'blocked';
    return null;
  }
}

/** Remove a reminder this assistant created. Only ids it was given back by addSystemReminder ever reach here. */
export async function removeSystemReminder(id: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  await run('osascript', ['-e', APPLE_REMOVE, id], 30_000).catch(() => {});
}
