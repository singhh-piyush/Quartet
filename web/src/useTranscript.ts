import { useEffect, useState } from "react";
import { fetchTranscript } from "./api";
import type { Transcript } from "./types";

// Loads the full reasoning transcript for a run. The conductor now rewrites it incrementally as
// agents speak, so when `poll` is true (a live run in progress) we re-pull every few seconds and the
// reasoning panel fills in live. `refreshKey` forces a one-off re-pull (e.g. once a run completes).
export function useTranscript(
  runId: string | null,
  refreshKey: unknown,
  poll: boolean = false,
): { transcript: Transcript | null; loading: boolean } {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setTranscript(null);
      return;
    }
    let alive = true;
    const load = (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      fetchTranscript(runId)
        .then((t) => {
          // Keep the last good transcript if a poll briefly returns "missing" (file mid-write).
          if (alive && !t.missing) setTranscript(t);
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load(true);
    let timer: number | undefined;
    if (poll) timer = window.setInterval(() => load(false), 3000);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [runId, refreshKey, poll]);

  return { transcript, loading };
}
