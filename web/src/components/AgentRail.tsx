import { Fragment, type CSSProperties } from "react";
import { roleMeta, signalOrder } from "../theme";
import type { RoomState, Role } from "../types";
import { useFlowState, type FlowSegment } from "../useFlowState";
import { AgentCard } from "./AgentCard";

const STEP = 320; // ms between successive elements along the travel path (slow, elegant cadence)

interface FlowPlan {
  nodeDelay: Partial<Record<Role, number>>;
  conn: Record<number, { dir: "ltr" | "rtl"; delay: number }>;
  color: string;
  id: number;
}

// Turns the in-flight segment into a per-node / per-connector delay map so the light flows source ->
// connector -> destination (and back through intermediate nodes on a repair bounce). No measurement:
// every node lights its own border, the connectors light the gaps.
function planFlow(seg: FlowSegment | null): FlowPlan | null {
  if (!seg) return null;
  const fi = signalOrder.indexOf(seg.from);
  const ti = signalOrder.indexOf(seg.to);
  if (fi === -1 || ti === -1) return null;
  const color = seg.mode === "repair" ? "#f43f5e" : roleMeta[seg.from].color;
  const nodeDelay: Partial<Record<Role, number>> = {};
  const conn: Record<number, { dir: "ltr" | "rtl"; delay: number }> = {};
  let pos = 0;
  if (ti > fi) {
    for (let i = fi; i <= ti; i++) {
      nodeDelay[signalOrder[i]] = pos++ * STEP;
      if (i < ti) conn[i] = { dir: "ltr", delay: pos++ * STEP };
    }
  } else {
    for (let i = fi; i >= ti; i--) {
      nodeDelay[signalOrder[i]] = pos++ * STEP;
      if (i > ti) conn[i - 1] = { dir: "rtl", delay: pos++ * STEP };
    }
  }
  return { nodeDelay, conn, color, id: seg.id };
}

function Connector({ plan, index }: { plan: FlowPlan | null; index: number }) {
  const pulse = plan?.conn[index] ?? null;
  return (
    <div className="relative hidden w-8 shrink-0 items-center md:flex" aria-hidden>
      <div className="h-px w-full" style={{ background: "var(--line)" }} />
      {plan && pulse && (
        <span
          key={`${plan.id}-${index}`}
          className={`flow-pulse absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full run-${pulse.dir}`}
          style={{
            background: plan.color,
            boxShadow: `0 0 10px 2px ${plan.color}`,
            animationDelay: `${pulse.delay}ms`,
            marginLeft: "-4px",
          } as CSSProperties}
        />
      )}
    </div>
  );
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
  const segment = useFlowState(room);
  const plan = planFlow(segment);

  const node = (role: Role) => {
    const delay = plan?.nodeDelay[role];
    const sweep = delay !== undefined;
    return (
      <AgentCard
        role={role}
        state={room.agents[role]}
        active={room.activeRole === role && !room.finished}
        sweep={sweep}
        sweepKey={plan ? plan.id : 0}
        flowColor={plan?.color ?? "#fff"}
        flowDelay={delay ?? 0}
        selected={focus === role}
        onSelect={() => onFocus(role)}
      />
    );
  };

  return (
    <div>
      {/* md+: stations on one signal path, interleaved with connectors that light on handoff */}
      <div className="hidden items-stretch md:flex">
        {signalOrder.map((role, i) => (
          <Fragment key={role}>
            <div className="flex-1">{node(role)}</div>
            {i < signalOrder.length - 1 && <Connector plan={plan} index={i} />}
          </Fragment>
        ))}
      </div>

      {/* mobile: 2-col grid, no connectors */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        {signalOrder.map((role) => (
          <Fragment key={role}>{node(role)}</Fragment>
        ))}
      </div>
    </div>
  );
}
