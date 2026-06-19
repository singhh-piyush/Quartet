import { useEffect, useState, type ReactNode } from "react";
import { fetchRuns } from "./api";
import { BuildView } from "./components/BuildView";
import { CompareView } from "./components/CompareView";
import { Controls } from "./components/Controls";
import { Drawer } from "./components/Drawer";
import { Glyph } from "./components/Glyph";
import { KeyPanel } from "./components/KeyPanel";
import { LabView } from "./components/LabView";
import { LiveConsole } from "./components/LiveConsole";
import { PricingTable } from "./components/PricingTable";
import { ResultsView } from "./components/ResultsView";
import { RoomView } from "./components/RoomView";
import { StackBuilder } from "./components/StackBuilder";
import type { RunInfo, RunStatus } from "./types";
import { useLab } from "./useLab";
import { useLiveRun } from "./useLiveRun";
import { useModels } from "./useModels";
import { usePlayer } from "./usePlayer";
import type { Route } from "./useRoute";
import { useRunStatus } from "./useRunStatus";
import { useTranscript } from "./useTranscript";

type View = "build" | "race" | "lab";
// The Race tab hosts Live and Replay plus the Results and Compare reports (kept here to keep the top nav small).
type RaceTab = "live" | "replay" | "results" | "compare";
type DrawerId = "settings" | null;

const TABS: { key: View; label: string }[] = [
  { key: "build", label: "Build" },
  { key: "race", label: "Race" },
  { key: "lab", label: "Lab" },
];

const RACE_TABS: { key: RaceTab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "replay", label: "Replay" },
  { key: "results", label: "Results" },
  { key: "compare", label: "Compare" },
];

