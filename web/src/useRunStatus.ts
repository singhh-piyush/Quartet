import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAgents, startBuild as apiStartBuild, startRun as apiStartRun, stopRun as apiStopRun } from "./api";
import type { ModelConfig, RunStatus } from "./types";

const IDLE: RunStatus = { status: "idle", run_id: null, task_id: null, active: false, agents: [] };

// Polls /api/agents so the dashboard can show live run + per-agent process state, and exposes
// start/stop. Polls quickly while a run is active, slowly when idle.
export function useRunStatus(): {
  status: RunStatus;
  start: (taskId: string) => Promise<RunStatus>;
  startBuild: (description: string, projectType: string, stack?: Partial<ModelConfig>) => Promise<RunStatus>;
  stop: () => Promise<void>;
  refresh: () => void;
} {
  const [status, setStatus] = useState<RunStatus>(IDLE);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    fetchAgents()
      .then(setStatus)
      .catch(() => {
        /* server not up yet; keep last */
      });
  }, []);

  useEffect(() => {
    refresh();
    const tick = () => {
      refresh();
      const fast = status.active || status.status === "starting";
      timer.current = window.setTimeout(tick, fast ? 1500 : 5000);
    };
    timer.current = window.setTimeout(tick, 1500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.active, status.status]);

  const start = useCallback(async (taskId: string) => {
    const s = await apiStartRun(taskId);
    setStatus(s);
    return s;
  }, []);

  const startBuild = useCallback(
    async (description: string, projectType: string, stack?: Partial<ModelConfig>) => {
      const s = await apiStartBuild(description, projectType, stack);
      setStatus(s);
      return s;
    },
    [],
  );

  const stop = useCallback(async () => {
    const s = await apiStopRun();
    setStatus(s);
  }, []);

  return { status, start, startBuild, stop, refresh };
}
