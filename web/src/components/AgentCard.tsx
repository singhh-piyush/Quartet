import type { CSSProperties } from "react";
import type { AgentState, Role } from "../types";
import { ACTIVE_PHASES, fmtInt, phaseLabel, roleMeta } from "../theme";

export function shortModel(model: string): string {
  if (!model || model === "local-model") return model || "";
  const tail = model.split("/").pop() || model;
  return tail.replace(/-Instruct$/i, "").replace(/-Turbo$/i, "");
}

// The handoff light IS the card's own border. `.flow-ring` is a child masked to a 1px conic-gradient ring
// at inset:0 with border-radius:inherit, so it traces THIS card's real outline (no second border, no
// measurement). `sweep` runs one eased lap on a handoff; `loop` circles continuously while the agent
// thinks. Driven purely by CSS so it never stutters. AgentRail sets the mode/colour/delay.
export interface RingState {
  mode: "sweep" | "loop";
  color: string;
  delay: number;
  key: string;
}

export interface AgentNodeProps {
  role: Role;
  state: AgentState;
  active: boolean;
  thinking?: boolean;
  ring?: RingState | null;
  onSelect?: () => void;
  selected?: boolean;
}

// A compact station on the signal path. `active` is gated on the handoff ARRIVING (litRole), not the raw
// activeRole, so a card only ignites once the transfer reaches it. `thinking` intensifies the steady glow
// while the agent works; the circling ring is the `.flow-ring` child driven by `ring`.
export function AgentCard({
  role,
  state,
  active,
  thinking = false,
  ring = null,
  onSelect,
  selected = false,
}: AgentNodeProps) {
  const meta = roleMeta[role];
  const live = state.connected;
  const pulsing = active && ACTIVE_PHASES.has(state.phase);
  const border = active
    ? meta.color
    : selected
      ? `${meta.color}88`
      : live
        ? "var(--line)"
        : "rgba(255,255,255,0.08)";

  return (
    <div
      onClick={onSelect}
      className={`relative flex min-h-[96px] flex-col rounded-lg border bg-[var(--panel)] px-3.5 py-3 transition-all duration-500 ease-spring ${
        onSelect ? "cursor-pointer" : ""
      }`}
      style={{
        borderColor: border,
        boxShadow: active
          ? `0 0 0 1px ${meta.color}, 0 0 ${thinking ? 34 : 24}px -6px ${meta.color}${thinking ? "99" : "66"}, var(--elevate)`
          : selected
            ? `0 0 0 1px ${meta.color}44, var(--elevate)`
            : "var(--elevate)",
        opacity: live ? 1 : 0.45,
      }}
    >
      {ring && (
        <span
          key={ring.key}
          aria-hidden
          className={`flow-ring ${ring.mode === "loop" ? "flow-loop" : "flow-sweep"}`}
          style={{ "--flow-color": ring.color, "--flow-delay": `${ring.delay}ms` } as CSSProperties}
        />
      )}

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
