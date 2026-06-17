import type { CSSProperties } from "react";
import type { AgentState, Role } from "../types";
import { fmtInt, phaseLabel, roleMeta } from "../theme";

const ACTIVE_PHASES = new Set(["receiving", "thinking", "testing"]);

export function shortModel(model: string): string {
  if (!model || model === "local-model") return model || "";
  const tail = model.split("/").pop() || model;
  return tail.replace(/-Instruct$/i, "").replace(/-Turbo$/i, "");
}

export interface AgentNodeProps {
  role: Role;
  state: AgentState;
  active: boolean;
  // integrated border-flow: the ring sweeps once when this node participates in a handoff.
  sweep: boolean;
  sweepKey: number;
  flowColor: string;
  flowDelay: number;
  onSelect?: () => void;
  selected?: boolean;
}

// A compact station on the signal path. The handoff animation is integrated into the node's own
// border via the `.flow-ring` child (no measurement, always pixel-perfect to the shape).
export function AgentCard({
  role,
  state,
  active,
  sweep,
  sweepKey,
  flowColor,
  flowDelay,
  onSelect,
  selected = false,
}: AgentNodeProps) {
  const meta = roleMeta[role];
  const live = state.connected;
  const pulsing = active && ACTIVE_PHASES.has(state.phase);
  const ring = active ? meta.color : selected ? `${meta.color}88` : live ? "var(--line)" : "rgba(255,255,255,0.08)";

  return (
    <div
      onClick={onSelect}
      className={`relative flex min-h-[96px] flex-col rounded-lg border bg-[var(--panel)] px-3.5 py-3 transition-all duration-500 ease-spring ${
        onSelect ? "cursor-pointer" : ""
      }`}
      style={{
        borderColor: ring,
        boxShadow: active
          ? `0 0 0 1px ${meta.color}, 0 0 26px -6px ${meta.color}66, var(--elevate)`
          : selected
            ? `0 0 0 1px ${meta.color}44, var(--elevate)`
            : "var(--elevate)",
        opacity: live ? 1 : 0.45,
      }}
    >
      {/* integrated border light: remounts on each new segment so the sweep replays cleanly */}
      <span
        key={sweepKey}
        className={`flow-ring ${sweep ? "sweep" : ""}`}
        style={{ "--flow": flowColor, animationDelay: `${flowDelay}ms` } as CSSProperties}
      />

      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] font-semibold leading-none" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span
          className={`h-2 w-2 rounded-full ${pulsing ? "animate-pulseRing" : ""}`}
          style={{ background: live ? meta.color : "#3f3f46", "--ring": `${meta.color}66` } as CSSProperties}
        />
      </div>

      <div className="mt-auto pt-2.5">
        <div
          className="inline-flex w-fit items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-wider"
          style={{
            color: live ? meta.color : "#6b7280",
            background: live ? `${meta.color}16` : "rgba(255,255,255,0.03)",
          }}
        >
          {phaseLabel[state.phase]}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span
            className="min-w-0 truncate font-mono text-[11px] text-[var(--text-3)]"
            title={state.model || "model assigned at run start"}
          >
            {state.model ? shortModel(state.model) : "model pending"}
          </span>
          {state.tokens > 0 && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-2)]">
              {fmtInt(state.tokens)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
