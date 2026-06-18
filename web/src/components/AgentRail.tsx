import { Fragment, useEffect, useRef, useState } from "react";
import { roleMeta, signalOrder } from "../theme";
import type { RoomState, Role } from "../types";
import { useFlowState, type FlowSegment } from "../useFlowState";
import { AgentCard } from "./AgentCard";

const FAIL = "#f43f5e";
const CROSS_MS = 680; // time to fill one connector gap

type Phase = "idle" | "rest" | "cross";
interface Step {
  conn: number; // connector index crossed (between signalOrder[i] and [i+1])
  dir: 1 | -1; // 1 = forward (left->right), -1 = repair bounce (right->left)
  from: Role; // card on the source side of this connector
  next: Role; // card on the destination side
}
interface Light {
  phase: Phase;
  card: Role | null; // the card the glow currently rests on
  repair: boolean;
  steps: Step[]; // remaining connector hops of the active segment
  conn: number; // connector being filled now
  crossStart: number;
  lastTs: number;
  queue: FlowSegment[];
  want: { activeRole: Role | null; finished: boolean };
  shownCurrent: Role | null;
}

function newLight(): Light {
  return {
    phase: "idle",
    card: null,
    repair: false,
    steps: [],
    conn: 0,
    crossStart: 0,
    lastTs: 0,
    queue: [],
    want: { activeRole: null, finished: false },
    shownCurrent: null,
  };
}