export default function App({ route }: { route: Route }) {
  const q = route.query;
  // Deep links: /app?view=build|race|lab and the landing "watch demo" /app?mode=replay&run=demo-golden.
  const [view, setView] = useState<View>(() => {
    if (q.get("mode") === "replay") return "race";
    const v = q.get("view");
    return v === "race" || v === "lab" ? v : "build";
  });
  const [raceTab, setRaceTab] = useState<RaceTab>(() => (q.get("mode") === "replay" ? "replay" : "live"));
  const [replayRunId, setReplayRunId] = useState<string>(() => q.get("run") || "demo-golden");
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [drawer, setDrawer] = useState<DrawerId>(null);

  useEffect(() => {
    fetchRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  const { status, start, startLab, stop } = useRunStatus();

  // Sync liveRunId with the orchestrator's last run on page load
  useEffect(() => {
    if (!liveRunId && status.run_id && status.mode === "race") {
      setLiveRunId(status.run_id);
    }
  }, [liveRunId, status.run_id, status.mode]);

  const player = usePlayer(replayRunId, speed, setSpeed);
  const liveActive = view === "race" && raceTab === "live";
  const live = useLiveRun(liveActive ? liveRunId : null);
  const { models, saving, update, patchMany, reload: reloadModels } = useModels();
  const lab = useLab();

  const isRoom = raceTab === "live" || raceTab === "replay";
  const room = raceTab === "replay" ? player.room : live.room;
  const transcriptRunId = raceTab === "replay" ? replayRunId : liveRunId;
  const transcriptDone = raceTab === "replay" ? player.cursor >= player.total : live.done;
  const pollTranscript = liveActive && !!liveRunId && !live.done;
  const { transcript } = useTranscript(transcriptRunId, transcriptDone, pollTranscript);

  const onRun = async (taskId: string) => {
    try {
      const s = await start(taskId);
      if (s.run_id) setLiveRunId(s.run_id);
    } catch {
      /* surfaced via run status */
    }
  };

  const controls =
    raceTab === "replay" ? (
      <Controls player={player} runs={runs} runId={replayRunId} setRunId={setReplayRunId} />
    ) : (
      <LiveConsole status={status} onRun={onRun} onStop={stop} onReplay={() => setRaceTab("replay")} />
    );

  const statusLabel = computeStatusLabel(view, raceTab, status, live.done, player.playing);

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 py-2 sm:px-8 lg:px-10">
      <header className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-2">
        <button
          onClick={() => route.navigate("/")}
          className="flex items-center gap-2.5 text-left"
          title="Back to landing"
        >
          <Glyph size={15} />
          <span className="font-display text-base font-extrabold tracking-tight text-[var(--text)]">QUARTET</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] md:flex">
            <span className="h-2 w-2 animate-blip rounded-full bg-repairer" />
            {statusLabel}
          </span>

          <div className="flex items-center gap-1.5">
            <PanelButton onClick={() => setDrawer("settings")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </PanelButton>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-[var(--line)] bg-black/40 p-1">
            {TABS.map((t) => (
              <TabButton key={t.key} active={view === t.key} onClick={() => setView(t.key)}>
                {t.label}
              </TabButton>
            ))}
          </nav>
        </div>
      </header>

      {view === "race" && (
        <div className="mb-3 flex shrink-0 items-center gap-1 self-start rounded-xl border border-[var(--line)] bg-black/40 p-1">
          {RACE_TABS.map((t) => (
            <ModeButton key={t.key} active={raceTab === t.key} onClick={() => setRaceTab(t.key)}>
              {t.label}
            </ModeButton>
          ))}
        </div>
      )}

      <main className="min-h-0 flex-1 relative">
        <div className={`absolute inset-0 ${view === "build" ? "view-enter z-10" : "hidden -z-10"}`}>
          <BuildView status={status} models={models} onUpdate={update} stop={stop} />
        </div>
        <div className={`absolute inset-0 ${view === "lab" ? "view-enter z-10" : "hidden -z-10"}`}>
          <LabView status={status} startLab={startLab} stop={stop} />
        </div>
        <div className={`absolute inset-0 ${view === "race" && isRoom ? "view-enter z-10" : "hidden -z-10"}`}>
          <RoomView
            room={room}
            transcript={transcript}
            controls={controls}
            error={raceTab === "live" ? live.error : player.error}
            live={raceTab === "live"}
          />
        </div>
        <div className={`absolute inset-0 overflow-y-auto ${view === "race" && !isRoom ? "view-enter z-10" : "hidden -z-10"}`}>
          {raceTab === "results" ? <ResultsView animate={true} /> : <CompareView animate={true} />}
        </div>
      </main>

      <footer className="mt-4 flex shrink-0 items-center justify-between border-t border-[var(--line)] pt-3 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)]">
        <span>{computeFooter(view, raceTab, status, liveRunId, replayRunId)}</span>
        <span>Track 2 / multi-agent software development</span>
      </footer>

      {/* Pop-up config panels (slide-over drawers), shared across every view. */}
      <Drawer
        open={drawer === "settings"}
        onClose={() => setDrawer(null)}
        title="Settings"
        subtitle="Configure models, provider keys, and pricing"
      >
        <div className="space-y-8">
          <section>
            <h3 className="mb-3 font-display text-sm font-semibold text-[var(--text)]">Models and stacks</h3>
            <StackBuilder
              models={models}
              status={status}
              saving={saving}
              onUpdate={update}
              onPatchMany={patchMany}
              onReloadModels={reloadModels}
            />
          </section>
          
          <hr className="border-[var(--line)]" />
          
          <section>
            <h3 className="mb-3 font-display text-sm font-semibold text-[var(--text)]">Provider keys</h3>
            <KeyPanel />
          </section>
          
          {view === "lab" && (
            <>
              <hr className="border-[var(--line)]" />
              <section>
                <h3 className="mb-3 font-display text-sm font-semibold text-[var(--text)]">Price table</h3>
                <PricingTable pricing={lab.pricing} onUpdate={lab.updatePrice} />
              </section>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

function computeStatusLabel(view: View, raceTab: RaceTab, status: RunStatus, liveDone: boolean, playing: boolean): string {
  if (view === "build") {
    if (status.mode === "build" && (status.active || status.status === "starting")) return "building";
    if (status.mode === "build" && status.status === "done") return "complete";
    return "ready";
  }
  if (view === "lab") {
    if (status.mode === "lab" && (status.active || status.status === "starting")) return "benchmarking";
    if (status.mode === "lab" && status.status === "done") return "complete";
    return "ready";
  }
  if (raceTab === "results" || raceTab === "compare") return "results";
  if (raceTab === "replay") return playing ? "replaying" : "recorded";
  if (status.active || status.status === "starting") return "running live";
  return liveDone ? "complete" : "ready";
}

function computeFooter(view: View, raceTab: RaceTab, status: RunStatus, liveRunId: string | null, replayRunId: string): string {
  if (view === "build") {
    return status.run_id && status.mode === "build" ? `build run ${status.run_id}` : "describe a project to build it live";
  }
  if (view === "lab") {
    return status.mode === "lab" && status.run_id ? `lab run ${status.stack ?? ""} ${status.run_id}` : "pick a stack and benchmark it";
  }
  if (raceTab === "results" || raceTab === "compare") return "HumanEval benchmark configurations";
  if (raceTab === "replay") return `replay of results/events/${replayRunId}.jsonl`;
  return liveRunId ? `live run ${liveRunId}` : "no live run yet";
}

function PanelButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-[var(--line)] bg-black/30 px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-300 ease-spring ${
        active
          ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(250,204,21,0.3)]"
          : "text-[var(--text-2)] hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all duration-300 ease-spring ${
        active
          ? "bg-spec/15 text-spec shadow-[inset_0_0_0_1px_rgba(56,189,248,0.3)]"
          : "text-[var(--text-2)] hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
