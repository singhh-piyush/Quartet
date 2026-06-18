import { useEffect, useRef } from "react";
import { roleMeta, signalOrder } from "../theme";
import type { FlowSegment } from "../useFlowState";
import type { Role } from "../types";

// ONE travelling glow shows information moving between the squares. A single bright dash starts on the
// SOURCE card, runs along a proportion of its border, crosses the connector gap, and arrives on the
// DESTINATION card - the destination lights up exactly as the dash reaches it (onArrive), so the
// transfer and the ignite read as one continuous motion. The dash colour MORPHS from the source role
// colour to the destination role colour as it crosses (a linear gradient anchored card-centre to
// card-centre). Forward flow traces the TOP borders left-to-right; a repair bounce traces the BOTTOM
// borders right-to-left, tinted toward fail-red.
//
// Separately, while an agent is actively working its card border CIRCLES slowly (a continuous looping
// dash around that one card) to read as "thinking". Only one of these is ever in motion at a time.
//
// Rendering: a wide BLURRED glow layer (screen-blended) sits UNDER a crisp, UN-filtered core stroke that
// lands exactly on the 1px border, so the light visibly hugs the card outline instead of floating as fuzz.

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RAD = 8; // card corner radius (matches rounded-lg)
const DASH = 130; // length of the single bright travelling segment (the lit proportion of a border)
const DURATION = 3000; // slow and smooth
const LOOP = 2600; // one lap of the thinking circle
const CORE_W = 1.5; // crisp line that sits on the border
const GLOW_W = 9; // soft bloom underneath
const FAIL = "#f43f5e";

// Quintic smootherstep: very soft accel/decel, no hard start or stop.
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const midY = (r: CardRect) => r.y + r.height / 2;
const cx = (r: CardRect) => r.x + r.width / 2;
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Top border, continuing from the left-middle: up the left side, across the top, down to right-middle.
function topBody(r: CardRect): string {
  const { x, y, width: w, height: h } = r;
  const rad = Math.min(RAD, h / 2, w / 2);
  return ` L ${x} ${y + rad} Q ${x} ${y} ${x + rad} ${y} L ${x + w - rad} ${y} Q ${x + w} ${y} ${x + w} ${y + rad} L ${x + w} ${y + h / 2}`;
}

// Bottom border, continuing from the right-middle: down the right side, across the bottom, up to left-middle.
function bottomBody(r: CardRect): string {
  const { x, y, width: w, height: h } = r;
  const rad = Math.min(RAD, h / 2, w / 2);
  return ` L ${x + w} ${y + h - rad} Q ${x + w} ${y + h} ${x + w - rad} ${y + h} L ${x + rad} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rad} L ${x} ${y + h / 2}`;
}

// A full closed rounded rectangle around a card (clockwise from top-middle), for the thinking circle.
function roundedRectPath(r: CardRect): string {
  const { x, y, width: w, height: h } = r;
  const rad = Math.min(RAD, h / 2, w / 2);
  return (
    `M ${x + w / 2} ${y}` +
    ` L ${x + w - rad} ${y} Q ${x + w} ${y} ${x + w} ${y + rad}` +
    ` L ${x + w} ${y + h - rad} Q ${x + w} ${y + h} ${x + w - rad} ${y + h}` +
    ` L ${x + rad} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rad}` +
    ` L ${x} ${y + rad} Q ${x} ${y} ${x + rad} ${y} Z`
  );
}

