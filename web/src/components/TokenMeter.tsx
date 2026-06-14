import { useEffect, useState } from "react";
import { AGENT_ROLES, type RoomState } from "../types";
import { fmtInt, roleMeta } from "../theme";
import { useCountUp } from "../useCountUp";

export function TokenMeter({ room, animate = true }: { room: RoomState; animate?: boolean }) {
  const total = room.totalTokens;
  const shown = useCountUp(total);
  const max = Math.max(total, 1);
  const [mounted, setMounted] = useState(!animate);

  useEffect(() => {
    if (animate) {
      const t = setTimeout(() => setMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [animate]);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)]">
          tokens spent
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums text-repairer">
          {fmtInt(shown)}
        </span>
      </div>
      <div className="mt-2.5 flex h-2 overflow-hidden rounded-full border border-[var(--line)] bg-black/60">
        {AGENT_ROLES.map((r) => {
          const t = room.agents[r].tokens;
          if (t === 0) return null;
          return (
            <div
              key={r}
              className="h-full transition-all duration-500 ease-spring"
              style={{ width: mounted ? `${(t / max) * 100}%` : "0%", background: roleMeta[r].color }}
              title={`${roleMeta[r].label}: ${fmtInt(t)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {AGENT_ROLES.map((r) => (
          <span key={r} className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-3)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleMeta[r].color }} />
            {roleMeta[r].label.toLowerCase()} {fmtInt(room.agents[r].tokens)}
          </span>
        ))}
      </div>
    </div>
  );
}