// expand a from->to segment into adjacent single connector hops (so a multi-hop repair flows through the gaps)
function pathSteps(from: Role, to: Role): Step[] {
  const fi = signalOrder.indexOf(from);
  const ti = signalOrder.indexOf(to);
  const out: Step[] = [];
  if (ti >= fi) {
    for (let i = fi; i < ti; i++) out.push({ conn: i, dir: 1, from: signalOrder[i], next: signalOrder[i + 1] });
  } else {
    for (let i = fi; i > ti; i--) out.push({ conn: i - 1, dir: -1, from: signalOrder[i], next: signalOrder[i - 1] });
  }
  return out;
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
  const ringRefs = useRef<Partial<Record<Role, HTMLSpanElement | null>>>({});
  const connRefs = useRef<Record<number, HTMLSpanElement | null>>({});
  // stable ref callbacks (one per role/index) so React does not detach/attach the conductor-owned elements
  const ringRefCbs = useRef<Partial<Record<Role, (el: HTMLSpanElement | null) => void>>>({});
  const getRingRef = (role: Role) =>
    (ringRefCbs.current[role] ??= (el: HTMLSpanElement | null) => {
      ringRefs.current[role] = el;
    });
  const connRefCbs = useRef<Record<number, (el: HTMLSpanElement | null) => void>>({});
  const getConnRef = (i: number) =>
    (connRefCbs.current[i] ??= (el: HTMLSpanElement | null) => {
      connRefs.current[i] = el;
    });
  const light = useRef<Light>(newLight());
  const [currentRole, setCurrentRole] = useState<Role | null>(null);

  const segment = useFlowState(room);
  const lastSeg = useRef(0);

  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // imperative writers (touch only refs)
  const ringColor = (r: Role, c: string) => ringRefs.current[r]?.style.setProperty("--flow-color", c);
  const ringOp = (r: Role, o: number) => {
    const e = ringRefs.current[r];
    if (e) e.style.opacity = String(o);
  };
  const connProg = (i: number, t: number) => connRefs.current[i]?.style.setProperty("--progress", String(t));
  const connOp = (i: number, o: number) => {
    const e = connRefs.current[i];
    if (e) e.style.opacity = String(o);
  };
  const connMeta = (i: number, dir: 1 | -1, pf: string, pt: string) => {
    const e = connRefs.current[i];
    if (!e) return;
    e.dataset.dir = dir === 1 ? "fwd" : "rev";
    e.style.setProperty("--pf", pf);
    e.style.setProperty("--pt", pt);
  };
  const clearAll = () => {
    for (const r of signalOrder) ringOp(r, 0);
    for (let i = 0; i < signalOrder.length - 1; i++) connOp(i, 0);
  };

  // feed each new segment into the conductor's queue
  useEffect(() => {
    if (segment && segment.id !== lastSeg.current) {
      lastSeg.current = segment.id;
      light.current.queue.push(segment);
    }
  }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the conductor's desired state fresh (read inside the rAF loop)
  useEffect(() => {
    light.current.want = { activeRole: room.activeRole, finished: room.finished };
  }, [room.activeRole, room.finished]);

  // reduced motion: no rAF - just show a static halo on the active card
  useEffect(() => {
    if (!reduced) return;
    for (const r of signalOrder) {
      ringColor(r, roleMeta[r].color);
      ringOp(r, r === room.activeRole && !room.finished ? 1 : 0);
    }
    for (let i = 0; i < signalOrder.length - 1; i++) connOp(i, 0);
    setCurrentRole(!room.finished ? room.activeRole : null);
  }, [room.activeRole, room.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // the conductor: the glow rests (the CSS arc circles the card's border ring) on the current card; a handoff
  // fades it out, fills the connector(s) across, and fades the destination ring in. The only per-frame work
  // here is the connector fill - the ring's circling is pure CSS.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const L = light.current;

    const pushCurrent = (r: Role | null) => {
      if (r !== L.shownCurrent) {
        L.shownCurrent = r;
        setCurrentRole(r);
      }
    };
    const snapTo = (r: Role) => {
      clearAll();
      L.card = r;
      L.phase = "rest";
      L.steps = [];
      ringColor(r, roleMeta[r].color);
      ringOp(r, 1);
    };
    const startCross = (step: Step, ts: number) => {
      L.phase = "cross";
      L.conn = step.conn;
      L.crossStart = ts;
      const pf = L.repair ? FAIL : roleMeta[step.from].color;
      const pt = L.repair ? FAIL : roleMeta[step.next].color;
      connMeta(step.conn, step.dir, pf, pt);
      connProg(step.conn, 0);
      connOp(step.conn, 1);
    };
    const beginSegment = (seg: FlowSegment, ts: number) => {
      L.repair = seg.mode === "repair";
      if (L.card !== seg.from) snapTo(seg.from);
      L.steps = pathSteps(seg.from, seg.to);
      if (L.steps.length === 0) return;
      ringOp(seg.from, 0); // the working glow leaves the source card
      startCross(L.steps[0], ts);
    };
    const land = (ts: number) => {
      const step = L.steps[0];
      connOp(step.conn, 0); // the filled connector fades out
      L.steps.shift();
      L.card = step.next;
      if (L.steps.length > 0) {
        startCross(L.steps[0], ts); // intermediate gap of a multi-hop bounce - keep flowing, no card glow
      } else {
        ringColor(step.next, roleMeta[step.next].color); // settle to the agent's own colour
        ringOp(step.next, 1); // destination glow fades in
        L.phase = "rest";
        pushCurrent(step.next);
      }
    };

    const tick = (ts: number) => {
      L.lastTs = ts;
      const { activeRole, finished } = L.want;

      if (finished || !activeRole) {
        if (L.phase !== "idle") {
          clearAll();
          L.phase = "idle";
          L.card = null;
          L.steps = [];
          L.queue = [];
        }
        pushCurrent(null);
        raf = requestAnimationFrame(tick);
        return;
      }
      if (L.phase === "idle" && activeRole !== "conductor") {
        snapTo(activeRole);
        pushCurrent(activeRole);
      }

      if (L.phase === "rest") {
        if (L.queue.length) beginSegment(L.queue.shift()!, ts);
      } else if (L.phase === "cross") {
        const t = Math.min((ts - L.crossStart) / CROSS_MS, 1);
        connProg(L.conn, t);
        if (t >= 1) land(ts);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (role: Role) => (
    <AgentCard
      role={role}
      state={room.agents[role]}
      current={currentRole === role && !room.finished}
      selected={focus === role}
      onSelect={() => onFocus(role)}
    />
  );

  return (
    <div>
      {/* md+: a thin glowing ring hugs each card's border; the current card's ring is on and a bright arc
          slowly circles it, and a handoff fades it across the connector to the next card */}
      <div className="hidden items-stretch md:flex">
        {signalOrder.map((role, i) => (
          <Fragment key={role}>
            <div className="relative flex-1">
              <span ref={getRingRef(role)} aria-hidden className="flow-ring" />
              {card(role)}
            </div>
            {i < signalOrder.length - 1 && (
              <div className="relative hidden w-8 shrink-0 items-center md:flex" aria-hidden>
                <div className="h-px w-full" style={{ background: "var(--line)" }} />
                <span ref={getConnRef(i)} className="flow-conn" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* mobile: 2-col grid, no glow/connectors */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        {signalOrder.map((role) => (
          <Fragment key={role}>{card(role)}</Fragment>
        ))}
      </div>
    </div>
  );
}
