import { useState } from "react";
import type { ModelConfig, ModelSlot, RunStatus } from "../types";
import { StackBuilder } from "./StackBuilder";

const TASKS = [
  "HumanEval/0",
  "HumanEval/2",
  "HumanEval/4",
  "HumanEval/8",
  "HumanEval/10",
  "HumanEval/32",
  "HumanEval/40",
  "HumanEval/126",
];

function statusTone(status: string): { label: string; color: string; pulse: boolean } {
  switch (status) {
    case "starting":
      return { label: "starting agents", color: "var(--tester)", pulse: true };
    case "running":
      return { label: "running", color: "var(--repairer)", pulse: true };
    case "done":
      return { label: "complete", color: "var(--pass)", pulse: false };
    case "error":
      return { label: "error", color: "var(--fail)", pulse: false };
    case "stopped":
      return { label: "stopped", color: "var(--text-3)", pulse: false };
    default:
      return { label: "ready", color: "var(--text-3)", pulse: false };
  }
}

export function LiveConsole({
  status,
  models,
  saving,
  onUpdate,
  onPatchMany,
  onReloadModels,
  onRun,
  onStop,
  onReplay,
}: {
  status: RunStatus;
  models: ModelConfig | null;
  saving: boolean;
  onUpdate: (target: string, patch: Partial<ModelSlot>) => void;
  onPatchMany: (patch: Partial<ModelConfig>) => void;
  onReloadModels: () => void;
  onRun: (taskId: string) => void;
  onStop: () => void;
  onReplay: () => void;
}) {
  const [task, setTask] = useState(TASKS[0]);
  const [showModels, setShowModels] = useState(false);
  const active = status.active || status.status === "starting";
  const tone = statusTone(status.status);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${tone.pulse ? "animate-blip" : ""}`}
            style={{ background: tone.color }}
          />
          <span className="font-mono text-[12px] uppercase tracking-widest" style={{ color: tone.color }}>
            {tone.label}
          </span>
        </span>

        <span className="hidden h-5 w-px bg-[var(--line)] sm:block" />

        <label className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">problem</span>
          <select
            value={task}
            disabled={active}
            onChange={(e) => setTask(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)] disabled:opacity-50"
          >
            {TASKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {active ? (
          <button
            onClick={onStop}
            className="rounded-lg border border-fail/50 bg-fail/10 px-4 py-1.5 font-sans text-sm font-semibold text-fail transition-colors hover:bg-fail/20"
          >
            Stop run
          </button>
        ) : (
          <button
            onClick={() => onRun(task)}
            className="rounded-lg bg-repairer px-4 py-1.5 font-sans text-sm font-semibold text-black shadow-[0_0_24px_-8px_var(--repairer)] transition-transform hover:scale-[1.02]"
          >
            Run live
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setShowModels((s) => !s)}
            className={`rounded-lg border px-3 py-1.5 font-sans text-sm font-semibold transition-colors ${
              showModels ? "border-[var(--line-strong)] text-white" : "border-[var(--line)] text-[var(--text-2)] hover:text-white"
            }`}
          >
            Stacks
          </button>
          <button
            onClick={onReplay}
            className="font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] underline-offset-4 hover:text-[var(--text-2)] hover:underline"
          >
            view recorded
          </button>
        </div>
      </div>

      {status.warnings && status.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {status.warnings.map((w, i) => (
            <div key={i} className="rounded-md border border-tester/30 bg-tester/10 px-3 py-1.5 font-mono text-[12px] text-tester">
              {w}
            </div>
          ))}
        </div>
      )}

      {status.status === "error" && status.error && (
        <div className="mt-3 rounded-md border border-fail/40 bg-fail/10 px-3 py-1.5 font-mono text-[12px] text-fail">
          {status.error}
        </div>
      )}

      {showModels && (
        <div className="mt-3">
          <StackBuilder
            models={models}
            status={status}
            saving={saving}
            onUpdate={onUpdate}
            onPatchMany={onPatchMany}
            onReloadModels={onReloadModels}
          />
        </div>
      )}
    </div>
  );
}
