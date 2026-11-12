#!/usr/bin/env node
// Puts the assistant among your other applications, so you can summon it by name
// instead of typing a web address.
//
//   npm run launcher         create it (macOS app bundle, Windows Start menu entry, Linux desktop entry)
//   npm run launcher off     remove it
//
// Launching it starts the server if it is not already running, waits for it, and opens
// the assistant in a window of its own.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'on';
const say = (line = '') => console.log(line);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

/** The assistant's name, as chosen on the Settings page. */
function assistantName() {
  const fallback = 'Linsia';
  try {
    const dir = /^\s*DATA_DIR\s*=\s*(.+)\s*$/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))?.[1] ?? 'data';
    const saved = JSON.parse(fs.readFileSync(path.resolve(root, dir.trim(), 'settings.json'), 'utf8'));
    const name = typeof saved.name === 'string' ? saved.name.trim() : '';
    // Only plain names; the value becomes a file name.
    return /^[\p{L}\p{N} ._-]{1,40}$/u.test(name) ? name : fallback;
  } catch {
    return fallback;
  }
}

function port() {
  try {
    return /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))?.[1] ?? '8787';
  } catch {
    return '8787';
  }
}

const name = assistantName();
const url = `http://127.0.0.1:${port()}`;
const node = process.execPath;
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(root, 'server', 'src', 'index.ts');
// Marks the launchers this script made, so it can clean up ones under an older name.
const MARKER = '.made-by-assistant-launcher';

// ---------- macOS ----------

const appsDir = path.join(os.homedir(), 'Applications');

/** Every launcher this script has made, whatever name it was given. */
function madeBefore() {
  try {
    return fs
      .readdirSync(appsDir)
      .filter((f) => f.endsWith('.app') && fs.existsSync(path.join(appsDir, f, 'Contents', MARKER)))
      .map((f) => path.join(appsDir, f));
  } catch {
    return [];
  }
}

