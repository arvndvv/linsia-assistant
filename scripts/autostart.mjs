#!/usr/bin/env node
// Makes the assistant start by itself when you log in, and stay running in the background.
//
//   npm run autostart          turn on (builds the screen, registers with the system, starts it now)
//   npm run autostart off      turn off and stop it
//   npm run autostart status   show whether it is on
//
// macOS uses a LaunchAgent, Windows a hidden script in the Startup folder, Linux a systemd user service.
// Nothing here needs administrator rights, and "off" removes everything it added.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'on';
const dryRun = process.argv.includes('--dry-run');
const node = process.execPath;
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(root, 'server', 'src', 'index.ts');
const port = (() => {
  try {
    return /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))?.[1] ?? '8787';
  } catch {
    return '8787';
  }
})();
const url = `http://127.0.0.1:${port}`;
const say = (line = '') => console.log(line);
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

function write(file, content) {
  if (dryRun) return say(`--- would write ${file} ---\n${content}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const remove = (file) => !dryRun && fs.rmSync(file, { force: true });

// ---------- macOS ----------
const LABEL = 'local.assistant';
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const macLog = path.join(os.homedir(), 'Library', 'Logs', 'assistant.log');
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const mac = {
  on() {
    // KeepAlive restarts it if it stops. ThrottleInterval spaces the retries, which also covers
    // the case where the project sits on an external drive that is not plugged in yet at login.
    write(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(tsx)}</string>
    <string>${xml(entry)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(macLog)}</string>
  <key>StandardErrorPath</key><string>${xml(macLog)}</string>
</dict>
</plist>
`,
    );
    if (dryRun) return;
    const domain = `gui/${process.getuid()}`;
    sh('launchctl', ['bootout', domain, plist]); // in case an older copy is loaded
    const res = sh('launchctl', ['bootstrap', domain, plist]);
    if (res.status !== 0) sh('launchctl', ['load', '-w', plist]);
    say(`  Log file: ${macLog}`);
  },
  off() {
    if (!dryRun) sh('launchctl', ['bootout', `gui/${process.getuid()}`, plist]);
    remove(plist);
  },
  isOn: () => fs.existsSync(plist),
};

// ---------- Windows ----------
const startup = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'assistant.vbs');
const win = {
  on() {
    // A .vbs launcher starts it with no console window. Quotes are doubled, as VBScript requires.
    const q = (s) => `""${s}""`;
    const command = `cmd /c cd /d ${q(root)} && ${q(node)} ${q(tsx)} ${q(entry)}`;
    write(startup, `' Starts the assistant in the background at login. Remove with: npm run autostart off\r\nCreateObject("WScript.Shell").Run "${command}", 0, False\r\n`);
    if (!dryRun) sh('wscript.exe', [startup]);
  },
  off() {
    remove(startup);
    // Stop the running copy: the one node process whose command line names this project's server.
    if (!dryRun) {
      sh('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${entry.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
      ]);
    }
  },
  isOn: () => fs.existsSync(startup),
};

// ---------- Linux ----------
const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'assistant.service');
const linux = {
  on() {
    write(
      unit,
      `[Unit]
Description=Personal assistant

[Service]
WorkingDirectory=${root}
ExecStart="${node}" "${tsx}" "${entry}"
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
`,
    );
    if (dryRun) return;
    sh('systemctl', ['--user', 'daemon-reload']);
    const res = sh('systemctl', ['--user', 'enable', '--now', 'assistant.service']);
    if (res.status !== 0) say('  systemd did not accept it. The service file is written; enable it by hand: systemctl --user enable --now assistant');
  },
  off() {
    if (!dryRun) sh('systemctl', ['--user', 'disable', '--now', 'assistant.service']);
    remove(unit);
  },
  isOn: () => fs.existsSync(unit),
};

const system = { darwin: mac, win32: win, linux }[process.platform];
if (!system) {
  say(`Starting at login is not supported on ${process.platform}.`);
  process.exit(1);
}

if (action === 'status') {
  say(system.isOn() ? `On. The assistant starts at login. Open ${url}` : 'Off. Start it yourself with: npm start');
} else if (action === 'off') {
  system.off();
  say('Off. The assistant no longer starts at login, and the background copy is stopped.');
} else if (action === 'on') {
  if (!fs.existsSync(tsx)) {
    say('Run "npm install" first.');
    process.exit(1);
  }
  if (!dryRun) {
    say('Building the screen ...');
    const built = spawnSync(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
    if (built.status !== 0) {
      say('The build failed, so nothing was changed.');
      process.exit(1);
    }
  }
  system.on();
  say(`\nOn. The assistant now starts at login and is running in the background.`);
  say(`Open ${url}`);
  say('Tip: in Chrome, the menu has "Install page as app"; in Safari, File > Add to Dock. That gives it its own window and icon.');
  say('After changing the code, run "npm run autostart" again to rebuild and restart it.');
} else {
  say('Usage: npm run autostart [on|off|status]');
  process.exit(1);
}
