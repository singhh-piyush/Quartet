import type { Player } from "../usePlayer";
import type { RunInfo } from "../types";

const SPEEDS = [0.5, 1, 2, 4];

export function Controls({
  player,
  runs,
  runId,
  setRunId,
}: {
  player: Player;
  runs: RunInfo[];
  runId: string;
  setRunId: (id: string) => void;
}) {
  const { playing, toggle, restart, speed, setSpeed, cursor, total, seek } = player;
  const pct = total ? (cursor / total) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-9 w-9 place-items-center rounded-full bg-repairer text-black transition-all duration-300 ease-spring hover:brightness-110 hover:shadow-[0_0_16px_rgba(52,211,153,0.4)]"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          onClick={restart}
          aria-label="Restart"
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--text-2)] transition-all duration-300 ease-spring hover:bg-white/5 hover:text-white"
        >
          <RestartIcon />
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-black/40 p-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded px-2.5 py-1 font-mono text-[13px] font-semibold transition-all duration-300 ease-spring ${
              speed === s ? "bg-repairer/15 text-repairer shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]" : "text-[var(--text-3)] hover:text-white"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* scrub timeline with a graticule of ticks */}
      <div className="relative flex min-w-[180px] flex-1 items-center">
        <div className="relative h-2 w-full overflow-hidden rounded-full border border-[var(--line)] bg-black/60">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 11px, rgba(255,255,255,0.18) 11px 12px)",
            }}
          />
          <div className="h-full rounded-full bg-repairer/80 transition-all duration-300 ease-spring" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={cursor}
          onChange={(e) => seek(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Scrub timeline"
        />
      </div>
      <span className="w-14 text-right font-mono text-[13px] tabular-nums text-[var(--text-3)]">
        {cursor}/{total}
      </span>

      <select
        value={runId}
        onChange={(e) => setRunId(e.target.value)}
        className="rounded-lg border border-[var(--line)] bg-black/60 px-3 py-2 font-mono text-[13px] text-[var(--text-2)] outline-none focus:border-[var(--line-strong)]"
      >
        {runs.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.kind === "demo" ? "* " : ""}
            {r.run_id} ({r.events} ev{r.complete ? ", scored" : ""})
          </option>
        ))}
      </select>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2.2v9.6L11.5 7 3 2.2Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="3" y="2.5" width="3" height="9" rx="0.6" />
      <rect x="8" y="2.5" width="3" height="9" rx="0.6" />
    </svg>
  );
}
function RestartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 8a5 5 0 1 1-1.46-3.54" strokeLinecap="round" />
      <path d="M13 2.5V5h-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
