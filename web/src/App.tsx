import { useEffect, useState, type ReactNode } from "react";
import { fetchRuns } from "./api";
import { BuildView } from "./components/BuildView";
import { CompareView } from "./components/CompareView";
import { Controls } from "./components/Controls";
import { LabView } from "./components/LabView";
import { LiveConsole } from "./components/LiveConsole";
import { ResultsView } from "./components/ResultsView";
import { RoomView } from "./components/RoomView";
import { roleMeta, signalOrder } from "./theme";
import type { RunInfo } from "./types";
import { useLiveRun } from "./useLiveRun";
import { useModels } from "./useModels";
import { usePlayer } from "./usePlayer";
import { useRunStatus } from "./useRunStatus";
import { useTranscript } from "./useTranscript";

type View = "build" | "race" | "lab";
// The Race tab now also hosts Results and Compare (moved here to declutter the top nav).
type RaceTab = "live" | "replay" | "results" | "compare";

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

export default function App() {
  const [view, setView] = useState<View>("build");
  const [raceTab, setRaceTab] = useState<RaceTab>("live");
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [replayRunId, setReplayRunId] = useState<string>("demo-golden");
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(1);

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

  const isRoom = raceTab === "live" || raceTab === "replay";
  const room = raceTab === "replay" ? player.room : live.room;
  const transcriptRunId = raceTab === "replay" ? replayRunId : liveRunId;
  const transcriptDone = raceTab === "replay" ? player.cursor >= player.total : live.done;
  // While a live run streams, poll the transcript so reasoning fills in as agents speak.
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
      <LiveConsole
        status={status}
        models={models}
        saving={saving}
        onUpdate={update}
        onPatchMany={patchMany}
        onReloadModels={reloadModels}
        onRun={onRun}
        onStop={stop}
        onReplay={() => setRaceTab("replay")}
      />
    );

  const statusLabel =
    view === "build"
      ? status.mode === "build" && (status.active || status.status === "starting")
        ? "building"
        : status.mode === "build" && status.status === "done"
          ? "complete"
          : "ready"
      : view === "lab"
        ? status.mode === "lab" && (status.active || status.status === "starting")
          ? "benchmarking"
          : status.mode === "lab" && status.status === "done"
            ? "complete"
            : "ready"
        : raceTab === "results" || raceTab === "compare"
          ? "results"
          : raceTab === "replay"
            ? player.playing
              ? "replaying"
              : "recorded"
            : status.active || status.status === "starting"
              ? "running live"
              : live.done
                ? "complete"
                : "ready";

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 py-5 sm:px-8 lg:px-10">
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <div className="flex items-center gap-4">
          <Glyph />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--text)]">QUARTET</h1>
            <p className="text-[13px] text-[var(--text-2)]">
              four small models collaborate through Band, race one large model, and prove the solution
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden items-center gap-2 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] sm:flex">
            <span className="h-2 w-2 animate-blip rounded-full bg-repairer" />
            {statusLabel}
          </span>
          {view === "race" && (
            <nav className="flex items-center gap-1 rounded-xl border border-[var(--line)] bg-black/40 p-1">
              {RACE_TABS.map((t) => (
                <ModeButton key={t.key} active={raceTab === t.key} onClick={() => setRaceTab(t.key)}>
                  {t.label}
                </ModeButton>
              ))}
            </nav>
          )}
          <nav className="flex items-center gap-1 rounded-xl border border-[var(--line)] bg-black/40 p-1">
            {TABS.map((t) => (
              <TabButton key={t.key} active={view === t.key} onClick={() => setView(t.key)}>
                {t.label}
              </TabButton>
            ))}
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <div key={`${view}-${raceTab}`} className="view-enter h-full min-h-0">
          {view === "build" ? (
            <BuildView
              status={status}
              models={models}
              saving={saving}
              onUpdate={update}
              onPatchMany={patchMany}
              onReloadModels={reloadModels}
              startBuild={startBuild}
              stop={stop}
            />
          ) : view === "lab" ? (
            <LabView
              status={status}
              models={models}
              saving={saving}
              onUpdate={update}
              onPatchMany={patchMany}
              onReloadModels={reloadModels}
              startLab={startLab}
              stop={stop}
            />
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
        <span>
          {view === "build"
            ? status.run_id && status.mode === "build"
              ? `build run ${status.run_id}`
              : "describe a project to build it live"
            : view === "lab"
              ? status.mode === "lab" && status.run_id
                ? `lab run ${status.stack ?? ""} ${status.run_id}`
                : "pick a stack and benchmark it"
              : raceTab === "results" || raceTab === "compare"
                ? "HumanEval benchmark configurations"
                : raceTab === "replay"
                  ? `replay of results/events/${replayRunId}.jsonl`
                  : liveRunId
                    ? `live run ${liveRunId}`
                    : "no live run yet"}
        </span>
        <span>Track 2 / multi-agent software development</span>
      </footer>
    </div>
  );
}

// Four squares in the agent accents: the quartet.
function Glyph() {
  return (
    <div className="grid grid-cols-2 gap-1">
      {signalOrder.map((r) => (
        <span
          key={r}
          className="h-3.5 w-3.5 rounded-[3px]"
          style={{ background: roleMeta[r].color, boxShadow: `0 0 10px -2px ${roleMeta[r].color}` }}
        />
      ))}
    </div>
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
