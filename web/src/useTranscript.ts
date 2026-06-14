import { useEffect, useState } from "react";
import { fetchTranscript } from "./api";
import type { Transcript } from "./types";

// Loads the full reasoning transcript for a run. For a live run it is written when the run ends, so
// the panel falls back to the event-stream previews until then; `refreshKey` lets the caller re-pull
// once a run completes.
export function useTranscript(runId: string | null, refreshKey: unknown): {
  transcript: Transcript | null;
  loading: boolean;
} {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setTranscript(null);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchTranscript(runId)
      .then((t) => {
        if (alive) setTranscript(t.missing ? null : t);
      })
      .catch(() => {
        if (alive) setTranscript(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId, refreshKey]);

  return { transcript, loading };
}
