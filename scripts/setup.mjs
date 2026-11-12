#!/usr/bin/env node
// One command that gets this computer ready, whatever it runs: macOS, Windows or Linux.
//
//   npm run setup          everything
//   npm run setup:voice    only voice input
//   npm run setup:ocr      only document reading
//
// Nothing here is required for the assistant to start. Voice input and document reading are
// optional: when a step cannot be done automatically, it prints what to install and moves on.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] ?? process.platform;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
// A whisper.cpp release that ships ready-made Windows programs.
const WHISPER_WINDOWS_ZIP = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip';

const results = [];
const say = (line = '') => console.log(line);
const step = (title) => say(`\n== ${title} ==`);
const report = (name, ok, note = '') => results.push({ name, ok, note });

function which(name, extraDirs = []) {
  const exts = isWin ? ['', '.exe', '.cmd', '.bat'] : [''];
  const known = isMac ? ['/opt/homebrew/bin', '/usr/local/bin'] : isWin ? ['C:\\Program Files\\Tesseract-OCR', 'C:\\Program Files\\poppler\\Library\\bin'] : ['/usr/local/bin'];
  for (const dir of [...extraDirs, ...(process.env.PATH ?? '').split(path.delimiter), ...known]) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (dir && fs.existsSync(file)) return file;
    }
  }
  return null;
}

const runShown = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', cwd: root }).status === 0;

async function download(url, dest, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  let got = 0;
  let shown = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 10) * 10 : -1;
    if (pct !== shown && pct >= 0) {
      shown = pct;
      process.stdout.write(`\r  ${label}: ${pct}%`);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(part, dest);
  process.stdout.write(`\r  ${label}: done      \n`);
}

function readEnv() {
  const values = {};
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) values[m[1]] = m[2];
    }
  } catch {
    // No .env yet.
  }
  return values;
}

// ---------- basics ----------

async function basics() {
  step('Basics');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 19)) {
    say(`  Node ${process.versions.node} is too old. Install Node 20.19 or newer from https://nodejs.org and run this again.`);
    process.exit(1);
  }
  say(`  Node ${process.versions.node}: fine.`);

  const env = path.join(root, '.env');
  if (fs.existsSync(env)) say('  .env: already there, left alone.');
  else {
    fs.copyFileSync(path.join(root, '.env.example'), env);
    say('  .env: created from .env.example.');
  }

  const { LLM_BASE_URL = 'http://localhost:11434/v1', LLM_MODEL = 'qwen2.5:3b' } = readEnv();
  if (!/localhost:11434|127\.0\.0\.1:11434/.test(LLM_BASE_URL)) {
    say(`  Model server: ${LLM_BASE_URL} (not local Ollama, not checked).`);
    return report('Model', true, LLM_BASE_URL);
  }
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    const names = ((await res.json()).models ?? []).map((m) => m.name);
    if (names.some((n) => n === LLM_MODEL || n === `${LLM_MODEL}:latest`)) {
      say(`  Ollama: running, model ${LLM_MODEL} is downloaded.`);
      report('Model', true, LLM_MODEL);
    } else {
      say(`  Ollama: running, but model ${LLM_MODEL} is not downloaded. Run:  ollama pull ${LLM_MODEL}`);
      report('Model', false, `run: ollama pull ${LLM_MODEL}`);
    }
  } catch {
    say('  Ollama: not running. Install it from https://ollama.com/download, start it, then run:');
    say(`    ollama pull ${LLM_MODEL}`);
    report('Model', false, 'install and start Ollama');
  }
}

// ---------- voice input ----------

