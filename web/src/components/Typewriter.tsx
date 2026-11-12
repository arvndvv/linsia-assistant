import { useEffect, useRef, useState } from 'react';

/** Reveals text a few characters at a time, like speech arriving. */
export function Typewriter({ text, onDone }: { text: string; onDone?: () => void }) {
  const [shown, setShown] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text.length);
      done.current?.();
      return;
    }
    setShown(0);
    const step = Math.max(1, Math.ceil(text.length / 140));
    let n = 0;
    const timer = setInterval(() => {
      n = Math.min(text.length, n + step);
      setShown(n);
      if (n >= text.length) {
        clearInterval(timer);
        done.current?.();
      }
    }, 22);
    return () => clearInterval(timer);
  }, [text]);

  return <>{text.slice(0, shown)}</>;
}
