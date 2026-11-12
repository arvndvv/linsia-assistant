# Linsia Assistant

A private assistant that runs on your own computer. You tell it things or give it documents, it remembers them, and you ask later: when a warranty ends, where a paper is kept, what a bill said.

Everything stays in this folder. The model runs locally through Ollama.

## Run it

Works on macOS, Windows and Linux. Needs [Node](https://nodejs.org) 20.19 or newer and [Ollama](https://ollama.com/download).

```
git clone <this repository>
cd assistant
npm install
npm run setup
npm start
```

Open http://127.0.0.1:8787. On first open it walks you through naming it and getting a model.

`npm run setup` looks at which system it is on and prepares it: creates `.env`, checks Ollama, and sets up the two optional parts as far as it can. Anything it cannot install by itself, it tells you the command for. Run it again any time.

| Part | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Voice input | whisper.cpp via Homebrew | whisper.cpp downloaded into `bin/` | build whisper.cpp yourself, set `WHISPER_BIN` |
| Document reading | Apple's text recognition (needs command line tools), else Tesseract | Tesseract + Poppler | Tesseract + Poppler |
| Notifications | Notification Centre | toast notification | `notify-send` |

The assistant starts without the optional parts; the server prints what is ready.

Model size: with 8 GB of memory use a 3B model. A 7B model takes about 5 GB by itself and pushes the machine into swap, which shows up as everything freezing. With more memory or a graphics card, a larger model makes tool use more reliable: change `LLM_MODEL` in `.env`.

`npm test` runs the tests (no model needed). `npm run typecheck` checks types. Both run on all three systems for every push (see `.github/workflows/ci.yml`).

## Open it like any other app

```
npm run launcher       # adds it to your applications, under the name you gave it
npm run launcher off   # remove it
```

Then summon it by name: Command+Space on macOS, the Windows key on Windows, type the name, press Return. It opens in a window of its own, and starts the server first if it is not already running. Drag it to the Dock or pin it to the taskbar to keep it there.

For a key of its own on macOS: open the Shortcuts app, make a new shortcut with the single action "Open App", choose the assistant, then set a Keyboard Shortcut in the shortcut's details. On Windows, open the Start menu entry's Properties and fill in "Shortcut key".

What this is not: it cannot replace Siri or Google Assistant. Those are built into the operating system and closed to other programs, so no third-party app can answer "Hey Siri" or take over the system assistant key. A name in Spotlight, a key of its own, and a window that is always a keystroke away is as close as a program like this gets.

## Keep it running

`npm run dev` is for working on the code. For everyday use there are two other ways to run it:

```
npm start             # builds the screen and runs it on http://127.0.0.1:8787, until you close the terminal
npm run autostart     # the same, started by the system at every login and kept running in the background
npm run autostart off # undo that
```

`autostart` registers a LaunchAgent on macOS, a hidden launcher in the Startup folder on Windows, and a systemd user service on Linux. No administrator rights, and `off` removes what it added. To give it its own window and icon, use the browser's "Install page as app" (Chrome) or "Add to Dock" (Safari).

## After you change the code

`npm run dev` shows changes as you save them. The copy you use day to day runs a built
copy of the screen instead, so it needs one command:

```
npm run reload
```

That rebuilds the screen and restarts the background server. Your records, settings and
reminders are untouched. If you are not running it in the background at all, `reload` just
rebuilds, and the new code is used the next time you open it.

Notes:
- `npm run dev` uses port 8788 for its server, so it can run alongside the background copy. Both use the same data.
- `npm run launcher` on its own is enough for everyday use: opening it starts the server. `autostart` additionally keeps it running from login, which is what expiry notices need in order to arrive without opening the window.
- If the project is on an external drive, the background copy can only run while the drive is plugged in. It retries every 30 seconds. For something meant to be always on, an internal disk is the better home (you can still keep `data/` elsewhere with `DATA_DIR`).
- macOS may ask again for permissions (removable drive, Reminders), this time for `node` instead of your terminal.

## Using it

- **Tell it something:** "AC warranty card is in the blue file, bedroom shelf, valid till 14 March 2027." It shows a card with what it understood. Fix anything wrong, press Save. Nothing is stored before you press Save.
- **Talk to it:** press Talk. It listens, answers aloud when you stop speaking, then listens again. Press Stop or Esc to end the conversation.
- **Give it a document:** drag an image or PDF onto the window, or press Attach. With document reading set up it fills the card from the document's text; without it, say what the document is.
- **Ask:** "When does the AC warranty end?" The answer comes with the record as a card. Click a file on the card to view it. Search also covers the text inside saved documents.
- **Just tell it things:** documents are optional. "My passport is in the grey locker" is enough.
- **Time and dates:** it knows the computer's current date, time and time zone, can tell the time elsewhere, and does date arithmetic in code (purchase date plus warranty period).
- **Timed reminders:** "Remind me to call the plumber in 20 minutes" or "...tomorrow at 9". It shows a card with the exact time and a Cancel button. When the time comes you get a system notification and it says so on screen. On a Mac the reminder is also added to Apple's Reminders app (in a list named after the assistant), so it goes off when the assistant is closed and on your iPhone. macOS asks permission once; `SYSTEM_REMINDERS=off` in `.env` turns this off.
- **Expiry reminders:** when it opens it tells you what expires within 30 days or expired in the last 14. While the server is running it also sends a system notification at 30, 7, 1 and 0 days before an expiry.
- **Rename it:** click the name at the top left, or Settings. It is called Linsia unless you change it.
- **Abilities:** top right. Everything it can do, generated from its skills, with example phrases to click, what is optional, and what it will not do.
- **Memory:** top right. Browse, search, edit or delete anything it knows.
- **History:** top right. Earlier exchanges in this session.
- **Watch strip:** under the header. Date and time, next reminder, what is expiring. Click a chip to have it shown.
- **Voice replies:** top right. Reads answers aloud with the computer's built-in voice.

## Settings

The first time it opens, it asks for a name and helps you get a model: it checks whether Ollama is installed and running, suggests a model sized to the computer's memory, downloads it with a progress bar, and tests that it answers and uses tools.

Everything can be changed later under **Settings** (top right), with no restart:

- **Name.**
- **Model on this computer (Ollama):** pick, download or switch models.
- **Another server:** any OpenAI-compatible address, model and key. The screen warns that what you say and the text of attached documents then go to that server, and a marker stays in the strip under the header.

Settings are stored in `data/settings.json`. The key is kept there, readable only by you, and is never sent back to the screen.

`.env` still works and supplies the starting values. It is also where the less common options live:

| Setting | Meaning |
| --- | --- |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Starting model settings, used until changed on the Settings page. |
| `LLM_TIMEOUT_MS` | How long to wait for the model. |
| `DATA_DIR` | Where the database, documents and settings are stored. |
| `PORT` | Port for everyday use (default 8787). `npm run dev` uses 8788. |
| `SYSTEM_REMINDERS` | macOS: `off` keeps reminders out of Apple's Reminders app. |
| `WHISPER_BIN`, `WHISPER_MODEL` | Voice input program and model, if not in the default places. |

## Where things are

```
server/src/
  index.ts          HTTP server, local only (127.0.0.1)
  agent.ts          one chat turn: model calls tools until it answers
  llm.ts            model client
  local.ts          the parts that differ by operating system: document reading, speech to text, notifications
  memory.ts         records: add, search, expiring, files
  reminders.ts      timed reminders: add, cancel, fire
  time.ts           clock and calendar arithmetic
  db.ts             SQLite schema with full-text search
  skills/
    registry.ts     list of skills the assistant has
    memory.ts       remember, recall, list_expiring
    clock.ts        time_in, date_math
    reminders.ts    set_reminder, list_reminders
    types.ts        what a skill and a tool look like
web/src/            React UI
scripts/            setup.mjs (cross-platform setup) and the macOS document reader source (ocr.swift)
data/               your records (created on first run, not in git)
  assistant.sqlite
  files/            the documents you attached
  settings.json
```

## The assistant's body

`web/src/components/Presence.tsx` draws it, `web/src/index.css` animates it. Three inputs:

- **state**: idle, listening, thinking, speaking.
- **mood**: neutral, happy, sorry, curious, alert, surprised, sleepy. The server decides the mood from what happened (found a record, found nothing, something expiring), not from the model's words.
- **gesture**: nod, shake, bounce, tilt, perk. One-off movements.

To add a mood, add its name to `Mood` in `server/src/types.ts` and a `.presence[data-mood='...']` block in the CSS.

## Adding a skill

A skill is a set of tools plus instructions for the model. Copy `server/src/skills/memory.ts` as a starting point, export a `Skill`, and add it to the list in `registry.ts`. The agent picks it up from there.

Small local models get unreliable when offered more than about six tools at once. Give a skill a `match` pattern and it is only offered when the message (or the exchange just before it) matches; skills without one are always on.

## Guardrails

What the model can do is limited by what tools exist, not by asking it nicely.

- Tools only touch the assistant's own records and reminders. No tool runs commands, reads other files, or reaches the network.
- One exception, macOS only and switchable off: timed reminders are copied into Apple's Reminders app. It creates reminders in its own list and can delete only ones it created.
- The model cannot delete or cancel anything. Deleting records and cancelling reminders are buttons in the UI.
- Saving a record needs your confirmation. Reminders are created straight away because they are harmless and one press undoes them; the card shows the exact time.
- Clock times and dates are computed in code. A reminder in the past, more than two years ahead, or with an unreadable time is refused.
- At most 3 reminders per message and 50 waiting in total.
- The server listens on this machine only (127.0.0.1).

## Design rules worth keeping

- The model never writes to memory directly. It proposes, you confirm.
- Dates and "days left" are computed in code, not by the model.
- Answers about your things come only from `recall` results.

## Not built yet

- Meaning-based search (embeddings). Search is keyword-based with stemming. Left out on purpose for now: it needs a second model in memory.
- Replies arrive whole and are revealed on screen, not streamed from the model.
- On Windows and Linux, reminders only fire while the server is running. (On macOS they are handed to the Reminders app.)

## Keep the data safe

`data/` will hold insurance papers and ID scans.

- Encrypt it: put `data/` on an encrypted volume (FileVault or an encrypted disk image on macOS, BitLocker on Windows) and point `DATA_DIR` at it.
- Back it up: one disk should not be the only copy.
- If it lives on an external drive, eject properly. Unplugging mid-write can corrupt the database.
