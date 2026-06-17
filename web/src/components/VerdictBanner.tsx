import type { RoomState } from "../types";
import { fmtInt } from "../theme";

// Compact PASS@1 crown for the top of the proof rail (replaces the old full-width banner).
export function VerdictBanner({ room }: { room: RoomState }) {
  if (!room.verdict) return null;
  const pass = room.verdict === "pass";
  const color = pass ? "#34d399" : "#f43f5e";
  return (
    <div
      className="animate-riseIn flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border px-4 py-2.5"
      style={{ borderColor: color, background: `${color}12`, boxShadow: `0 0 44px -18px ${color}` }}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 animate-glow rounded-full" style={{ background: color }} />
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--text-3)]">
            held-out official test
          </div>
          <div className="font-display text-[17px] font-bold leading-tight" style={{ color }}>
            {pass ? "PASS@1 / accepted" : "FAIL / hidden tests"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 font-mono text-[12px]">
        <Stat label="rounds" value={String(room.roundTrips)} />
        <Stat label="tokens" value={fmtInt(room.totalTokens)} accent="#6ee7b7" />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-right">
      <div className="text-[14px] font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="text-[10.5px] uppercase tracking-widest text-[var(--text-3)]">{label}</div>
    </div>
  );
}