async function voice() {
  step('Voice input (optional)');
  const localDirs = [path.join(root, 'bin', 'whisper', 'Release'), path.join(root, 'bin', 'whisper'), path.join(root, 'bin')];
  let bin = which('whisper-cli', localDirs);

  if (bin) say(`  whisper.cpp: found at ${bin}`);
  else if (isMac) {
    if (which('brew')) {
      say('  Installing whisper.cpp with Homebrew ...');
      runShown('brew', ['install', 'whisper-cpp']);
    } else say('  Homebrew is not installed. Get it from https://brew.sh, then run this again.');
  } else if (isWin) {
    const dir = path.join(root, 'bin', 'whisper');
    const zip = path.join(root, 'bin', 'whisper.zip');
    fs.mkdirSync(dir, { recursive: true });
    try {
      await download(WHISPER_WINDOWS_ZIP, zip, 'whisper.cpp for Windows');
      runShown('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dir}'`]);
      fs.rmSync(zip, { force: true });
    } catch (err) {
      say(`  Could not download whisper.cpp: ${err.message}`);
    }
  } else {
    say('  whisper.cpp has no ready-made Linux download. Build it once:');
    say('    git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp && cmake -B build && cmake --build build -j');
    say('  then put WHISPER_BIN=/path/to/whisper.cpp/build/bin/whisper-cli in .env');
  }
  bin = which('whisper-cli', localDirs) ?? (readEnv().WHISPER_BIN && fs.existsSync(readEnv().WHISPER_BIN) ? readEnv().WHISPER_BIN : null);

  const model = path.join(root, 'models', 'ggml-base.en.bin');
  if (fs.existsSync(model)) say('  Speech model: already downloaded.');
  else {
    fs.mkdirSync(path.dirname(model), { recursive: true });
    try {
      await download(WHISPER_MODEL_URL, model, 'Speech model (about 150 MB)');
    } catch (err) {
      say(`  Could not download the speech model: ${err.message}`);
      say(`  Download it by hand from ${WHISPER_MODEL_URL} into the models folder.`);
    }
  }
  const ok = !!bin && fs.existsSync(model);
  report('Voice input', ok, ok ? '' : !bin ? 'whisper.cpp missing' : 'speech model missing');
}

// ---------- document reading ----------

function ocr() {
  step('Document reading (optional)');
  if (isMac && which('swiftc')) {
    say('  Building the macOS reader (uses Apple\'s own text recognition) ...');
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    const built = spawnSync('swiftc', ['-O', path.join('scripts', 'ocr.swift'), '-o', path.join('bin', 'ocr')], { cwd: root, encoding: 'utf8' });
    if (built.status === 0) {
      say('  Built bin/ocr.');
      return report('Document reading', true, 'macOS reader');
    }
    const first = (built.stderr || '').split('\n').find((l) => l.includes('error:')) ?? 'unknown error';
    say(`  The Swift compiler failed: ${first.trim().slice(0, 160)}`);
    if (/redefinition of module/.test(built.stderr || '')) {
      say('  This is a broken Command Line Tools install, not this project. To repair it:');
      say('    sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install');
    }
    say('  Falling back to Tesseract.');
  }

  const tesseract = which('tesseract');
  const pdftotext = which('pdftotext');
  if (tesseract) say(`  Tesseract: found at ${tesseract}`);
  if (pdftotext) say(`  Poppler (for PDFs): found at ${pdftotext}`);
  if (!tesseract || !pdftotext) {
    const missing = [!tesseract && 'Tesseract', !pdftotext && 'Poppler'].filter(Boolean).join(' and ');
    say(`  ${missing} not installed. To add:`);
    if (isMac) say('    brew install tesseract poppler');
    else if (isWin) {
      say('    winget install UB-Mannheim.TesseractOCR');
      say('    winget install oschwartz10612.Poppler');
      say('  (or download Tesseract from https://github.com/UB-Mannheim/tesseract/wiki). Open a new terminal afterwards.');
    } else say('    sudo apt install tesseract-ocr poppler-utils     (or your distribution\'s equivalent)');
  }
  report('Document reading', !!tesseract, tesseract ? (pdftotext ? 'Tesseract' : 'Tesseract, images only (no Poppler)') : 'Tesseract missing');
}

// ---------- Apple Reminders (macOS) ----------

function appleReminders() {
  if (!isMac) return;
  step('Apple Reminders (optional)');
  if ((readEnv().SYSTEM_REMINDERS ?? 'on').toLowerCase() === 'off') {
    say('  Switched off in .env. Reminders stay inside the assistant.');
    return;
  }
  say('  Timed reminders can also go into the Reminders app, so they go off when the assistant is closed');
  say('  and on your iPhone. macOS may now ask whether your terminal may control Reminders. Choose Allow.');
  const probe = spawnSync('osascript', ['-e', 'tell application "Reminders" to count lists'], { encoding: 'utf8', timeout: 90_000 });
  if (probe.status === 0) {
    say('  Allowed.');
    report('Apple Reminders', true);
  } else {
    say('  Not allowed. To change that later: System Settings, Privacy & Security, Automation, enable Reminders for your terminal.');
    say('  Or put SYSTEM_REMINDERS=off in .env to stop it asking.');
    report('Apple Reminders', false, 'permission not given');
  }
}

// ---------- run ----------

const what = process.argv[2] ?? 'all';
say(`Setting up on ${OS}.`);
if (what === 'all') await basics();
if (what === 'all' || what === 'voice') await voice();
if (what === 'all' || what === 'ocr') ocr();
if (what === 'all' || what === 'reminders') appleReminders();

step('Summary');
for (const r of results) say(`  ${r.ok ? 'ready    ' : 'not ready'}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
say('\nStart the assistant with:  npm run dev');
say('It runs without the optional parts. Run this again any time after installing something.');
