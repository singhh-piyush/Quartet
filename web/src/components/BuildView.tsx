import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { buildChat } from "../api";
import { ACTIVE_PHASES, phaseLabel, roleMeta, signalOrder } from "../theme";
import type { ModelConfig, ModelSlot, RoomState, RunStatus } from "../types";
import { useLiveRun } from "../useLiveRun";
import { useProject } from "../useProject";
import { useTranscript } from "../useTranscript";
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

// Compact, inline agent activity: the four stations as a thin row of chips (dot + label), the active
// one pulsing. This REPLACES the old standalone AgentRail so Build reads as one chat, not a dashboard.
function AgentStrip({ room }: { room: RoomState }) {
  return (
    <div className="flex items-center gap-1">
      {signalOrder.map((r) => {
        const a = room.agents[r];
        const meta = roleMeta[r];
        const active = !!a && ACTIVE_PHASES.has(a.phase);
        const on = !!a?.connected;
        return (
          <span
            key={r}
            title={`${meta.label}: ${phaseLabel[a?.phase ?? "idle"]}`}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5"
            style={{ background: active ? `${meta.color}1a` : "transparent" }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${active ? "animate-blip" : ""}`}
              style={{ background: on ? meta.color : "var(--text-3)", opacity: on ? 1 : 0.4 }}
            />
            <span
              className="font-mono text-[10.5px] uppercase tracking-wide"
              style={{ color: active ? meta.color : "var(--text-3)" }}
            >
              {meta.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// The build workspace is a modern coding chat: LEFT a chat window (you talk, the Band agents work, all
// in one thread with the composer docked at the bottom), RIGHT a live output window (file tree + code +
// preview). Models and keys are configured from the header drawers, so this view stays focused.
export function BuildView({
  status,
  models,
  onUpdate,
  stop,
}: {
  status: RunStatus;
  models: ModelConfig | null;
  onUpdate: (target: string, patch: Partial<ModelSlot>) => void;
  stop: () => void;
}) {
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<string>("auto");
  const [liveRunId, setLiveRunId] = useState<string | null>(null);

  const live = useLiveRun(liveRunId);
  const pollTranscript = !!liveRunId && !live.done;
  const { transcript } = useTranscript(liveRunId, live.done, pollTranscript);
  const { project } = useProject(liveRunId, live.done);

  const active = status.active || status.status === "starting";
  const tone = statusTone(status.status);
  const showOutput = active || project !== null || status.status === "error" || status.status === "done";

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

  // Sync liveRunId with the orchestrator's last run on page load
  useEffect(() => {
    if (!liveRunId && status.run_id && status.mode === "build") {
      setLiveRunId(status.run_id);
    }
  }, [liveRunId, status.run_id, status.mode]);

  const [sending, setSending] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const onChat = async (confirm = false) => {
    if (!confirm && !description.trim()) return;
    if (active || sending) return;
    setSending(true);
    try {
      // Talk to the Orchestrator: it replies and kicks off the build (its reply + your message are
      // written into the run transcript, so they show in the chat thread below).
      const s = await buildChat(description.trim(), projectType, undefined, liveRunId, confirm);
      if (s.run_id) setLiveRunId(s.run_id);
      setNeedsConfirm(!!s.needs_confirmation);
      setDescription("");
    } catch {
      /* surfaced via status */
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div layout className={`mx-auto w-full h-full min-h-0 ${showOutput ? "grid grid-cols-1 lg:grid-cols-[480px_minmax(0,1fr)] gap-3.5" : "max-w-4xl"}`}>
      {/* LEFT: the chat window (thread + composer in one panel) */}
      <motion.section layout className={`flex flex-col overflow-hidden rounded-xl panel-raised ${showOutput ? "min-h-[46vh] lg:min-h-0" : "h-full"}`}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-[15px] font-semibold text-[var(--text)]">Build chat</span>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${tone.pulse ? "animate-blip" : ""}`} style={{ background: tone.color }} />
              <span className="font-mono text-[10.5px] uppercase tracking-widest" style={{ color: tone.color }}>
                {tone.label}
              </span>
            </span>
          </div>
          <AgentStrip room={live.room} />
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <BandRoom transcript={transcript} room={live.room} live={true} focus={null} embedded filterType="user-only" />
        </div>

        {live.error && (
          <div className="shrink-0 border-t border-fail/40 bg-fail/10 px-4 py-2 font-mono text-[12px] text-fail">{live.error}</div>
        )}

        {/* composer docked inside the chat window */}
        <div className="shrink-0 border-t border-[var(--line)] p-3">
          <div className="flex items-end gap-2.5">
            <textarea
              value={description}
              disabled={active}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  onChat(false);
                }
              }}
              placeholder="Describe a small project to build. e.g. a Python module that parses a CSV and prints column stats, or a static landing page about your cat."
              rows={1}
              className="min-h-[44px] flex-1 resize-y rounded-lg border border-[var(--line)] bg-black/60 px-3 py-2.5 font-sans text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)] disabled:opacity-50"
            />
            {active ? (
              <button
                onClick={stop}
                className="shrink-0 rounded-lg border border-fail/50 bg-fail/10 px-4 py-2.5 h-[44px] font-sans text-sm font-semibold text-fail transition-colors hover:bg-fail/20"
              >
                Stop
              </button>
            ) : needsConfirm ? (
              <div className="flex gap-2">
                <button
                  onClick={() => onChat(false)}
                  disabled={!description.trim() || sending}
                  className="shrink-0 rounded-lg bg-[var(--accent)]/20 px-4 py-2.5 h-[44px] font-sans text-sm font-semibold text-[var(--accent)] transition-transform hover:scale-[1.02] disabled:opacity-40"
                >
                  Reply
                </button>
                <button
                  onClick={() => onChat(true)}
                  disabled={sending}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-5 py-2.5 h-[44px] font-sans text-sm font-semibold text-black shadow-[0_0_24px_-8px_var(--accent)] transition-transform hover:scale-[1.02] disabled:opacity-40"
                >
                  Confirm & Build
                </button>
              </div>
            ) : (
              <button
                onClick={() => onChat(false)}
                disabled={!description.trim() || sending}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-5 py-2.5 h-[44px] font-sans text-sm font-semibold text-black shadow-[0_0_24px_-8px_var(--accent)] transition-transform hover:scale-[1.02] disabled:opacity-40"
              >
                {sending ? "Sending..." : "Build"}
              </button>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-3">
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
            <span className="ml-auto hidden font-mono text-[11px] text-[var(--text-3)] lg:block">cmd/ctrl + enter</span>
          </div>

          {status.warnings && status.warnings.length > 0 && (
            <div className="mt-2.5 space-y-1">
              {status.warnings.map((w, i) => (
                <div key={i} className="rounded-md border border-tester/30 bg-tester/10 px-3 py-1.5 font-mono text-[12px] text-tester">
                  {w}
                </div>
              ))}
            </div>
          )}
          {status.status === "error" && status.error && (
            <div className="mt-2.5 rounded-md border border-fail/40 bg-fail/10 px-3 py-1.5 font-mono text-[12px] text-fail">
              {status.error}
            </div>
          )}
        </div>
      </motion.section>

      {/* RIGHT: the live output window */}
      <AnimatePresence>
        {showOutput && (
          <motion.section
            key="output-panel"
            initial={{ opacity: 0, x: 50, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 50, filter: "blur(4px)" }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-[46vh] lg:min-h-0 overflow-hidden rounded-xl"
          >
            <OutputPanel project={project} runId={liveRunId} liveCode={live.room.code.preview} transcript={transcript} room={live.room} live={true} />
          </motion.section>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
