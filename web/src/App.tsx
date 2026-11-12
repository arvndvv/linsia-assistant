import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Draft, Entry, FileRef, Health, Mood, Reminder, Settings } from '../../server/src/types.ts';
import { api } from './api.ts';
import { AbilitiesPanel } from './components/AbilitiesPanel.tsx';
import { DraftCard } from './components/DraftCard.tsx';
import { Drawer } from './components/Drawer.tsx';
import { EntryCard } from './components/EntryCard.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ReminderCard, formatDue } from './components/ReminderCard.tsx';
import { Presence, type Gesture, type GestureName, type PresenceState } from './components/Presence.tsx';
import { Typewriter } from './components/Typewriter.tsx';
import { Viewer } from './components/Viewer.tsx';
import { startConversation, type Conversation } from './voice.ts';

/** One thing the user said and what the assistant answered. */
interface Exchange {
  id: number;
  user: string;
  files: FileRef[];
  /** Undefined while the assistant is still thinking. */
  reply?: string;
  cards: Entry[];
  drafts: Draft[];
  reminders?: Reminder[];
  error?: boolean;
  /** Said by the app itself (greeting, reminders). Not sent to the model as history. */
  local?: boolean;
}

/** Which gesture goes with which feeling. */
const GESTURE_FOR: Partial<Record<Mood, GestureName>> = {
  happy: 'nod',
  sorry: 'shake',
  curious: 'tilt',
  alert: 'perk',
  surprised: 'perk',
};

const MOOD_HOLD_MS = 9_000;
const SLEEP_AFTER_MS = 90_000;

