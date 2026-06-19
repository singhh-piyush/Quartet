import { Fragment, useRef, type CSSProperties } from "react";
import { useAnimationFrame, useReducedMotion } from "framer-motion";
import { roleMeta, signalOrder } from "../theme";
import type { Role } from "../types";

// Landing hero node graph: the four agents wired left to right, with ONE continuous travelling light that
// loops forever. It reuses the in-app flow visual exactly (`.flow-ring` = each node's own glowing border,
// `.flow-conn` = the blob that crosses a gap) and the same rest -> exit -> cross -> land model used by
// AgentRail, but here a self-contained conductor generates the cycle itself (no room state):
//   spec -> coder -> tester -> (bounce) coder -> repairer -> (return) spec -> loop.
// The conductor is duplicated compactly on purpose so AgentRail's event-driven logic stays untouched.
// Framer Motion drives the per-frame clock (`useAnimationFrame`); we only write CSS vars, never measure DOM.

const FAIL = "#f43f5e";
const CROSS_MS = 620; // time the light takes to cross one connector gap
const EXIT_MS = 220; // time the arc sweeps to the connector-facing edge before it crosses
const REST_MS = 460; // dwell-circle on a card before the next hop launches
const SPIN_MS = 4200; // period of one full revolution while the arc rests on a card
const SPIN_RATE = 360 / SPIN_MS; // deg per ms
const ARC_PEAK = 70; // offset of the conic arc's bright centre from --angle (matches the gradient in index.css)
const RIGHT = 90; // conic angle (from top, clockwise) of a card's right-edge midpoint
const LEFT = 270; // conic angle of a card's left-edge midpoint
const cwDelta = (from: number, to: number) => (((to - from) % 360) + 360) % 360;

type Kind = "forward" | "repair";
interface Seg {
  from: Role;
  to: Role;
  kind: Kind;
}

// One full loop. The forward journey is the user's spec->coder->tester->(bounce)->coder->repairer; the final
// repairer->spec leg sweeps the light back to the start so the loop never breaks.
const CYCLE: Seg[] = [
  { from: "spec", to: "coder", kind: "forward" },
  { from: "coder", to: "tester", kind: "forward" },
  { from: "tester", to: "coder", kind: "repair" }, // the repair bounce, carried in fail-red
  { from: "coder", to: "repairer", kind: "forward" }, // travels rightward through tester
  { from: "repairer", to: "spec", kind: "forward" }, // return leg, travels back through tester + coder
];

interface Step {
  conn: number; // connector index crossed (between signalOrder[i] and [i+1])
  dir: 1 | -1; // 1 = left->right, -1 = right->left
  from: Role; // card on the source side of this connector
  next: Role; // card on the destination side
}

// expand a from->to segment into adjacent single connector hops (so a multi-card leg flows through each gap)
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

interface Light {
  init: boolean;
  phase: "rest" | "exit" | "cross";
  card: Role;
  kind: Kind;
  steps: Step[];
  segIdx: number;
  conn: number;
  crossStart: number;
  angle: number;
  exitFrom: number;
  exitDelta: number;
  exitStart: number;
  restUntil: number;
}

function newLight(): Light {
  return {
    init: false,
    phase: "rest",
    card: "spec",
    kind: "forward",
    steps: [],
    segIdx: 0,
    conn: 0,
    crossStart: 0,
    angle: 0,
    exitFrom: 0,
    exitDelta: 0,
    exitStart: 0,
    restUntil: 0,
  };
}

