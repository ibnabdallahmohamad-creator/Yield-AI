"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * Reveal `text` progressively (about 2 s whatever its length). Shows everything at once when
 * disabled or when the user prefers reduced motion.
 */
export function useTypewriter(text: string, enabled: boolean, onDone?: () => void): { shown: string; typing: boolean } {
  const [progress, setProgress] = useState({ text, count: enabled ? 0 : text.length });
  const finish = useEffectEvent(() => onDone?.());

  useEffect(() => {
    if (!enabled) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = reduce ? text.length : Math.max(2, Math.ceil(text.length / 120));
    let n = 0;
    const id = window.setInterval(() => {
      n = Math.min(text.length, n + step);
      setProgress({ text, count: n });
      if (n >= text.length) {
        window.clearInterval(id);
        finish();
      }
    }, 16);
    return () => window.clearInterval(id);
  }, [text, enabled]);

  const count = !enabled ? text.length : progress.text === text ? progress.count : 0;
  return { shown: text.slice(0, count), typing: count < text.length };
}

/**
 * Reveal `total` blocks one after another (a structured answer's sections), about 0.2 s apart; all at
 * once when disabled or with reduced motion.
 */
export function useStagedReveal(total: number, enabled: boolean, onDone?: () => void): { visible: number; revealing: boolean } {
  const [progress, setProgress] = useState({ total, count: enabled ? 0 : total });
  const finish = useEffectEvent(() => onDone?.());

  useEffect(() => {
    if (!enabled) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = reduce ? Math.max(1, total) : 1;
    let n = 0;
    const id = window.setInterval(
      () => {
        n = Math.min(total, n + step);
        setProgress({ total, count: n });
        if (n >= total) {
          window.clearInterval(id);
          finish();
        }
      },
      reduce ? 16 : 200,
    );
    return () => window.clearInterval(id);
  }, [total, enabled]);

  const count = !enabled ? total : progress.total === total ? progress.count : 0;
  return { visible: count, revealing: count < total };
}
