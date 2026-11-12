// Hands-free listening in the browser. The microphone stays open; each time the user stops
// talking, what they said is handed over as 16 kHz mono WAV, which is what whisper.cpp reads.

export interface Conversation {
  /** Stop hearing for a while (while the assistant thinks or speaks). */
  pause(): void;
  /** Start hearing again. */
  resume(): void;
  /** Close the microphone. */
  stop(): void;
}

export interface ConversationHandlers {
  /** Loudness 0..1, many times a second while hearing. */
  onLevel(level: number): void;
  /** The user started (true) or stopped (false) talking. */
  onSpeech(talking: boolean): void;
  /** One finished utterance. */
  onUtterance(wav: Blob): void;
  /** Something is wrong with the audio: 'silent' (microphone gives no signal) or 'decode' (clip unreadable). */
  onProblem(kind: 'silent' | 'decode'): void;
}

const RATE = 16_000;

function encodeWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Quiet this long after speech means the user has finished. */
const END_SILENCE_MS = 1100;
/** Shorter bursts are coughs and clicks, not speech. */
const MIN_SPEECH_MS = 350;
/** Longest single utterance. */
const MAX_UTTERANCE_MS = 30_000;
/** With nothing said, start a fresh clip this often so clips stay short. */
const IDLE_RESTART_MS = 8_000;

/** Open the microphone and keep listening until stop() is called. */
export async function startConversation(handlers: ConversationHandlers): Promise<Conversation> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  // Browsers may start audio suspended when it is created after a wait. Suspended audio reads as pure silence.
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let peak = 0; // loudest moment in the current clip
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let hearing = false;
  let closed = false;
  let frame = 0;
  let clipStart = 0;
  let speechStart = 0; // 0 = not talking yet in this clip
  let lastLoud = 0;
  let floor = 0.02; // running estimate of room noise

  const toWav = async (blob: Blob): Promise<Blob> => {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * RATE), RATE);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    return encodeWav((await offline.startRendering()).getChannelData(0));
  };

  /** End the current clip. `keep` hands it over; otherwise it is thrown away. */
  const endClip = (keep: boolean) => {
    const rec = recorder;
    recorder = null;
    if (!rec || rec.state === 'inactive') return;
    const mine = chunks;
    rec.onstop = () => {
      if (!keep || closed) return;
      toWav(new Blob(mine, { type: rec.mimeType })).then(handlers.onUtterance, () => handlers.onProblem('decode'));
    };
    rec.stop();
  };

  const beginClip = () => {
    chunks = [];
    const mine = chunks;
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && mine.push(e.data);
    recorder.start();
    clipStart = performance.now();
    speechStart = 0;
    peak = 0;
  };

  const tick = () => {
    frame = requestAnimationFrame(tick);
    if (!hearing) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    handlers.onLevel(Math.min(1, rms * 5));
    peak = Math.max(peak, rms);

    const now = performance.now();
    const loud = rms > Math.max(0.015, floor * 3);
    if (!loud) floor = floor * 0.97 + rms * 0.03;

    if (loud) {
      lastLoud = now;
      if (!speechStart) {
        speechStart = now;
        handlers.onSpeech(true);
      }
    }

    if (speechStart) {
      const finished = now - lastLoud > END_SILENCE_MS;
      if (finished || now - speechStart > MAX_UTTERANCE_MS) {
        const spoke = lastLoud - speechStart >= MIN_SPEECH_MS;
        handlers.onSpeech(false);
        if (spoke) {
          hearing = false;
          handlers.onLevel(0);
          endClip(true);
        } else {
          endClip(false);
          beginClip();
        }
      }
    } else if (now - clipStart > IDLE_RESTART_MS) {
      if (peak < 0.001) handlers.onProblem('silent');
      endClip(false);
      beginClip();
    }
  };

  hearing = true;
  beginClip();
  tick();

  return {
    pause() {
      if (closed) return;
      hearing = false;
      handlers.onLevel(0);
      endClip(false);
    },
    resume() {
      if (closed || hearing) return;
      hearing = true;
      beginClip();
    },
    stop() {
      if (closed) return;
      closed = true;
      hearing = false;
      cancelAnimationFrame(frame);
      handlers.onLevel(0);
      endClip(false);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
