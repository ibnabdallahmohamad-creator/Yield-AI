"use client";

import { useEffect, useRef, useState } from "react";

/** Hours of forecast shown per second of playback. */
const HOURS_PER_SECOND = 2.2;

/**
 * The weather timeline's position (a fractional hour, so the map animates smoothly between hours)
 * and playback. Playing from the last hour starts again from the first.
 */
export function usePlayback(hours: number) {
  const [t, setT] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const tRef = useRef(0);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // A shorter forecast (new download) must not leave the position past its end.
  const max = Math.max(0, hours - 1);
  if (t > max) setT(max);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const next = tRef.current + dt * HOURS_PER_SECOND;
      if (next >= max) {
        tRef.current = max;
        setT(max);
        setPlayingState(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, max]);

  const setPlaying = (on: boolean) => {
    if (on && tRef.current >= max - 0.01) {
      tRef.current = 0;
      setT(0);
    }
    setPlayingState(on);
  };

  return { t: Math.min(t, max), setT: (v: number) => setT(Math.min(max, Math.max(0, v))), playing, setPlaying };
}
