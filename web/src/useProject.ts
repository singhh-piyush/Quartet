import { useCallback, useEffect, useState } from "react";
import { fetchProject } from "./api";
import type { ProjectInfo } from "./types";

// Loads the built project (file tree + README) for a build run. Polls lightly while the run is active
// so files appear as soon as the conductor writes them, and does a final pull when the run completes.
export function useProject(runId: string | null, done: boolean): {
  project: ProjectInfo | null;
  loading: boolean;
  refetch: () => void;
} {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (showLoading: boolean) => {
      if (!runId) return;
      if (showLoading) setLoading(true);
      fetchProject(runId)
        .then((p) => setProject(p.missing ? null : p))
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [runId],
  );

  useEffect(() => {
    if (!runId) {
      setProject(null);
      return;
    }
    load(true);
    // The project dir only appears at the end (the conductor writes it on FINAL_PROJECT), but poll
    // anyway in case of a slow final flush; stop once the run is done and we have files.
    const timer = window.setInterval(() => load(false), 3000);
    return () => window.clearInterval(timer);
  }, [runId, done, load]);

  return { project, loading, refetch: () => load(true) };
}
