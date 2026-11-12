import { useEffect, useRef } from 'react';
import type { Mood } from '../../../server/src/types.ts';

export type PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type GestureName = 'nod' | 'shake' | 'bounce' | 'tilt' | 'perk';
export interface Gesture {
  name: GestureName;
  /** Change this to play the gesture again. */
  id: number;
}

const FACETS = [
  '100,36 152,68 136,80 100,58',
  '152,68 144,130 128,122 136,80',
  '144,130 100,164 100,142 128,122',
  '100,164 56,130 72,122 100,142',
  '56,130 48,68 64,80 72,122',
  '48,68 100,36 100,58 64,80',
];
const VOICE_BARS = Array.from({ length: 28 }, (_, i) => i);

interface Props {
  state: PresenceState;
  mood: Mood;
  gesture: Gesture | null;
  size: number;
  /** Microphone loudness 0..1 while listening. */
  level?: number;
  /** The user's voice is being picked up right now. */
  hearing?: boolean;
  /** Glance down at the text box while the user types. */
  typing?: boolean;
}

/**
 * The assistant's body: a cut-crystal head with two eyes, inside a slow gyroscope of orbits.
 *
 * state   what it is doing: idle, listening, thinking, speaking
 * mood    how it feels: changes eye shape, posture and colour
 * gesture a one-off movement: nod, shake, bounce, tilt, perk
 *
 * Eyes follow the pointer and blink. Pure SVG and CSS (see index.css), no dependencies.
 */
export function Presence({ state, mood, gesture, size, level = 0, hearing = false, typing = false }: Props) {
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = root.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / 400);
        el.style.setProperty('--gx', `${((dx / dist) * 8 * reach).toFixed(2)}px`);
        el.style.setProperty('--gy', `${((dy / dist) * 6 * reach).toFixed(2)}px`);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    root.current?.style.setProperty('--level', level.toFixed(3));
  }, [level]);

  return (
    <svg
      ref={root}
      className="presence"
      data-state={state}
      data-mood={mood}
      data-typing={typing || undefined}
      data-hearing={hearing || undefined}
      style={{ width: size, height: size }}
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Assistant is ${state}${mood === 'neutral' ? '' : `, ${mood}`}`}
    >
      <defs>
        <linearGradient id="presence-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="presence-c1" />
          <stop offset="0.5" className="presence-c2" />
          <stop offset="1" className="presence-c3" />
        </linearGradient>
        <radialGradient id="presence-halo-fill">
          <stop offset="0" className="presence-c2" stopOpacity="0.55" />
          <stop offset="1" className="presence-c2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="presence-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2140" />
          <stop offset="1" stopColor="#0a0c16" />
        </linearGradient>
      </defs>

      <circle className="presence-halo" cx="100" cy="100" r="96" fill="url(#presence-halo-fill)" />

      {/* Sonar ripples: only while listening. */}
      <circle className="presence-ripple" cx="100" cy="100" r="70" />
      <circle className="presence-ripple presence-ripple-b" cx="100" cy="100" r="70" />

      <g className="presence-orbits">
        <g className="presence-orbit presence-orbit-a">
          <ellipse cx="100" cy="100" rx="92" ry="30" />
          <ellipse className="presence-comet" cx="100" cy="100" rx="92" ry="30" pathLength="100" />
        </g>
        <g className="presence-orbit presence-orbit-b">
          <ellipse cx="100" cy="100" rx="92" ry="30" />
          <ellipse className="presence-comet" cx="100" cy="100" rx="92" ry="30" pathLength="100" />
        </g>
      </g>

      <g className="presence-voice">
        {VOICE_BARS.map((i) => (
          <g key={i} transform={`rotate(${(360 / VOICE_BARS.length) * i} 100 100)`}>
            <rect
              x="98.5"
              y="14"
              width="3"
              height="12"
              rx="1.5"
              style={{ animationDelay: `${((i * 7) % VOICE_BARS.length) * -0.045}s`, ['--k' as string]: 0.5 + ((i * 5) % 7) / 7 }}
            />
          </g>
        ))}
      </g>

      {/* Remounting on a new gesture id restarts the animation. */}
      <g key={gesture?.id ?? 0} className={`presence-gesture${gesture ? ` presence-g-${gesture.name}` : ''}`}>
        <g className="presence-posture">
          <g className="presence-head">
            {FACETS.map((points, i) => (
              <polygon key={i} className="presence-facet" points={points} style={{ animationDelay: `${i * 0.35}s` }} />
            ))}
            <polygon points="100,58 136,80 128,122 100,142 72,122 64,80" fill="url(#presence-plate)" />
            <polygon className="presence-edge" points="100,36 152,68 144,130 100,164 56,130 48,68" />
            <polygon className="presence-edge presence-edge-inner" points="100,58 136,80 128,122 100,142 72,122 64,80" />

            <g className="presence-eyes">
              <g className="presence-glance">
                <g className="presence-eye-l">
                  <path className="presence-eye" d="M84 84 L92 100 L84 116 L76 100 Z" />
                  <path className="presence-smile-eye" d="M75 105 Q84 88 93 105" />
                </g>
                <g className="presence-eye-r">
                  <path className="presence-eye" d="M116 84 L124 100 L116 116 L108 100 Z" />
                  <path className="presence-smile-eye" d="M107 105 Q116 88 125 105" />
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
