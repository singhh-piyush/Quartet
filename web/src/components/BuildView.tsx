import { useEffect, useRef, useState } from "react";
import { buildChat } from "../api";
import type { ModelConfig, ModelSlot, RunStatus, TranscriptMessage } from "../types";
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
  // Show the output pane only once the agents are ACTUALLY working (one of them is writing, code is
  // streaming, or a real agent message landed), not during the 10-15s "starting agents" warmup. So the
  // chat stays full-width while the Orchestrator narrates the warmup, then the output rises in beside it.
  const agentsWorking =
    !!live.room.activeRole ||
    !!live.room.code.preview ||
    (transcript?.messages?.some((m) => {
      const k = (m.role || "").toLowerCase();
      return k !== "user" && k !== "orchestrator";
    }) ??
      false);
  const showOutput = !!liveRunId && (agentsWorking || project !== null || status.status === "error" || status.status === "done");

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
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current && !liveRunId && status.run_id && status.mode === "build") {
      setLiveRunId(status.run_id);
      synced.current = true;
    }
  }, [liveRunId, status.run_id, status.mode]);

  const [sending, setSending] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  // The Orchestrator's normalized build request from the plan step, sent back on Confirm (the textarea
  // is empty then, so without this the build would start with no description).
  const [pendingDescription, setPendingDescription] = useState("");
  // Optimistic messages: user messages appended immediately so they show up before the API responds.
  const [optimisticMsgs, setOptimisticMsgs] = useState<TranscriptMessage[]>([]);

  const onChat = async (confirm = false) => {
    if (!confirm && !description.trim()) return;
    if (active || sending) return;
    setSending(true);
    const msg = description.trim();
    setDescription("");

    // Show user message IMMEDIATELY (optimistic) — before waiting for the server round-trip.
    if (!confirm) {
      const optimistic: TranscriptMessage = {
        ts: new Date().toISOString(),
        role: "user",
        sender: "You",
        content: msg,
        mentions: [],
        kind: "message",
      };
      setOptimisticMsgs((prev) => [...prev, optimistic]);
    }

    try {
      // Talk to the Orchestrator: it replies and kicks off the build (its reply + your message are
      // written into the run transcript, so they show in the chat thread below). On Confirm the
      // textarea is empty, so send the normalized description the Orchestrator returned at the plan step.
      const s = await buildChat(msg, projectType, undefined, liveRunId, confirm, confirm ? pendingDescription : undefined);
      if (s.run_id) setLiveRunId(s.run_id);
      setNeedsConfirm(!!s.needs_confirmation);
      if (s.needs_confirmation && s.description) setPendingDescription(s.description);
      if (confirm) setPendingDescription("");
      // Once transcript polling starts picking up the real messages, clear optimistic ones.
      setOptimisticMsgs([]);
    } catch {
      /* surfaced via status */
    } finally {
      setSending(false);
    }
  };

  // Merge optimistic messages with the real transcript (deduplicate by content+role once real arrives).
  const mergedTranscript = transcript
    ? {
        ...transcript,
        messages:
          optimisticMsgs.length > 0
            ? [
                ...transcript.messages,
                ...optimisticMsgs.filter(
                  (o) => !transcript.messages.some((m) => m.role === o.role && m.content === o.content),
                ),
              ]
            : transcript.messages,
      }
    : optimisticMsgs.length > 0
      ? { messages: optimisticMsgs, run_id: liveRunId ?? "", task_id: undefined, room_id: undefined, prompt: "", final_solution: "" }
      : null;

  return (
    <div
      className="mx-auto w-full h-full min-h-0 grid gap-3.5"
      style={{
        // Always a grid; the right column animates from 0fr → 1fr with a CSS transition so the
        // left chat panel never jumps. The transition is on grid-template-columns only, which the
        // browser composites cheaply without layout recalc on every frame.
        gridTemplateColumns: showOutput
          ? "480px minmax(0, 1fr)"
          : "minmax(0, 1fr) 0fr",
        transition: "grid-template-columns 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* LEFT: the chat window (thread + composer in one panel). Spans the full width on its own; when
          the agents start the grid column animates down to 480px and the output pane rises in beside it. */}
      <section className="flex flex-col overflow-hidden h-full rounded-xl panel-raised">
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
          <div className="flex items-center gap-3">
            {liveRunId && (
              <button
                onClick={() => {
                  setLiveRunId(null);
                  setDescription("");
                }}
                className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
              >
                New Chat
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <BandRoom transcript={mergedTranscript} room={live.room} live={true} focus={null} embedded filterType="user-only" sending={sending} />
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
              placeholder="Describe a small project to build."
              rows={2}
              style={{
                color: "#fafafa",
                caretColor: "#facc15",
                backgroundColor: "#0d0f14",
                WebkitTextFillColor: "#fafafa",
              }}
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-[var(--line)] px-3 py-2.5 font-sans text-[13.5px] outline-none placeholder:text-[#aeb2c0] focus:border-[var(--line-strong)] disabled:opacity-50"
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
                Build
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
      </section>

      {/* RIGHT: the live output window — always in the DOM, fades in when showOutput becomes true.
          overflow-hidden on this wrapper clips the panel during the grid column expansion so you
          never see a partially-visible panel edge mid-transition. */}
      <div
        className="overflow-hidden rounded-xl"
        style={{
          opacity: showOutput ? 1 : 0,
          transition: "opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
          // Pointer events off when hidden so it doesn't intercept clicks on the chat panel
          pointerEvents: showOutput ? "auto" : "none",
        }}
      >
        {(showOutput || liveRunId) && (
          <div key={liveRunId ?? "output"} className={`h-full min-h-0 ${showOutput ? "output-rise" : ""}`}>
            <OutputPanel project={project} runId={liveRunId} liveCode={live.room.code.preview} transcript={transcript} room={live.room} live={true} buildDone={live.done} />
          </div>
        )}
      </div>
    </div>
  );
}
