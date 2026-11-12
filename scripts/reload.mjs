#!/usr/bin/env node
// Puts your latest code into the copy you actually use.
//
//   npm run reload
//
// Rebuilds the screen and restarts the background server. Your records, settings and
// reminders are untouched: they live in the data folder, not in the code.
//
// "npm run dev" needs none of this; it picks up changes as you save them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'server', 'src', 'index.ts');
const say = (line = '') => console.log(line);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// Where each system keeps the "start at login" registration, if autostart was turned on.
const LABEL = 'local.assistant';
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'assistant.service');
const startupVbs = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'assistant.vbs');

const port = (() => {
  try {
    return /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))?.[1] ?? '8787';
  } catch {
    return '8787';
  }
})();

/** Is a server of ours answering right now? */
async function running() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stop the background server.
 * Only the process listening on our port is stopped, and only after that port has
 * answered our own health check, so nothing else on the machine is ever touched.
 */
function stopServer(ours) {
  let stopped = false;
  if (!ours) return false;
  if (process.platform === 'win32') {
    const byPort = `(Get-NetTCPConnection -LocalPort $env:PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force; 'stopped' }`;
    return (sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', byPort], { env: { ...process.env, PORT: port } }).stdout ?? '').includes('stopped');
  }
  {
    const pids = (sh('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).stdout ?? '').split('\n').filter(Boolean);
    for (const pid of pids) if (sh('kill', [pid]).status === 0) stopped = true;
  }
  return stopped;
}

const built = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) {
  say('\nThe build failed, so nothing was restarted. The old version is still running.');
  process.exit(1);
}

const wasRunning = await running();
const stopped = stopServer(wasRunning);
// Give the port a moment to come free, so the next start is not refused.
if (stopped) await new Promise((r) => setTimeout(r, 700));

if (process.platform === 'darwin' && fs.existsSync(plist)) {
  // launchd would bring it back on its own, but only after its retry delay. This is immediate.
  sh('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`]);
  say('\nRebuilt, and the background copy restarted with the new code.');
} else if (process.platform === 'linux' && fs.existsSync(unit)) {
  sh('systemctl', ['--user', 'restart', 'assistant.service']);
  say('\nRebuilt, and the background copy restarted with the new code.');
} else if (process.platform === 'win32' && fs.existsSync(startupVbs)) {
  sh('wscript.exe', [startupVbs]);
  say('\nRebuilt, and the background copy restarted with the new code.');
} else if (stopped || wasRunning) {
  say('\nRebuilt, and the running copy stopped. Opening the assistant starts it again with the new code.');
} else {
  say('\nRebuilt. Nothing was running; the new code is used next time you open it.');
}
say('Your records, settings and reminders were not touched.');