// One continuous path from the source card to the destination card (through any cards in between),
// hugging their real borders and bridging the gaps with the connector line. `dEntry` is the same path
// truncated at the destination's entry point, so we can fire onArrive exactly when the dash head lands.
function buildTransfer(seg: FlowSegment, rects: Record<Role, CardRect>): { d: string; dEntry: string } {
  const fi = signalOrder.indexOf(seg.from);
  const ti = signalOrder.indexOf(seg.to);
  if (fi === -1 || ti === -1) return { d: "", dEntry: "" };

  if (ti >= fi) {
    // forward: ascending order along the TOP borders, left to right
    const f = rects[signalOrder[fi]];
    const start = `M ${f.x} ${midY(f)}`;
    let d = start;
    let dEntry = start;
    for (let i = fi; i <= ti; i++) {
      const body = topBody(rects[signalOrder[i]]);
      if (i < ti) {
        const n = rects[signalOrder[i + 1]];
        const conn = ` L ${n.x} ${midY(n)}`;
        d += body + conn;
        dEntry += body + conn; // entry path stops just before the destination's own border
      } else {
        d += body;
      }
    }
    return { d, dEntry };
  }

  // repair bounce: descending order along the BOTTOM borders, right to left
  const f = rects[signalOrder[fi]];
  const start = `M ${f.x + f.width} ${midY(f)}`;
  let d = start;
  let dEntry = start;
  for (let i = fi; i >= ti; i--) {
    const body = bottomBody(rects[signalOrder[i]]);
    if (i > ti) {
      const n = rects[signalOrder[i - 1]];
      const conn = ` L ${n.x + n.width} ${midY(n)}`;
      d += body + conn;
      dEntry += body + conn;
    } else {
      d += body;
    }
  }
  return { d, dEntry };
}

export interface SignalFlowProps {
  rects: Record<Role, CardRect> | null;
  containerWidth: number;
  containerHeight: number;
  transfer: FlowSegment | null;
  thinkingRole: Role | null;
  onArrive: (role: Role) => void;
  onComplete: (id: number) => void;
}