/** A .icns from scripts/icon.png, using tools macOS already has. Returns its path, or null. */
function buildIcns(contents) {
  const png = path.join(root, 'scripts', 'icon.png');
  if (!fs.existsSync(png)) return null;
  const work = path.join(os.tmpdir(), `assistant-icon-${Date.now()}.iconset`);
  try {
    fs.mkdirSync(work, { recursive: true });
    for (const size of [16, 32, 64, 128, 256, 512]) {
      for (const [scale, suffix] of [
        [1, `icon_${size}x${size}.png`],
        [2, `icon_${size}x${size}@2x.png`],
      ]) {
        const px = size * scale;
        if (px > 1024) continue;
        if (sh('sips', ['-z', String(px), String(px), png, '--out', path.join(work, suffix)]).status !== 0) throw new Error('sips failed');
      }
    }
    const icns = path.join(contents, 'Resources', 'icon.icns');
    fs.mkdirSync(path.dirname(icns), { recursive: true });
    if (sh('iconutil', ['-c', 'icns', work, '-o', icns]).status !== 0) throw new Error('iconutil failed');
    return icns;
  } catch {
    return null; // An icon is a nicety; carry on without one.
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const mac = {
  on() {
    for (const old of madeBefore()) fs.rmSync(old, { recursive: true, force: true });
    const app = path.join(appsDir, `${name}.app`);
    const contents = path.join(app, 'Contents');
    const exe = path.join(contents, 'MacOS', 'launch');
    fs.mkdirSync(path.dirname(exe), { recursive: true });

    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(
      exe,
      `#!/bin/bash
# Opens ${name}. Made by "npm run launcher"; remove with "npm run launcher off".
ROOT=${q(root)}
URL=${q(url)}

if [ ! -d "$ROOT" ]; then
  osascript -e 'display alert ${JSON.stringify(name)} message "Its folder is not reachable. If it lives on an external drive, plug the drive in."'
  exit 1
fi

# Start it if it is not already answering, and wait for it.
if ! curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
  ( cd "$ROOT" && nohup ${q(node)} ${q(tsx)} ${q(entry)} >/dev/null 2>&1 & )
  for _ in $(seq 1 40); do
    curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# A window of its own if Chrome is here, otherwise the usual browser.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  "$CHROME" --app="$URL" >/dev/null 2>&1 &
else
  open "$URL"
fi
`,
      { mode: 0o755 },
    );

    const icns = buildIcns(contents);
    fs.writeFileSync(
      path.join(contents, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>local.assistant.launcher</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  ${icns ? '<key>CFBundleIconFile</key><string>icon</string>' : ''}
</dict>
</plist>
`,
    );
    fs.writeFileSync(path.join(contents, MARKER), 'Remove this app with: npm run launcher off\n');
    sh('touch', [app]);
    sh('mdimport', [app]); // so Spotlight finds it straight away
    say(`  Made ${app}${icns ? '' : ' (without an icon: sips or iconutil was unavailable)'}`);
    say(`\n  Press Command and Space, type "${name}", press Return.`);
    say('  Drag it to the Dock to keep it there.');
    say(`  For a key of its own: open the Shortcuts app, New Shortcut, add the action "Open App" and choose ${name},`);
    say('  then in the shortcut details set a Keyboard Shortcut.');
  },
  off() {
    const made = madeBefore();
    for (const app of made) fs.rmSync(app, { recursive: true, force: true });
    say(made.length ? `  Removed ${made.map((a) => path.basename(a)).join(', ')}` : '  There was nothing to remove.');
  },
  list: madeBefore,
};

// ---------- Windows ----------

const startMenu = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const winHelper = path.join(root, 'bin', 'launch.vbs');

const win = {
  on() {
    win.off();
    const chrome = [
      path.join(process.env['PROGRAMFILES'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].find((p) => p && fs.existsSync(p));

    // A small script: start the server if needed, wait, then open the window. No console flashes past.
    fs.mkdirSync(path.dirname(winHelper), { recursive: true });
    const vb = (s) => s.replace(/"/g, '""');
    fs.writeFileSync(
      winHelper,
      `' Opens ${name}. Made by "npm run launcher"; remove with "npm run launcher off".\r
Set sh = CreateObject("WScript.Shell")\r
Set http = CreateObject("MSXML2.XMLHTTP")\r
\r
Function Answers()\r
  On Error Resume Next\r
  http.open "GET", "${vb(url)}/api/health", False\r
  http.send\r
  Answers = (Err.Number = 0 And http.status = 200)\r
  On Error GoTo 0\r
End Function\r
\r
If Not Answers() Then\r
  sh.CurrentDirectory = "${vb(root)}"\r
  sh.Run "cmd /c """"${vb(node)}"" ""${vb(tsx)}"" ""${vb(entry)}""""", 0, False\r
  For i = 1 To 40\r
    WScript.Sleep 500\r
    If Answers() Then Exit For\r
  Next\r
End If\r
\r
${chrome ? `sh.Run """${vb(chrome)}"" --app=${vb(url)}", 1, False` : `sh.Run "${vb(url)}", 1, False`}\r
`,
    );

    const icon = path.join(root, 'scripts', 'icon.ico');
    const ps = [
      '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK)',
      '$s.TargetPath = "wscript.exe"',
      '$s.Arguments = \'"\' + $env:HELPER + \'"\'',
      '$s.WorkingDirectory = $env:ROOT',
      '$s.Description = "Open " + $env:NAME',
      ...(fs.existsSync(icon) ? ['$s.IconLocation = $env:ICON'] : []),
      '$s.Save()',
    ].join('; ');
    const res = sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      env: { ...process.env, LNK: path.join(startMenu, `${name}.lnk`), HELPER: winHelper, ROOT: root, NAME: name, ICON: icon },
    });
    if (res.status !== 0) {
      say(`  Could not make the Start menu entry: ${(res.stderr || '').trim().slice(0, 200)}`);
      return;
    }
    say(`  Made ${path.join(startMenu, `${name}.lnk`)}`);
    say(`\n  Press the Windows key, type "${name}", press Enter.`);
    say('  Right-click it in the Start menu to pin it, or open its Properties to give it a Shortcut key.');
  },
  off() {
    const made = win.list();
    for (const f of made) fs.rmSync(f, { force: true });
    fs.rmSync(winHelper, { force: true });
    say(made.length ? `  Removed ${made.map((f) => path.basename(f)).join(', ')}` : '  There was nothing to remove.');
  },
  list() {
    try {
      return fs
        .readdirSync(startMenu)
        .filter((f) => f.endsWith('.lnk'))
        .map((f) => path.join(startMenu, f))
        .filter((f) => {
          const r = sh('powershell.exe', ['-NoProfile', '-Command', '(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK).Arguments'], {
            env: { ...process.env, LNK: f },
          });
          return (r.stdout ?? '').includes(winHelper);
        });
    } catch {
      return [];
    }
  },
};

// ---------- Linux ----------

const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
const linuxHelper = path.join(root, 'bin', 'launch.sh');

const linux = {
  on() {
    linux.off();
    fs.mkdirSync(path.dirname(linuxHelper), { recursive: true });
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(
      linuxHelper,
      `#!/bin/bash
# Opens ${name}. Made by "npm run launcher"; remove with "npm run launcher off".
URL=${q(url)}
if ! curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
  ( cd ${q(root)} && nohup ${q(node)} ${q(tsx)} ${q(entry)} >/dev/null 2>&1 & )
  for _ in $(seq 1 40); do curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
fi
if command -v google-chrome >/dev/null; then google-chrome --app="$URL" &
elif command -v chromium >/dev/null; then chromium --app="$URL" &
else xdg-open "$URL"; fi
`,
      { mode: 0o755 },
    );
    fs.mkdirSync(desktopDir, { recursive: true });
    const icon = path.join(root, 'scripts', 'icon.png');
    fs.writeFileSync(
      path.join(desktopDir, 'assistant-launcher.desktop'),
      `[Desktop Entry]
Type=Application
Name=${name}
Comment=Open ${name}
Exec=${linuxHelper}
${fs.existsSync(icon) ? `Icon=${icon}` : ''}
Terminal=false
Categories=Utility;
`,
    );
    sh('update-desktop-database', [desktopDir]);
    say(`  Made ${path.join(desktopDir, 'assistant-launcher.desktop')}`);
    say(`\n  Find "${name}" in your applications menu.`);
  },
  off() {
    const file = path.join(desktopDir, 'assistant-launcher.desktop');
    const had = fs.existsSync(file);
    fs.rmSync(file, { force: true });
    fs.rmSync(linuxHelper, { force: true });
    say(had ? '  Removed the desktop entry.' : '  There was nothing to remove.');
  },
  list: () => (fs.existsSync(path.join(desktopDir, 'assistant-launcher.desktop')) ? [path.join(desktopDir, 'assistant-launcher.desktop')] : []),
};

// ---------- run ----------

const system = { darwin: mac, win32: win, linux }[process.platform];
if (!system) {
  say(`Not supported on ${process.platform}.`);
  process.exit(1);
}

if (action === 'off') {
  system.off();
} else if (action === 'status') {
  const made = system.list();
  say(made.length ? `On: ${made.join(', ')}` : 'Off. Create it with: npm run launcher');
} else if (action === 'on') {
  if (!fs.existsSync(tsx)) {
    say('Run "npm install" first.');
    process.exit(1);
  }
  say(`Making a launcher called "${name}" ...`);
  system.on();
  say('\n  It opens the assistant in its own window, starting it first if it is not running.');
  say('  To have it always running in the background as well: npm run autostart');
} else {
  say('Usage: npm run launcher [on|off|status]');
  process.exit(1);
}