export function BandFlow() {
  const ringRefs = useRef<Partial<Record<Role, HTMLSpanElement | null>>>({});
  const connRefs = useRef<Record<number, HTMLSpanElement | null>>({});
  // stable ref callbacks (one per role/index) so React never detaches the conductor-owned elements
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

  const L = useRef<Light>(newLight());
  const reduced = useReducedMotion();

  // imperative writers (touch only refs / inline style, never React state)
  const color = (r: Role) => roleMeta[r].color;
  const ringColor = (r: Role, c: string) => ringRefs.current[r]?.style.setProperty("--flow-color", c);
  const ringAngle = (r: Role, a: number) => ringRefs.current[r]?.style.setProperty("--angle", `${a}deg`);
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

  const snapTo = (r: Role) => {
    clearAll();
    L.current.card = r;
    L.current.phase = "rest";
    L.current.steps = [];
    ringColor(r, color(r));
    ringAngle(r, L.current.angle);
    ringOp(r, 1);
  };
  const startExit = (step: Step, ts: number) => {
    const l = L.current;
    l.phase = "exit";
    const target = (step.dir === 1 ? RIGHT : LEFT) - ARC_PEAK; // --angle that puts the bright peak on the edge
    l.exitFrom = l.angle;
    l.exitDelta = cwDelta(l.angle, target);
    l.exitStart = ts;
  };
  const startCross = (step: Step, ts: number) => {
    const l = L.current;
    l.phase = "cross";
    l.conn = step.conn;
    l.crossStart = ts;
    const col = l.kind === "repair" ? FAIL : color(step.from);
    connMeta(step.conn, step.dir, col, col);
    connProg(step.conn, 0);
    connOp(step.conn, 1);
  };
  const beginSegment = (seg: Seg, ts: number) => {
    const l = L.current;
    l.kind = seg.kind;
    if (l.card !== seg.from) snapTo(seg.from);
    l.steps = pathSteps(seg.from, seg.to);
    if (!l.steps.length) {
      l.restUntil = ts + REST_MS;
      return;
    }
    ringColor(seg.from, seg.kind === "repair" ? FAIL : color(seg.from));
    ringOp(seg.from, 1);
    startExit(l.steps[0], ts);
  };
  const land = (ts: number) => {
    const l = L.current;
    const step = l.steps.shift()!;
    connOp(step.conn, 0); // the travelling blob fades as the destination ring takes over
    l.card = step.next;
    const finalHop = l.steps.length === 0;
    l.angle = (step.dir === 1 ? LEFT : RIGHT) - ARC_PEAK; // resume on the edge the light arrives at
    ringColor(step.next, !finalHop && l.kind === "repair" ? FAIL : color(step.next));
    ringAngle(step.next, l.angle);
    ringOp(step.next, 1);
    if (finalHop) {
      l.phase = "rest";
      l.restUntil = ts + REST_MS;
    } else {
      startExit(l.steps[0], ts); // multi-hop leg: sweep straight on toward the next gap
    }
  };

  useAnimationFrame((ts, delta) => {
    if (reduced) return; // static resting glow only; the loop is off
    const l = L.current;
    const dt = Math.min(delta, 50); // clamp so a backgrounded tab does not jump the arc

    if (!l.init) {
      l.init = true;
      snapTo("spec");
      l.restUntil = ts + 500;
    }

    if (l.phase === "rest") {
      l.angle = (l.angle + SPIN_RATE * dt) % 360;
      ringAngle(l.card, l.angle);
      if (ts >= l.restUntil) {
        const seg = CYCLE[l.segIdx];
        l.segIdx = (l.segIdx + 1) % CYCLE.length;
        beginSegment(seg, ts);
      }
    } else if (l.phase === "exit") {
      const t = Math.min((ts - l.exitStart) / EXIT_MS, 1);
      l.angle = l.exitFrom + l.exitDelta * t;
      ringAngle(l.card, l.angle);
      if (t >= 1) {
        ringOp(l.card, 0); // arc has reached the edge: hand off to the connector blob
        startCross(l.steps[0], ts);
      }
    } else if (l.phase === "cross") {
      const t = Math.min((ts - l.crossStart) / CROSS_MS, 1);
      connProg(l.conn, t);
      if (t >= 1) land(ts);
    }
  });

  return (
    <div>
      {/* md+: the horizontal flow with the travelling light hugging each node's border */}
      <div className="hidden items-stretch md:flex">
        {signalOrder.map((role, i) => (
          <Fragment key={role}>
            <div className="relative flex-1">
              <span ref={getRingRef(role)} aria-hidden className="flow-ring" />
              <Node role={role} />
            </div>
            {i < signalOrder.length - 1 && (
              <div className="relative flex w-8 shrink-0 items-center" aria-hidden>
                <div className="h-px w-full" style={{ background: "var(--line)" }} />
                <span ref={getConnRef(i)} className="flow-conn" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* mobile: a 2x2 grid of nodes, no connectors and no travelling light (just the dim resting glow) */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        {signalOrder.map((role) => (
          <Node key={role} role={role} />
        ))}
      </div>
    </div>
  );
}

// One station: sharp 1px-bordered panel with the dim always-on role glow (`.station-glow`, fainter than the
// moving ring above it). Radius matches the in-app card so the reused `.flow-ring` stays concentric.
function Node({ role }: { role: Role }) {
  const m = roleMeta[role];
  return (
    <div
      className="station-glow flex h-full flex-col justify-center rounded-lg border bg-[var(--panel)] px-4 py-3"
      style={{ borderColor: `${m.color}55`, "--rest-color": m.color } as CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ background: m.color, boxShadow: `0 0 8px -1px ${m.color}` }}
        />
        <span className="font-display text-[15px] font-semibold leading-none" style={{ color: m.color }}>
          {m.label}
        </span>
      </div>
      <span className="mt-1.5 font-mono text-[11px] leading-tight text-[var(--text-3)]">{m.sub}</span>
    </div>
  );
}
