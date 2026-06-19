import { useEffect, useRef, useState } from "react";
import type { ModelConfig, ModelSlot, Role, RunStatus } from "../types";
import { useLiveRun } from "../useLiveRun";
import { useProject } from "../useProject";
import { useTranscript } from "../useTranscript";
import { AgentRail } from "./AgentRail";
import { BandRoom } from "./BandRoom";
import { OutputPanel } from "./OutputPanel";

const TYPES = [
  { key: "auto", label: "Auto" },
  { key: "python", label: "Python" },
  { key: "static", label: "Static web" },
] as const;

function statusTone(status: string): { label: string; color: string; pulse: boolean } {
  switch (status) {
    case "starting":
      return { label: "starting agents", color: "var(--tester)", pulse: true };
    case "running":
      return { label: "building", color: "var(--repairer)", pulse: true };
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

// The build workspace: the conversation (left) and the produced files/code (right) are the centerpiece,
// with a chat-style composer docked at the bottom. Models and keys are configured from the header
// drawers, so this view stays focused on the work.
export function BuildView({
  status,
  models,
  onUpdate,
  startBuild,
  stop,
}: {
  status: RunStatus;
  models: ModelConfig | null;
  onUpdate: (target: string, patch: Partial<ModelSlot>) => void;
  startBuild: (description: string, projectType: string) => Promise<RunStatus>;
  stop: () => void;
}) {
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<string>("auto");
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Role | null>(null);

  const live = useLiveRun(liveRunId);
  const pollTranscript = !!liveRunId && !live.done;
  const { transcript } = useTranscript(liveRunId, live.done, pollTranscript);
  const { project } = useProject(liveRunId, live.done);

  const active = status.active || status.status === "starting";
  const tone = statusTone(status.status);

  // Default the Coder to Groq gpt-oss-120b for builds (good code, fast) the first time we have config.
  const seeded = useRef(false);
  useEffect(() => {
    if (!models || seeded.current) return;
    seeded.current = true;
    const coder = models.agents?.coder;
    if (coder && coder.provider === "local") {
      onUpdate("coder", { provider: "groq", model: "openai/gpt-oss-120b" });
    }
  }, [models, onUpdate]);

  const onBuild = async () => {
    if (!description.trim()) return;
    try {
      const s = await startBuild(description.trim(), projectType);
      if (s.run_id) setLiveRunId(s.run_id);
    } catch {
      /* surfaced via status */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5">
      <div className="shrink-0">
        <AgentRail room={live.room} focus={focus} onFocus={(r) => setFocus((f) => (f === r ? null : r))} />
      </div>

      {live.error && (
        <div className="shrink-0 rounded-lg border border-fail/40 bg-fail/10 px-4 py-2 font-mono text-sm text-fail">{live.error}</div>
      )}

      {/* conversation + produced files/code */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-h-[42vh] lg:min-h-0">
          <BandRoom transcript={transcript} room={live.room} live={true} focus={focus} />
        </div>
        <div className="min-h-[42vh] lg:min-h-0">
          <OutputPanel project={project} runId={liveRunId} />
        </div>
      </div>

      {/* composer (docked at the bottom, chat style) */}
      <div className="shrink-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5">
        <div className="flex items-end gap-3">
          <textarea
            value={description}
            disabled={active}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onBuild();
            }}
            placeholder="Describe a small project to build. e.g. a Python module that parses a CSV and prints column stats, or a static landing page with a contact form."
            rows={2}
            className="min-h-0 flex-1 resize-y rounded-lg border border-[var(--line)] bg-black/60 px-3 py-2 font-sans text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)] disabled:opacity-50"
          />
          {active ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-lg border border-fail/50 bg-fail/10 px-4 py-2.5 font-sans text-sm font-semibold text-fail transition-colors hover:bg-fail/20"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onBuild}
              disabled={!description.trim()}
              className="shrink-0 rounded-lg bg-repairer px-5 py-2.5 font-sans text-sm font-semibold text-black shadow-[0_0_24px_-8px_var(--repairer)] transition-transform hover:scale-[1.02] disabled:opacity-40"
            >
              Build
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.pulse ? "animate-blip" : ""}`} style={{ background: tone.color }} />
            <span className="font-mono text-[12px] uppercase tracking-widest" style={{ color: tone.color }}>
              {tone.label}
            </span>
          </span>

          <span className="hidden h-5 w-px bg-[var(--line)] sm:block" />

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">type</span>
            {TYPES.map((t) => (
              <button
                key={t.key}
                disabled={active}
                onClick={() => setProjectType(t.key)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors disabled:opacity-50 ${
                  projectType === t.key ? "bg-white/10 text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <span className="ml-auto hidden font-mono text-[11px] text-[var(--text-3)] lg:block">cmd/ctrl + enter to build</span>
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
      </div>
    </div>
  );
}
