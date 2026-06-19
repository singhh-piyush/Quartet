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
type DrawerId = "stack" | "keys" | "pricing" | null;

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

  const player = usePlayer(replayRunId, speed, setSpeed);
  const { status, start, startBuild, startLab, stop } = useRunStatus();
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
    <div className="flex h-full flex-col overflow-hidden px-6 py-5 sm:px-8 lg:px-10">
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <button onClick={() => route.navigate("/")} className="flex items-center gap-4 text-left" title="Back to landing">
          <Glyph />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--text)]">QUARTET</h1>
            <p className="hidden text-[13px] text-[var(--text-2)] sm:block">
              four small models collaborate through Band, race one large model, and prove the solution
            </p>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] md:flex">
            <span className="h-2 w-2 animate-blip rounded-full bg-repairer" />
            {statusLabel}
          </span>

          <div className="flex items-center gap-1.5">
            <PanelButton onClick={() => setDrawer("stack")}>Stack</PanelButton>
            <PanelButton onClick={() => setDrawer("keys")}>Keys</PanelButton>
            {view === "lab" && <PanelButton onClick={() => setDrawer("pricing")}>Pricing</PanelButton>}
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

      <main className="min-h-0 flex-1">
        <div key={`${view}-${raceTab}`} className="view-enter h-full min-h-0">
          {view === "build" ? (
            <BuildView status={status} models={models} onUpdate={update} startBuild={startBuild} stop={stop} />
          ) : view === "lab" ? (
            <LabView status={status} startLab={startLab} stop={stop} />
          ) : isRoom ? (
            <RoomView
              room={room}
              transcript={transcript}
              controls={controls}
              error={raceTab === "live" ? live.error : player.error}
              live={raceTab === "live"}
            />
          ) : (
            <div className="h-full overflow-y-auto">
              {raceTab === "results" ? <ResultsView animate={true} /> : <CompareView animate={true} />}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-4 flex shrink-0 items-center justify-between border-t border-[var(--line)] pt-3 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)]">
        <span>{computeFooter(view, raceTab, status, liveRunId, replayRunId)}</span>
        <span>Track 2 / multi-agent software development</span>
      </footer>

      {/* Pop-up config panels (slide-over drawers), shared across every view. */}
      <Drawer
        open={drawer === "stack"}
        onClose={() => setDrawer(null)}
        title="Models and stacks"
        subtitle="pick a provider and model per role, save a named stack"
      >
        <StackBuilder
          models={models}
          status={status}
          saving={saving}
          onUpdate={update}
          onPatchMany={patchMany}
          onReloadModels={reloadModels}
        />
      </Drawer>
      <Drawer open={drawer === "keys"} onClose={() => setDrawer(null)} title="Provider keys" subtitle="session only, never stored">
        <KeyPanel />
      </Drawer>
      <Drawer open={drawer === "pricing"} onClose={() => setDrawer(null)} title="Price table" subtitle="dollars per 1M tokens, drives lab cost">
        <PricingTable pricing={lab.pricing} onUpdate={lab.updatePrice} />
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
          ? "bg-repairer/15 text-repairer shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]"
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