let nextId = 1;

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const name = settings?.name ?? 'Assistant';
  const [renaming, setRenaming] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]); // newest first
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<FileRef[]>([]);
  const [phase, setPhase] = useState<PresenceState>('idle');
  const [mood, setMood] = useState<Mood>('neutral');
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [level, setLevel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [speak, setSpeak] = useState(() => localStorage.getItem('speak') === '1');
  const [viewer, setViewer] = useState<FileRef | null>(null);
  const [panel, setPanel] = useState<'memory' | 'abilities' | 'history' | 'settings' | null>(null);
  /** Drafts the user has saved or discarded. Unsettled ones stay on the tray until dealt with. */
  const [settled, setSettled] = useState<Set<string>>(new Set());
  /** What the assistant is keeping an eye on, shown as a strip under the header. */
  const [watch, setWatch] = useState<{ reminders: Reminder[]; attention: Entry[] }>({ reminders: [], attention: [] });
  const [clock, setClock] = useState(() => new Date());
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  /** Set while a hands-free conversation is on. */
  const conversation = useRef<Conversation | null>(null);
  const [talking, setTalking] = useState(false); // conversation on
  const [hearing, setHearing] = useState(false); // user's voice detected right now
  const [transcribing, setTranscribing] = useState(false); // turning speech into text
  const moodTimer = useRef(0);
  const typingTimer = useRef(0);
  const lastActive = useRef(Date.now());
  const greeted = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const moodRef = useRef(mood);
  moodRef.current = mood;

  /** Show a feeling, play its gesture, then settle back to neutral. */
  const feel = useCallback((next: Mood, withGesture: GestureName | undefined = GESTURE_FOR[next]) => {
    window.clearTimeout(moodTimer.current);
    setMood(next);
    if (withGesture) setGesture({ name: withGesture, id: nextId++ });
    if (next !== 'neutral' && next !== 'sleepy') moodTimer.current = window.setTimeout(() => setMood('neutral'), MOOD_HOLD_MS);
  }, []);

  /** Say what needs attention, or just say hello. */
  const greet = useCallback(
    async (who: string) => {
      try {
        const [h, due] = await Promise.all([api.health(), api.attention()]);
        setHealth(h);
        if (due.length) {
          const expired = due.filter((e) => (e.days_left ?? 0) < 0).length;
          const soon = due.length - expired;
          const parts = [soon && `${soon} expiring soon`, expired && `${expired} recently expired`].filter(Boolean);
          setExchanges([{ id: nextId++, user: '', files: [], reply: `Before anything else: ${parts.join(' and ')}.`, cards: due, drafts: [], local: true }]);
          feel('alert');
        } else {
          setExchanges([{ id: nextId++, user: '', files: [], reply: `Hi, I'm ${who}. Tell me something to remember, show me a document, or ask what I know.`, cards: [], drafts: [], local: true }]);
          feel('happy', 'bounce');
        }
        setPhase('speaking');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Could not start.');
        feel('sorry');
      }
    },
    [feel],
  );

  // Start: load settings. A first run goes through setup before the greeting.
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    api
      .settings()
      .then((s) => {
        setSettings(s);
        if (s.setupDone) void greet(s.name);
      })
      .catch((e: Error) => {
        setNotice(e.message);
        feel('sorry');
      });
  }, [greet, feel]);

  useEffect(() => {
    document.title = name;
  }, [name]);

  const refreshWatch = useCallback(async () => {
    try {
      const [reminders, attention] = await Promise.all([api.reminders(), api.attention()]);
      setWatch({ reminders, attention });
    } catch {
      // Server unreachable: keep what is shown.
    }
  }, []);

  useEffect(() => {
    void refreshWatch();
    const tick = window.setInterval(() => {
      setClock(new Date());
      void refreshWatch();
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [refreshWatch]);

  // A reminder went off: say it, whatever else is on screen.
  useEffect(() => {
    const check = window.setInterval(async () => {
      if (phaseRef.current === 'thinking') return;
      try {
        const fired = await api.firedReminders();
        if (!fired.length) return;
        const reply = fired.length === 1 ? `Reminder: ${fired[0].text}.` : `Reminders: ${fired.map((r) => r.text).join('; ')}.`;
        conversation.current?.pause();
        setExchanges((list) => [{ id: nextId++, user: '', files: [], reply, cards: [], drafts: [], reminders: fired, local: true }, ...list]);
        feel('alert', 'bounce');
        setPhase('speaking');
        sayAloudRef.current(reply);
        void refreshWatch();
      } catch {
        // Server unreachable: the next check will try again.
      }
    }, 15_000);
    return () => window.clearInterval(check);
  }, [feel, refreshWatch]);

  // Doze off when left alone, wake on any movement or key.
  useEffect(() => {
    const wake = () => {
      lastActive.current = Date.now();
      if (moodRef.current === 'sleepy') feel('neutral', 'perk');
    };
    const check = window.setInterval(() => {
      if (phaseRef.current === 'idle' && moodRef.current === 'neutral' && Date.now() - lastActive.current > SLEEP_AFTER_MS) setMood('sleepy');
    }, 5_000);
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearInterval(check);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [feel]);

  async function rename(value: string) {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === name) return;
    try {
      setSettings(await api.saveSettings({ name: next }));
      feel('happy');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not rename.');
    }
  }

  async function addFiles(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      try {
        const ref = await api.upload(file);
        setPending((p) => [...p, ref]);
        setNotice('');
        feel('curious');
      } catch (e) {
        setNotice(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
        feel('sorry');
      }
    }
  }

  /** The assistant has finished answering: go back to listening, or rest. */
  function afterReply(fromThinking = false) {
    // Ignore late calls: a slow voice or timer must not interrupt the next turn.
    if (phaseRef.current !== (fromThinking ? 'thinking' : 'speaking')) return;
    if (conversation.current) {
      conversation.current.resume();
      setPhase('listening');
    } else {
      setPhase((p) => (p === 'speaking' ? 'idle' : p));
    }
  }

  const voiceOut = () => (speak || !!conversation.current) && 'speechSynthesis' in window;

  /** Called when the reply has finished appearing on screen. */
  function replyShown() {
    if (!voiceOut() || !(window.speechSynthesis.speaking || window.speechSynthesis.pending)) afterReply();
  }

  function sayAloud(text: string) {
    if (!voiceOut()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // Small gap before listening again, so it does not hear its own last word.
    u.onend = u.onerror = () => window.setTimeout(afterReply, 250);
    window.speechSynthesis.speak(u);
    // If the voice never reports that it finished, carry on anyway.
    window.setTimeout(() => !window.speechSynthesis.speaking && afterReply(), 4_000 + text.length * 90);
  }

  const sayAloudRef = useRef(sayAloud);
  sayAloudRef.current = sayAloud;

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if ((!text && !pending.length) || (textArg === undefined && phase === 'thinking')) return;
    conversation.current?.pause();
    window.speechSynthesis?.cancel();

    const history: ChatMessage[] = exchanges
      .filter((x) => !x.local && !x.error && x.reply)
      .reverse()
      .flatMap((x) => [
        { role: 'user' as const, content: x.user },
        { role: 'assistant' as const, content: x.reply! },
      ]);
    const files = pending;
    const id = nextId++;
    setExchanges((list) => [{ id, user: text, files, cards: [], drafts: [] }, ...list]);
    setInput('');
    setPending([]);
    setNotice('');
    setPhase('thinking');
    feel('neutral');

    const finish = (patch: Partial<Exchange>) => setExchanges((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const res = await api.chat(text, history, files.map((f) => f.id));
      finish({ reply: res.reply, cards: res.cards, drafts: res.drafts, reminders: res.reminders });
      feel(res.mood);
      setPhase('speaking');
      sayAloud(res.reply);
      void refreshWatch();
    } catch (e) {
      finish({ reply: e instanceof Error ? e.message : 'Something went wrong.', error: true });
      feel('sorry');
      setPhase('speaking');
    }
  }

  /** One thing the user said, hands-free: turn it into text and answer it. */
  async function heard(wav: Blob) {
    setHearing(false);
    setPhase('thinking');
    setTranscribing(true);
    try {
      const { text } = await api.transcribe(wav).finally(() => setTranscribing(false));
      if (!conversation.current) return setPhase('idle'); // stopped meanwhile
      if (!text) {
        setNotice('I heard something but could not make out words. Try again, a little closer to the microphone.');
        return afterReply(true); // keep listening
      }
      setNotice('');
      await send(text);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not hear that.');
      feel('sorry');
      stopTalking();
    }
  }
  const heardRef = useRef(heard);
  heardRef.current = heard;

  /** Start a hands-free conversation: listen, answer aloud, listen again, until stopped. */
  async function startTalking() {
    if (conversation.current) return;
    if (health && !health.voice) {
      setNotice('Voice input needs a one-time setup. In the assistant folder run: npm run setup');
      feel('sorry');
      return;
    }
    try {
      window.speechSynthesis?.cancel();
      conversation.current = await startConversation({
        onLevel: setLevel,
        onSpeech: setHearing,
        onUtterance: (wav) => void heardRef.current(wav),
        onProblem: (kind) => {
          if (kind === 'silent') setNotice('The microphone is on but giving no sound. Check the input device and its volume in System Settings, Sound, Input.');
          else {
            setNotice('That clip could not be read. Listening again.');
            conversation.current?.resume();
          }
        },
      });
      setTalking(true);
      setPhase('listening');
      setNotice('');
      feel('neutral', 'perk');
    } catch {
      setNotice('Microphone is blocked. Allow it for this page in the browser, then try again.');
      feel('sorry');
    }
  }

  function stopTalking() {
    conversation.current?.stop();
    conversation.current = null;
    window.speechSynthesis?.cancel();
    setTalking(false);
    setHearing(false);
    setPhase((p) => (p === 'thinking' ? p : 'idle'));
  }

  // Esc ends the conversation. Closing the page releases the microphone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && conversation.current && stopTalking();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => () => conversation.current?.stop(), []);

  function toggleSpeak() {
    const on = !speak;
    setSpeak(on);
    localStorage.setItem('speak', on ? '1' : '0');
    if (!on) {
      if (!conversation.current) {
        window.speechSynthesis?.cancel();
        setPhase((p) => (p === 'speaking' ? 'idle' : p));
      }
    }
  }

  function onType(value: string) {
    setInput(value);
    setTyping(true);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 1_200);
  }

  /** The assistant shows something of its own accord (from the watch strip), without asking the model. */
  function present(reply: string, items: { cards?: Entry[]; reminders?: Reminder[] }, mood: Mood) {
    setExchanges((list) => [{ id: nextId++, user: '', files: [], reply, cards: items.cards ?? [], drafts: [], reminders: items.reminders, local: true }, ...list]);
    feel(mood);
    setPhase('speaking');
  }

  const settle = (draftId: string) => setSettled((prev) => new Set(prev).add(draftId));

  const [current, ...earlier] = exchanges;
  // Drafts from earlier turns stay on the tray until saved or discarded, so nothing proposed is lost.
  const carried = earlier.flatMap((x) => x.drafts).filter((d) => !settled.has(d.draftId));
  const drafts = current?.drafts ?? [];
  const cards = current?.cards ?? [];
  const reminders = current?.reminders ?? [];
  const trayOpen = drafts.length + cards.length + reminders.length + carried.length > 0;
  const trayTitle = drafts.some((d) => !settled.has(d.draftId))
    ? 'Check before I save'
    : cards.length
      ? 'From memory'
      : reminders.length
        ? 'Reminders'
        : carried.length
          ? 'Still waiting for you'
          : 'Done';

  const status = phase === 'listening' ? (hearing ? 'Hearing you' : 'Listening') : phase === 'thinking' ? (transcribing ? 'Working out what you said' : 'Thinking') : phase === 'speaking' && talking ? 'Speaking' : '';
  const busy = phase === 'thinking';

  const nextReminder = watch.reminders[0];
  const soon = watch.attention.filter((e) => (e.days_left ?? 0) >= 0);
  const lapsed = watch.attention.filter((e) => (e.days_left ?? 0) < 0);
  const suggestions = ['When does my warranty end?', 'Remind me in 20 minutes to stretch', 'What time is it in Tokyo?'];
  const showSuggestions = !trayOpen && !busy && !talking && exchanges.filter((x) => !x.local).length === 0;
  const chip = 'rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-glow hover:text-white';

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) {
          setDragging(true);
          feel('surprised');
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
        feel('neutral');
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center justify-between px-5 py-3">
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            maxLength={40}
            className="field w-48"
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename(e.currentTarget.value);
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button onClick={() => setRenaming(true)} title="Click to rename" className="font-medium tracking-wide hover:text-glow">
            {name}
          </button>
        )}
        <nav className="flex gap-4 text-sm text-soft">
          <button onClick={() => setPanel('abilities')} className="hover:text-white">
            Abilities
          </button>
          <button onClick={() => setPanel('memory')} className="hover:text-white">
            Memory
          </button>
          <button onClick={() => setPanel('history')} className="hover:text-white">
            History{earlier.length ? ` (${earlier.length})` : ''}
          </button>
          <button onClick={toggleSpeak} className="hover:text-white" aria-pressed={speak}>
            Voice replies: {speak ? 'on' : 'off'}
          </button>
          <button onClick={() => setPanel('settings')} className="hover:text-white">
            Settings
          </button>
        </nav>
      </header>

      {/* What it is keeping an eye on. */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-5 pb-1 text-xs text-soft">
        <span>
          {clock.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, {clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </span>
        {nextReminder && (
          <button className={chip} onClick={() => present(watch.reminders.length === 1 ? 'One reminder is waiting.' : `${watch.reminders.length} reminders are waiting.`, { reminders: watch.reminders }, 'neutral')}>
            Next reminder: {nextReminder.text}, {formatDue(nextReminder.due_at)}
            {watch.reminders.length > 1 ? ` (+${watch.reminders.length - 1})` : ''}
          </button>
        )}
        {soon.length > 0 && (
          <button className={`${chip} border-amber-400/50 text-amber-200`} onClick={() => present(soon.length === 1 ? 'This expires soon.' : 'These expire soon.', { cards: soon }, 'alert')}>
            {soon.length} expiring soon
          </button>
        )}
        {lapsed.length > 0 && (
          <button className={`${chip} border-red-400/50 text-red-300`} onClick={() => present(lapsed.length === 1 ? 'This expired recently.' : 'These expired recently.', { cards: lapsed }, 'alert')}>
            {lapsed.length} recently expired
          </button>
        )}
        {!nextReminder && !soon.length && !lapsed.length && <span>· nothing needs attention</span>}
        {settings && !settings.llm.local && (
          <button className={`${chip} border-amber-400/50 text-amber-200`} onClick={() => setPanel('settings')} title="What you say is sent to this server">
            Model runs on another server
          </button>
        )}
      </div>

      <main className="flex min-h-0 flex-1 px-5 max-lg:flex-col">
        {/* Stage: the assistant and what it says. Always in view. */}
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center pb-4 text-center">
          <Presence state={phase} mood={mood} gesture={gesture} level={level} hearing={hearing} typing={typing} size={trayOpen ? 190 : 230} />
          <p className={`mt-3 h-4 text-xs tracking-[0.25em] uppercase ${phase === 'listening' ? 'text-emerald-300' : 'text-glow'}`} aria-live="polite">
            {status}
          </p>
          <p className="mt-1 h-4 text-xs text-soft">{talking ? 'Conversation on. Just talk. Press Stop or Esc to end.' : ''}</p>

          <div className="mt-3 w-full max-w-xl">
            {current?.user && <p className="mb-3 truncate text-sm text-soft">You: “{current.user}”</p>}
            {current && current.files.length > 0 && (
              <div className="mb-3 flex flex-wrap justify-center gap-2">
                {current.files.map((f) => (
                  <button key={f.id} onClick={() => setViewer(f)} className="rounded-md border border-line px-2 py-1 text-xs text-glow hover:border-glow">
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            {current?.reply !== undefined && (
              <p key={current.id} className={`stage-in max-h-48 overflow-auto text-2xl leading-snug text-balance ${current.error ? 'text-red-400' : ''}`}>
                <Typewriter text={current.reply} onDone={replyShown} />
              </p>
            )}
            {showSuggestions && (
              <div className="stage-in mt-6 flex flex-wrap justify-center gap-2">
                {suggestions.map((sg) => (
                  <button key={sg} className={chip} onClick={() => onType(sg)}>
                    “{sg}”
                  </button>
                ))}
                <button className={`${chip} text-glow`} onClick={() => setPanel('abilities')}>
                  See everything I can do
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Tray: what the assistant is holding up for you. Slides in only when there is something to show. */}
        <aside className={`min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-500 ease-out ${trayOpen ? 'w-[46%] opacity-100 max-lg:h-1/2 max-lg:w-full' : 'w-0 opacity-0 max-lg:h-0'}`} aria-hidden={!trayOpen}>
          <div className="flex h-full w-[46vw] max-w-full flex-col pb-4 pl-6 max-lg:w-full max-lg:pl-0">
            <h2 className="pb-3 text-xs tracking-[0.2em] text-soft uppercase">{trayTitle}</h2>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
              {drafts.map((d) => (
                <DraftCard
                  key={d.draftId}
                  draft={d}
                  onOpenFile={setViewer}
                  onSaved={() => {
                    settle(d.draftId);
                    feel('happy');
                    void refreshWatch();
                  }}
                  onDiscarded={() => settle(d.draftId)}
                />
              ))}
              {reminders.map((r) => (
                <ReminderCard key={r.id} reminder={r} onCancelled={() => void refreshWatch()} />
              ))}
              {cards.map((c) => (
                <EntryCard key={c.id} entry={c} onOpenFile={setViewer} />
              ))}
              {carried.length > 0 && (drafts.length > 0 || cards.length > 0 || reminders.length > 0) && (
                <p className="pt-3 text-xs tracking-[0.2em] text-soft uppercase">Still waiting for you</p>
              )}
              {carried.map((d) => (
                <DraftCard
                  key={d.draftId}
                  draft={d}
                  onOpenFile={setViewer}
                  onSaved={() => {
                    settle(d.draftId);
                    feel('happy');
                    void refreshWatch();
                  }}
                  onDiscarded={() => settle(d.draftId)}
                />
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer className="px-5 pt-2 pb-4">
        <div className="mx-auto max-w-2xl space-y-2">
          {notice && <p className="text-center text-sm text-amber-300">{notice}</p>}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.map((f) => (
                <span key={f.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-xs">
                  {f.name}
                  <span className="text-soft">{f.has_text ? 'read' : 'not read'}</span>
                  <button onClick={() => setPending((p) => p.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-soft hover:text-white">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className={`flex items-center gap-2 rounded-2xl border bg-panel px-3 py-2 ${dragging ? 'border-glow' : 'border-line'}`}
          >
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg px-2 py-1 text-sm text-soft hover:text-white">
              Attach
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept="image/*,application/pdf"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={textInput}
              autoFocus
              value={input}
              onChange={(e) => onType(e.target.value)}
              placeholder={dragging ? 'Drop to attach' : talking ? 'Listening. You can also type.' : `Tell ${name} something, or ask`}
              className="min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-soft"
            />
            <button
              type="button"
              onClick={() => (talking ? stopTalking() : void startTalking())}
              aria-pressed={talking}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm select-none ${talking ? 'border-emerald-300/70 bg-emerald-300/15 text-white' : 'border-line text-soft hover:text-white'}`}
            >
              {talking && <span className="mic-meter" style={{ ['--level' as string]: level }} aria-hidden />}
              {talking ? 'Stop' : 'Talk'}
            </button>
            <button type="submit" disabled={busy || (!input.trim() && !pending.length)} className="rounded-lg bg-glow px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40">
              Send
            </button>
          </form>
        </div>
      </footer>

      {viewer && <Viewer file={viewer} onClose={() => setViewer(null)} />}
      {panel === 'memory' && (
        <MemoryPanel
          onClose={() => {
            setPanel(null);
            void refreshWatch();
          }}
          onOpenFile={setViewer}
        />
      )}
      {panel === 'abilities' && (
        <AbilitiesPanel
          onClose={() => setPanel(null)}
          onTry={(text) => {
            setPanel(null);
            onType(text);
            textInput.current?.focus();
          }}
        />
      )}
      {panel === 'settings' && settings && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />}
      {settings && !settings.setupDone && (
        <Onboarding
          settings={settings}
          onChange={setSettings}
          onDone={(s) => {
            setSettings(s);
            void greet(s.name);
          }}
        />
      )}
      {panel === 'history' && (
        <Drawer title="Earlier in this session" onClose={() => setPanel(null)}>
          {earlier.length === 0 ? (
            <p className="text-sm text-soft">Nothing yet.</p>
          ) : (
            <div className="space-y-5 text-sm">
              {earlier.map((x) => (
                <div key={x.id} className="space-y-1 border-b border-line pb-4">
                  {x.user && <p className="text-soft">You: “{x.user}”</p>}
                  {x.reply && <p className={x.error ? 'text-red-400' : ''}>{x.reply}</p>}
                  {(x.cards.length > 0 || !!x.reminders?.length) && (
                    <button
                      className="text-xs text-glow hover:underline"
                      onClick={() => {
                        setPanel(null);
                        present(x.reply ?? '', { cards: x.cards, reminders: x.reminders }, 'neutral');
                      }}
                    >
                      Show again ({x.cards.length + (x.reminders?.length ?? 0)})
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Drawer>
      )}
    </div>
  );
}
