import { useEffect, useRef, useState } from "react";
import { liveStreamUrl } from "./api";
import { initialRoom, reduceRoom, resetFeedId } from "./room";
import type { QuartetEvent, RoomState } from "./types";

export interface LiveRun {
  room: RoomState;
  connected: boolean;
  done: boolean;
  error: string | null;
  eventCount: number;
}

// Tails an active run over SSE (/api/stream?mode=live) and folds each event into room state as it
// lands, using the same reducer as replay. The stream ends when the conductor scores the Quartet.
export function useLiveRun(runId: string | null): LiveRun {
  const [room, setRoom] = useState<RoomState>(initialRoom);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setError(null);
    setDone(false);
    setConnected(false);
    setEventCount(0);
    resetFeedId();
    setRoom(initialRoom());
    if (!runId) return;

    const es = new EventSource(liveStreamUrl(runId));
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      // Default (unnamed) frames carry the QuartetEvent objects; named frames (start/end/ping) are
      // handled below. Guard on shape so a control frame can never corrupt the fold.
      try {
        const data = JSON.parse(e.data);
        if (data && typeof data.type === "string" && typeof data.role === "string") {
          setRoom((prev) => reduceRoom(prev, data as QuartetEvent));
          setEventCount((c) => c + 1);
        }
      } catch {
        /* ignore malformed frame */
      }
    };

    const onEnd = () => {
      setDone(true);
      es.close();
    };
    es.addEventListener("end", onEnd);
    es.onerror = () => {
      // EventSource auto-reconnects on transient drops; only surface a message if we never opened.
      setConnected((open) => {
        if (!open) setError("could not connect to the live run stream");
        return open;
      });
    };

    return () => {
      es.removeEventListener("end", onEnd);
      es.close();
      esRef.current = null;
    };
  }, [runId]);

  return { room, connected, done, error, eventCount };
}
