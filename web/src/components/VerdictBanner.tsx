import type { RoomState } from "../types";
import { fmtInt } from "../theme";

export function VerdictBanner({ room }: { room: RoomState }) {
  if (!room.verdict) return null;
  const pass = room.verdict === "pass";
  const color = pass ? "#34d399" : "#f43f5e";
  return (
    <div
      className="animate-riseIn flex flex-wrap items-center justify-between gap-4 rounded-xl border px-6 py-4"
      style={{ borderColor: color, background: `${color}10`, boxShadow: `0 0 60px -20px ${color}` }}
    >
      <div className="flex items-center gap-4">
        <span className="h-3 w-3 animate-glow rounded-full" style={{ background: color }} />
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--text-3)]">
            held-out official test
          </div>
          <div className="font-display text-2xl font-bold" style={{ color }}>
            {pass ? "PASS@1 / solution accepted" : "FAIL / hidden tests not passed"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6 font-mono text-sm">
        <Stat label="task" value={room.taskId ?? "-"} />
        <Stat label="test rounds" value={String(room.roundTrips)} />
        <Stat label="tokens" value={fmtInt(room.totalTokens)} accent="#6ee7b7" />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-right">
      <div className="text-base font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="text-[12px] uppercase tracking-widest text-[var(--text-3)]">{label}</div>
    </div>
  );
}
