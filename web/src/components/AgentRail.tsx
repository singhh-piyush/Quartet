import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ACTIVE_PHASES, roleMeta, signalOrder } from "../theme";
import type { RoomState, Role } from "../types";
import { useFlowState, type FlowSegment } from "../useFlowState";
import { AgentCard, type RingState } from "./AgentCard";

const FAIL = "#f43f5e";
const STEP = 300; // stagger between path elements (node, connector, node ...)
const SWEEP_MS = 900; // one ring sweep lap (matches the .flow-sweep keyframe in index.css)

interface FlowPlan {
  nodes: Partial<Record<Role, { color: string; delay: number }>>;
  connectors: Record<number, { from: string; to: string; reverse: boolean; delay: number }>;
  arriveDelay: number; // when the destination ignites
  doneDelay: number; // when the whole handoff is finished
}

// Lay out the handoff as a staggered chain of real cards + connectors from source to destination, so the
// light flows source -> connector -> destination (and back through the intermediate cards on a repair
// bounce). Each element gets an increasing delay; the destination ignites when its sweep begins. Forward
// uses each role's colour; a repair bounce is fail-red throughout.
function planFlow(seg: FlowSegment): FlowPlan {
  const fi = signalOrder.indexOf(seg.from);
  const ti = signalOrder.indexOf(seg.to);
  const nodes: FlowPlan["nodes"] = {};
  const connectors: FlowPlan["connectors"] = {};
  const fail = seg.mode === "repair";
  const colorOf = (role: Role) => (fail ? FAIL : roleMeta[role].color);
  let k = 0;

  if (ti >= fi) {
    for (let i = fi; i <= ti; i++) {
      nodes[signalOrder[i]] = { color: colorOf(signalOrder[i]), delay: k * STEP };
      k++;
      if (i < ti) {
        connectors[i] = { from: colorOf(signalOrder[i]), to: colorOf(signalOrder[i + 1]), reverse: false, delay: k * STEP };
        k++;
      }
    }
  } else {
    for (let i = fi; i >= ti; i--) {
      nodes[signalOrder[i]] = { color: colorOf(signalOrder[i]), delay: k * STEP };
      k++;
      if (i > ti) {
        // connector between i-1 and i, travelled right-to-left
        connectors[i - 1] = { from: colorOf(signalOrder[i]), to: colorOf(signalOrder[i - 1]), reverse: true, delay: k * STEP };
        k++;
      }
    }
  }

  const arriveDelay = nodes[seg.to]?.delay ?? 0;
  return { nodes, connectors, arriveDelay, doneDelay: arriveDelay + SWEEP_MS };
}

export function AgentRail({
  room,
  focus,
  onFocus,
}: {
  room: RoomState;
  focus: Role | null;
  onFocus: (r: Role) => void;
}) {
  // Raw room transition (forward vs repair) -> the handoff currently in flight.
  const segment = useFlowState(room);
  // The card showing the steady "active" glow. It only moves to the destination when the sweep ARRIVES,
  // so a card never lights before the handoff reaches it.
  const [litRole, setLitRole] = useState<Role | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<FlowSegment | null>(null);

  useEffect(() => {
    if (segment) setActiveTransfer(segment);
  }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // first activation (conductor -> spec): ignite the first card directly, no sweep
  useEffect(() => {
    if (
      litRole === null &&
      !activeTransfer &&
      !room.finished &&
      room.activeRole &&
      room.activeRole !== "conductor"
    ) {
      setLitRole(room.activeRole);
    }
  }, [room.activeRole, room.finished, litRole, activeTransfer]);

  useEffect(() => {
    if (room.finished) setActiveTransfer(null);
  }, [room.finished]);

  const plan = useMemo(() => (activeTransfer ? planFlow(activeTransfer) : null), [activeTransfer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive arrival (destination ignite) and completion with one-shot timers, so CSS owns the motion and a
  // mid-handoff state update never interrupts a frame (the old SVG rAF + filter was the stutter source).
  useEffect(() => {
    if (!activeTransfer || !plan) return;
    const id = activeTransfer.id;
    const dest = activeTransfer.to;
    const t1 = window.setTimeout(() => setLitRole(dest), plan.arriveDelay);
    const t2 = window.setTimeout(
      () => setActiveTransfer((cur) => (cur && cur.id === id ? null : cur)),
      plan.doneDelay,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [activeTransfer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The lit card circles ("thinking") only once the handoff has fully landed (no transfer in flight) and
  // while that agent is actually working, so a sweep and the circle are never both in motion.
  const litWorking =
    litRole !== null && !room.finished && ACTIVE_PHASES.has(room.agents[litRole].phase);
  const thinkingRole = !activeTransfer && litWorking ? litRole : null;

  const ringFor = (role: Role): RingState | null => {
    if (activeTransfer && plan && plan.nodes[role]) {
      const n = plan.nodes[role]!;
      return { mode: "sweep", color: n.color, delay: n.delay, key: `s${activeTransfer.id}-${role}` };
    }
    if (thinkingRole === role) {
      return { mode: "loop", color: roleMeta[role].color, delay: 0, key: `loop-${role}` };
    }
    return null;
  };

  const card = (role: Role) => (
    <AgentCard
      role={role}
      state={room.agents[role]}
      active={litRole === role && !room.finished}
      thinking={thinkingRole === role}
      ring={ringFor(role)}
      selected={focus === role}
      onSelect={() => onFocus(role)}
    />
  );

  return (
    <div>
      {/* md+: stations on one signal path; the light sweeps each card's OWN border and pulses the gaps */}
      <div className="hidden items-stretch md:flex">
        {signalOrder.map((role, i) => (
          <Fragment key={role}>
            <div className="flex-1">{card(role)}</div>
            {i < signalOrder.length - 1 && (
              <Connector conn={plan?.connectors[i] ?? null} transferId={activeTransfer?.id ?? 0} />
            )}
          </Fragment>
        ))}
      </div>

      {/* mobile: 2-col grid, no connectors (rings still sweep on each card) */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        {signalOrder.map((role) => (
          <Fragment key={role}>{card(role)}</Fragment>
        ))}
      </div>
    </div>
  );
}

// The gap between two stations: a static hairline plus a travelling pulse dot during a handoff (CSS-only,
// no measurement). Colour morphs from the source to the destination role; a repair bounce travels reverse.
function Connector({
  conn,
  transferId,
}: {
  conn: { from: string; to: string; reverse: boolean; delay: number } | null;
  transferId: number;
}) {
  return (
    <div className="relative hidden w-8 shrink-0 items-center md:flex" aria-hidden>
      <div className="h-px w-full" style={{ background: "var(--line)" }} />
      {conn && (
        <span
          key={`${transferId}-c-${conn.delay}`}
          className={`flow-pulse${conn.reverse ? " flow-pulse-rev" : ""}`}
          style={
            { "--pf": conn.from, "--pt": conn.to, "--flow-delay": `${conn.delay}ms` } as CSSProperties
          }
        />
      )}
    </div>
  );
}
