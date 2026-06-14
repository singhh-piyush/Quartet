import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEvents } from "./api";
import { reduceAll } from "./room";
import type { QuartetEvent, RoomState } from "./types";

const INITIAL_DELAY_MS = 250;
const GAP_CAP_MS = 1800; // never sit on dead air longer than this between two events

function gapMs(events: QuartetEvent[], i: number): number {
  if (i <= 0) return INITIAL_DELAY_MS;
  const a = Date.parse(events[i - 1].ts);
  const b = Date.parse(events[i].ts);
  const d = b - a;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export interface Player {
  room: RoomState;
  events: QuartetEvent[];
  cursor: number; // events applied so far
  total: number;
  playing: boolean;
  speed: number;
  loading: boolean;
  error: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (n: number) => void;
  setSpeed: (s: number) => void;
}

// Client-side replay engine: loads the whole run once, then advances a cursor on scaled ts deltas.
// Folding from scratch each step keeps the snapshot correct and is cheap for a ~30-event run.
export function usePlayer(runId: string, speed: number, setSpeed: (s: number) => void): Player {
  const [events, setEvents] = useState<QuartetEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setCursor(0);
    setPlaying(false);
    fetchEvents(runId)
      .then((evs) => {
        if (!alive) return;
        setEvents(evs);
        setLoading(false);
        setPlaying(true); // auto-play on load so the stage demo just runs
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  useEffect(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!playing || loading) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const delay = Math.min(gapMs(events, cursor), GAP_CAP_MS) / speed;
    timer.current = window.setTimeout(() => setCursor((c) => c + 1), delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [playing, cursor, speed, events, loading]);

  const room = useMemo(() => reduceAll(events.slice(0, cursor)), [events, cursor]);

  const play = useCallback(() => {
    setCursor((c) => (c >= events.length ? 0 : c));
    setPlaying(true);
  }, [events.length]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);
  const seek = useCallback((n: number) => {
    setPlaying(false);
    setCursor(Math.max(0, n));
  }, []);

  return {
    room,
    events,
    cursor,
    total: events.length,
    playing,
    speed,
    loading,
    error,
    play,
    pause,
    toggle,
    restart,
    seek,
    setSpeed,
  };
}