export function SignalFlow({
  rects,
  containerWidth,
  containerHeight,
  transfer,
  thinkingRole,
  onArrive,
  onComplete,
}: SignalFlowProps) {
  // transfer comet layers
  const coreRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const entryRef = useRef<SVGPathElement>(null);
  const tRaf = useRef<number>(0);
  // thinking circle layers
  const ringCoreRef = useRef<SVGPathElement>(null);
  const ringGlowRef = useRef<SVGPathElement>(null);
  const cRaf = useRef<number>(0);

  const tPath = transfer && rects ? buildTransfer(transfer, rects) : null;
  const fromColor = transfer
    ? transfer.mode === "repair"
      ? FAIL
      : roleMeta[transfer.from].color
    : "#fff";
  const toColor = transfer ? roleMeta[transfer.to].color : "#fff";

  const ringRole = thinkingRole && rects ? thinkingRole : null;
  const ringPath = ringRole && rects ? roundedRectPath(rects[ringRole]) : "";
  const ringColor = ringRole ? roleMeta[ringRole].color : "#fff";

  // gradient anchors: source card centre -> destination card centre
  const g =
    transfer && rects
      ? { x1: cx(rects[transfer.from]), y1: midY(rects[transfer.from]), x2: cx(rects[transfer.to]), y2: midY(rects[transfer.to]) }
      : { x1: 0, y1: 0, x2: 0, y2: 0 };

  // --- transfer comet: one eased pass; ignites the destination as the head crosses its entry ---
  useEffect(() => {
    if (!transfer || !tPath || !tPath.d) return;
    const core = coreRef.current;
    const glow = glowRef.current;
    if (!core || !glow) return;

    if (reduced()) {
      // no motion: still advance state so the destination lights and the run can proceed
      onArrive(transfer.to);
      onComplete(transfer.id);
      return;
    }

    const total = core.getTotalLength();
    const entryLen = entryRef.current ? entryRef.current.getTotalLength() : total * 0.6;
    const arr = `${DASH} ${total + DASH}`; // exactly one visible dash
    core.setAttribute("stroke-dasharray", arr);
    glow.setAttribute("stroke-dasharray", arr);

    let start = 0;
    let arrived = false;
    const frame = (ts: number) => {
      if (!start) start = ts;
      const raw = Math.min((ts - start) / DURATION, 1);
      const e = smoother(raw);
      const head = e * (total + DASH); // leading edge distance along the path
      const offset = DASH - head;
      core.setAttribute("stroke-dashoffset", String(offset));
      glow.setAttribute("stroke-dashoffset", String(offset));
      const fade = raw < 0.1 ? raw / 0.1 : raw > 0.9 ? Math.max((1 - raw) / 0.1, 0) : 1;
      core.setAttribute("opacity", String(fade));
      glow.setAttribute("opacity", String(fade * 0.55));
      if (!arrived && head >= entryLen) {
        arrived = true;
        onArrive(transfer.to);
      }
      if (raw < 1) {
        tRaf.current = requestAnimationFrame(frame);
      } else {
        core.setAttribute("opacity", "0");
        glow.setAttribute("opacity", "0");
        if (!arrived) onArrive(transfer.to);
        onComplete(transfer.id);
      }
    };
    tRaf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(tRaf.current);
      core.setAttribute("opacity", "0");
      glow.setAttribute("opacity", "0");
    };
  }, [transfer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- thinking circle: a slow continuous dash looping the working card's border ---
  useEffect(() => {
    if (!ringRole || !ringPath) return;
    const core = ringCoreRef.current;
    const glow = ringGlowRef.current;
    if (!core || !glow) return;
    if (reduced()) {
      core.setAttribute("opacity", "0.5");
      glow.setAttribute("opacity", "0.3");
      return;
    }
    const total = core.getTotalLength();
    const seg = Math.min(total * 0.32, 170);
    const arr = `${seg} ${total}`;
    core.setAttribute("stroke-dasharray", arr);
    glow.setAttribute("stroke-dasharray", arr);
    core.setAttribute("opacity", "1");
    glow.setAttribute("opacity", "0.5");
    let start = 0;
    const frame = (ts: number) => {
      if (!start) start = ts;
      const p = (((ts - start) % LOOP) / LOOP);
      const offset = -p * total; // travel clockwise around the card
      core.setAttribute("stroke-dashoffset", String(offset));
      glow.setAttribute("stroke-dashoffset", String(offset));
      cRaf.current = requestAnimationFrame(frame);
    };
    cRaf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(cRaf.current);
      core.setAttribute("opacity", "0");
      glow.setAttribute("opacity", "0");
    };
  }, [ringRole, ringPath]);

  if (!rects || containerWidth === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 hidden md:block"
      style={{ overflow: "visible" }}
      width={containerWidth}
      height={containerHeight}
      viewBox={`0 0 ${containerWidth} ${containerHeight}`}
      aria-hidden
    >
      <defs>
        <filter id="sf-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
        <linearGradient id="sf-grad" gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
          <stop offset="0%" stopColor={fromColor} />
          <stop offset="100%" stopColor={toColor} />
        </linearGradient>
      </defs>

      {/* thinking circle (under the comet) */}
      {ringRole && (
        <>
          <path
            ref={ringGlowRef}
            d={ringPath}
            fill="none"
            stroke={ringColor}
            strokeWidth={GLOW_W}
            strokeLinecap="round"
            filter="url(#sf-glow)"
            style={{ mixBlendMode: "screen" }}
            opacity={0}
          />
          <path ref={ringCoreRef} d={ringPath} fill="none" stroke={ringColor} strokeWidth={CORE_W} strokeLinecap="round" opacity={0} />
        </>
      )}

      {/* transfer comet: hidden entry path (measurement only) + blurred glow + crisp core */}
      {transfer && tPath && (
        <>
          <path ref={entryRef} d={tPath.dEntry} fill="none" stroke="none" opacity={0} />
          <path
            ref={glowRef}
            d={tPath.d}
            fill="none"
            stroke="url(#sf-grad)"
            strokeWidth={GLOW_W}
            strokeLinecap="round"
            filter="url(#sf-glow)"
            style={{ mixBlendMode: "screen" }}
            opacity={0}
          />
          <path ref={coreRef} d={tPath.d} fill="none" stroke="url(#sf-grad)" strokeWidth={CORE_W} strokeLinecap="round" opacity={0} />
        </>
      )}
    </svg>
  );
}
