// Choosing the voice that reads replies aloud.
//
// Which voices exist depends on the computer and the browser, so nothing can be hard-coded.
// This picks a feminine English voice when one is installed, and remembers any choice the
// user makes instead. The choice is kept per browser, since the names differ between them.

const STORED = 'voiceName';

/**
 * Feminine voices, best first. macOS and Windows ship different sets, so this spans both.
 * Matched case-insensitively against the start of the voice name.
 */
const FEMININE = [
  'samantha', // macOS, en-US: the best of the built-in ones
  'ava',
  'allison',
  'susan',
  'zoe',
  'serena',
  'kate',
  'moira',
  'fiona',
  'tessa',
  'karen',
  'veena', // macOS, en-IN
  'microsoft aria',
  'microsoft jenny',
  'microsoft michelle',
  'microsoft zira',
  'microsoft hazel',
  'microsoft sonia',
  'microsoft heera', // Windows, en-IN
  'google uk english female',
  'google us english',
];

const rank = (voice: SpeechSynthesisVoice): number => {
  const name = voice.name.toLowerCase();
  const i = FEMININE.findIndex((f) => name.startsWith(f));
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

export const isFeminine = (voice: SpeechSynthesisVoice): boolean => rank(voice) !== Number.MAX_SAFE_INTEGER;

/** Every English voice this browser offers, feminine ones first. */
export function listVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  const all = window.speechSynthesis.getVoices();
  const english = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (english.length ? english : all).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Voices arrive asynchronously in some browsers: the first call can return an empty list.
 * Calls back once now and again when they appear.
 */
export function whenVoicesReady(onReady: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!('speechSynthesis' in window)) return () => {};
  const emit = () => onReady(listVoices());
  emit();
  window.speechSynthesis.addEventListener('voiceschanged', emit);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', emit);
}

export const savedVoiceName = (): string => localStorage.getItem(STORED) ?? '';

export function saveVoiceName(name: string): void {
  if (name) localStorage.setItem(STORED, name);
  else localStorage.removeItem(STORED);
}

/** The voice to speak with: the user's choice if it is still installed, else the best feminine one. */
export function chooseVoice(): SpeechSynthesisVoice | null {
  const voices = listVoices();
  if (!voices.length) return null;
  const wanted = savedVoiceName();
  return voices.find((v) => v.name === wanted) ?? voices[0];
}

/** Speak one line. Returns the utterance so the caller can watch for it finishing. */
export function speak(text: string, onEnd: () => void): SpeechSynthesisUtterance | null {
  if (!('speechSynthesis' in window)) return null;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = chooseVoice();
  if (voice) u.voice = voice;
  // With no feminine voice installed, lifting the pitch a little is the only lever left.
  u.pitch = voice && isFeminine(voice) ? 1 : 1.2;
  u.onend = u.onerror = onEnd;
  window.speechSynthesis.speak(u);
  return u;
}
