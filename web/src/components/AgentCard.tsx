import { forwardRef } from "react";
import type { CSSProperties } from "react";
import type { AgentState, Role } from "../types";
import { fmtInt, phaseLabel, roleMeta } from "../theme";

const ACTIVE_PHASES = new Set(["receiving", "thinking", "testing"]);

export interface AgentCardProps {
  role: Role;
  state: AgentState;
  active: boolean;
  index: number;
  animate?: boolean;
  onSelect?: () => void;
  selected?: boolean;
}

export function shortModel(model: string): string {
  if (!model || model === "local-model") return model || "";
  const tail = model.split("/").pop() || model;
  return tail.replace(/-Instruct$/i, "").replace(/-Turbo$/i, "");
}

export const AgentCard = forwardRef<HTMLDivElement, AgentCardProps>(
  function AgentCard({ role, state, active, index, animate = true, onSelect, selected = false }, ref) {
    const meta = roleMeta[role];
    const live = state.connected;
    const pulsing = active && ACTIVE_PHASES.has(state.phase);
    const ring = active ? meta.color : selected ? `${meta.color}99` : live ? "var(--line-strong)" : "rgba(255,255,255,0.08)";

    return (
      <div
        ref={ref}
        onClick={onSelect}
        className={`${animate ? "animate-stationIn" : ""} ${onSelect ? "cursor-pointer" : ""} relative flex flex-1 flex-col rounded-lg border bg-[var(--panel)] px-4 py-3.5 transition-all duration-500 ease-spring`}
        style={{
          animationDelay: animate ? `${index * 90}ms` : undefined,
          borderColor: ring,
          boxShadow: active
            ? `0 0 0 1px ${meta.color}, 0 0 24px -4px ${meta.color}55, 0 0 60px -12px ${meta.color}33`
            : selected
              ? `0 0 0 1px ${meta.color}55`
              : live
                ? "0 0 0 0 transparent, 0 1px 4px rgba(0,0,0,0.4)"
                : "none",
          opacity: live ? 1 : 0.4,
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[13px] tracking-widest text-[var(--text-3)]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={`h-2 w-2 rounded-full ${pulsing ? "animate-pulseRing" : ""}`}
            style={{ background: live ? meta.color : "#3f3f46", "--ring": `${meta.color}66` } as CSSProperties}
          />
        </div>

        <div className="mt-1.5">
          <div className="font-display text-xl font-semibold leading-none" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div className="mt-1 text-[13px] text-[var(--text-3)]">{meta.sub}</div>
          {state.model && (
            <div className="mt-1.5 truncate font-mono text-[11px] text-[var(--text-2)]" title={state.model}>
              {shortModel(state.model)}
            </div>
          )}
        </div>

        <div
          className="mt-3 inline-flex w-fit items-center gap-1.5 rounded px-2 py-1 font-mono text-[12px] font-semibold tracking-wider"
          style={{
            color: live ? meta.color : "#52525b",
            background: live ? `${meta.color}14` : "rgba(255,255,255,0.03)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: live ? meta.color : "#52525b" }}
          />
          {phaseLabel[state.phase]}
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-1.5 font-mono">
          <Readout label="llm" value={state.llmCalls} />
          <Readout label="tokens" value={fmtInt(state.tokens)} accent={meta.color} />
          <Readout label="posts" value={state.posts} />
        </div>
      </div>
    );
  },
);

function Readout({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-black/40 px-2 py-1.5 text-center">
      <div className="text-[14px] font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-widest text-[var(--text-3)]">{label}</div>
    </div>
  );
}
