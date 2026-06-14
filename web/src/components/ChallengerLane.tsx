import { configColor, fmtInt } from "../theme";
import { shortModel } from "./AgentCard";
import { useCountUp } from "../useCountUp";
import type { RoomState } from "../types";

type Lane = { passed: boolean | null; active: boolean; started: boolean };

function statusLabel(l: Lane): string {
  if (l.passed === true) return "SOLVED";
  if (l.passed === false) return "FAILED";
  if (l.active) return "THINKING";
  if (l.started) return "QUEUED";
  return "STANDBY";
}

function Side({
  title,
  sub,
  tokens,
  color,
  lane,
}: {
  title: string;
  sub: string;
  tokens: number;
  color: string;
  lane: Lane;
}) {
  const shown = useCountUp(tokens);
  const done = lane.passed !== null;
  const tone = lane.passed === true ? "var(--pass)" : lane.passed === false ? "var(--fail)" : color;
  return (
    <div
      className="flex-1 rounded-lg border bg-black/30 p-3.5 transition-all duration-500"
      style={{
        borderColor: lane.active ? color : "var(--line)",
        boxShadow: lane.active ? `0 0 22px -8px ${color}` : "none",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-base font-semibold text-[var(--text)]">{title}</span>
        <span
          className={`font-mono text-[11px] font-semibold tracking-wider ${lane.active && !done ? "animate-blip" : ""}`}
          style={{ color: tone }}
        >
          {statusLabel(lane)}
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-3)]" title={sub}>
        {sub}
      </div>
      <div className="mt-3 font-mono text-2xl font-bold tabular-nums" style={{ color }}>
        {fmtInt(shown)}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-3)]">tokens</div>
    </div>
  );
}

export function ChallengerLane({ room }: { room: RoomState }) {
  const q: Lane = { passed: room.finished ? room.verdict === "pass" : null, active: !room.finished, started: true };
  const c: Lane = {
    passed: room.challenger.verdict === null ? null : room.challenger.verdict === "pass",
    active: room.challenger.active,
    started: room.challenger.started,
  };
  const quartetModel = room.models["spec"] ? `4x ${shortModel(room.models["spec"])}` : "four small models";
  const largeModel = room.challenger.model ? shortModel(room.challenger.model) : "single large model";

  const bothDone = room.finished && room.challenger.verdict !== null;
  const ratio =
    bothDone && room.totalTokens > 0 && room.challenger.tokens > 0
      ? room.totalTokens / room.challenger.tokens
      : null;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">live race</span>
        <span className="font-mono text-[11px] text-[var(--text-3)]">one large model vs the Quartet, same problem</span>
      </div>
      <div className="flex items-stretch gap-3">
        <Side title="Quartet" sub={quartetModel} tokens={room.totalTokens} color={configColor.quartet} lane={q} />
        <div className="flex items-center font-display text-sm font-bold text-[var(--text-3)]">vs</div>
        <Side title="Single large" sub={largeModel} tokens={room.challenger.tokens} color={configColor.single_large} lane={c} />
      </div>
      {bothDone && (
        <p className="mt-3 font-sans text-[13px] leading-snug text-[var(--text-2)]">
          {verdictLine(room.verdict === "pass", room.challenger.verdict === "pass", ratio)}
        </p>
      )}
    </section>
  );
}

function verdictLine(quartetPass: boolean, largePass: boolean, ratio: number | null): string {
  const both = quartetPass && largePass;
  const lead =
    both
      ? "Both solved it"
      : quartetPass
        ? "The Quartet solved it; the single large model did not"
        : largePass
          ? "The single large model solved it; the Quartet did not"
          : "Neither solved it this round";
  if (both && ratio !== null) {
    const pct = Math.round((1 - ratio) * 100);
    if (pct > 0) return `${lead}, and the Quartet used ${pct}% fewer tokens.`;
    if (pct < 0) return `${lead}, with the Quartet using ${Math.abs(pct)}% more tokens.`;
    return `${lead}, at the same token cost.`;
  }
  return `${lead}.`;
}
