import { useCallback, useEffect, useRef, useState } from "react";

export interface TypewriterEntry {
  /** How many characters of this message's content are currently revealed. */
  revealed: number;
  /** True once all characters have been revealed. */
  done: boolean;
}

interface AnimItem {
  key: string;
  total: number;
  revealed: number;
  done: boolean;
  startedAt: number;
}

// Characters revealed per millisecond: 40 chars/frame at 60 fps ~ 2400 chars/s.
// At this speed a 600-char message finishes in ~0.25s — fast enough to feel like streaming.
const CHARS_PER_MS = 2.4;

/**
 * Animates new messages in typewriter style. Pass an ordered list of {key, content} items;
 * when a key is seen for the first time it gets animated from 0 → full length.
 * Returns a Map<key, TypewriterEntry> you can use to slice each message's content.
 */
export function useTypewriter(
  items: { key: string; content: string }[],
): Map<string, TypewriterEntry> {
  // Stable map of current animation state for every key we've seen.
  const animRef = useRef<Map<string, AnimItem>>(new Map());
  const rafRef = useRef<number>(0);
  const [, setTick] = useState(0);

  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  // Register newly arrived items.
  useEffect(() => {
    let hasNew = false;
    const now = performance.now();
    for (const { key, content } of items) {
      if (!animRef.current.has(key)) {
        animRef.current.set(key, {
          key,
          total: content.length,
          revealed: 0,
          done: false,
          startedAt: now,
        });
        hasNew = true;
      } else {
        // Content may have grown (edge case). Update total without resetting.
        const existing = animRef.current.get(key)!;
        if (content.length > existing.total) {
          animRef.current.set(key, { ...existing, total: content.length });
        }
      }
    }
    if (hasNew) forceUpdate();
  }, [items, forceUpdate]);

  // rAF loop: advance all pending animations.
  useEffect(() => {
    const step = (now: number) => {
      let anyPending = false;
      for (const [, item] of animRef.current) {
        if (item.done) continue;
        // elapsed could be slightly negative if startedAt (performance.now())
        // was sampled after the frame time `now`.
        const elapsed = Math.max(0, now - item.startedAt);
        const newRevealed = Math.min(
          item.total,
          Math.round(elapsed * CHARS_PER_MS),
        );
        if (newRevealed !== item.revealed) {
          item.revealed = newRevealed;
          if (newRevealed >= item.total) item.done = true;
        }
        if (!item.done) anyPending = true;
      }
      forceUpdate();
      if (anyPending) rafRef.current = requestAnimationFrame(step);
    };

    // We start the loop once, and it will self-perpetuate until everything is done.
    // If new items arrive, the other useEffect will call forceUpdate(), which won't
    // re-trigger this effect (since tick is not in the deps), but it WILL cause a re-render.
    // To ensure the loop wakes up if it was idle when new items arrived, we always check
    // and kick it off here.
    const pending = [...animRef.current.values()].some((i) => !i.done);
    if (pending && !rafRef.current) {
      rafRef.current = requestAnimationFrame(step);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [items, forceUpdate]); // Depend on items so when items arrive, it re-runs and kicks off the loop.

  // Build the output map from current animation state.
  const result = new Map<string, TypewriterEntry>();
  for (const [key, item] of animRef.current) {
    result.set(key, { revealed: item.revealed, done: item.done });
  }
  return result;
}
