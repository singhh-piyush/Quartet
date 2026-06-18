import type { CSSProperties } from "react";
import type { AgentState, Role } from "../types";
import { fmtInt, phaseLabel, roleMeta } from "../theme";

export function shortModel(model: string): string {
  if (!model || model === "local-model") return model || "";
  const tail = model.split("/").pop() || model;
  return tail.replace(/-Instruct$/i, "").replace(/-Turbo$/i, "");
}

// A compact station. The circling glow is NOT drawn here: AgentRail renders a thin rounded-rect ring
// (`.flow-ring`) that hugs this card's outline, and its masked-out centre keeps this card's text clear.
// `current` pulses the status dot for the agent the work currently rests on.
export interface AgentNodeProps {
  role: Role;
  state: AgentState;
  current?: boolean;
  onSelect?: () => void;
  selected?: boolean;
}

export function AgentCard({ role, state, current = false, onSelect, selected = false }: AgentNodeProps) {
  const meta = roleMeta[role];
  const live = state.connected;
  const border = selected ? `${meta.color}88` : live ? "var(--line)" : "rgba(255,255,255,0.08)";

  return (
    <div
      onClick={onSelect}
      className={`relative flex min-h-[96px] flex-col rounded-lg border bg-[var(--panel)] px-3.5 py-3 transition-all duration-300 ease-spring ${
        onSelect ? "cursor-pointer" : ""
      }`}
      style={{
        borderColor: border,
        boxShadow: selected ? `0 0 0 1px ${meta.color}44, var(--elevate)` : "var(--elevate)",
        opacity: live ? 1 : 0.45,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] font-semibold leading-none" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span
          className={`h-2 w-2 rounded-full ${current ? "animate-pulseRing" : ""}`}
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
