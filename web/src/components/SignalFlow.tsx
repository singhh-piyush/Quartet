import { useEffect, useMemo, useRef } from "react";
import { roleMeta, signalOrder } from "../theme";
import type { FlowSegment } from "../useFlowState";
import type { CardRect } from "../useCardRects";
import type { Role } from "../types";

// The handoff animation is integrated into the cards themselves: a glowing current enters the source
// card and runs ALONG its border, merges into the connector line in the gap, then runs along the next
// card's border - lighting up part of each shape as it flows through. Nothing flies around; the
// brightness travels through the existing outlines (composited with `screen` so it adds light over the
// real card borders on black). Forward flow runs across the tops in the source colour; a repair bounce
// runs across the bottoms in fail-red.
const RAD = 8; // card corner radius (matches rounded-lg)
const DASH = 96; // length of the bright flowing segment that travels the border path
const CORE_W = 2.25;
const GLOW_W = 9;
const DURATION = 1600;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const midY = (r: CardRect) => r.y + r.height / 2;

// Top border, left-middle -> over the top -> right-middle (left to right). `move` starts a new subpath.
function topArcLTR(r: CardRect, move: boolean): string {
  const { x, y, width: w, height: h } = r;
  const rad = Math.min(RAD, h / 2, w / 2);
  return (
    `${move ? "M" : "L"} ${x} ${y + h / 2} L ${x} ${y + rad} Q ${x} ${y} ${x + rad} ${y} ` +
    `L ${x + w - rad} ${y} Q ${x + w} ${y} ${x + w} ${y + rad} L ${x + w} ${y + h / 2}`
  );
}

// Bottom border, right-middle -> under the bottom -> left-middle (right to left), for the repair bounce.
function bottomArcRTL(r: CardRect, move: boolean): string {
  const { x, y, width: w, height: h } = r;
  const rad = Math.min(RAD, h / 2, w / 2);
  return (
    `${move ? "M" : "L"} ${x + w} ${y + h / 2} L ${x + w} ${y + h - rad} Q ${x + w} ${y + h} ${x + w - rad} ${y + h} ` +
    `L ${x + rad} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rad} L ${x} ${y + h / 2}`
  );
}

// Source border -> (connector, drawn implicitly by the junction line) -> destination border.
function segPath(seg: FlowSegment, rects: Record<Role, CardRect>): string {
  const fr = rects[seg.from];
  const tr = rects[seg.to];
  if (seg.mode === "forward") return `${topArcLTR(fr, true)} ${topArcLTR(tr, false)}`;
  return `${bottomArcRTL(fr, true)} ${bottomArcRTL(tr, false)}`;
}

function pulseColor(seg: FlowSegment): string {
  return seg.mode === "repair" ? "#f43f5e" : roleMeta[seg.from].color;
}

export interface SignalFlowProps {
  rects: Record<Role, CardRect> | null;
  containerWidth: number;
  containerHeight: number;
  segment: FlowSegment | null;
  verdict: "pass" | "fail" | null;
  finished: boolean;
}

export function SignalFlow({ rects, containerWidth, containerHeight, segment, verdict, finished }: SignalFlowProps) {
  const coreRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const raf = useRef<number>(0);

  // Dim always-on connectors in the gaps so the "line" between the shapes is always present; the
  // flow merges into these as it crosses from one card to the next.
  const rails = useMemo(() => {
    if (!rects) return [];
    const out: string[] = [];
    for (let i = 0; i < signalOrder.length - 1; i++) {
      const fr = rects[signalOrder[i]];
      const tr = rects[signalOrder[i + 1]];
      out.push(`M ${fr.x + fr.width} ${midY(fr)} L ${tr.x} ${midY(tr)}`);
    }
    return out;
  }, [rects]);

  const path = segment && rects ? segPath(segment, rects) : "";
  const color = segment ? pulseColor(segment) : "#fff";

  useEffect(() => {
    if (!segment || !coreRef.current || !glowRef.current) return;
    const core = coreRef.current;
    const glow = glowRef.current;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const total = core.getTotalLength();
    const arr = `${DASH} ${total + DASH}`;
    core.setAttribute("stroke-dasharray", arr);
    glow.setAttribute("stroke-dasharray", arr);

    let start = 0;
    function frame(ts: number) {
      if (!start) start = ts;
      const raw = Math.min((ts - start) / DURATION, 1);
      const t = easeInOut(raw);
      // slide the single bright dash from just before the path start to just past its end
      const offset = DASH - t * (total + DASH);
      core.setAttribute("stroke-dashoffset", String(offset));
      glow.setAttribute("stroke-dashoffset", String(offset));
      // gentle fade in/out at the very ends so it appears and clears smoothly
      const fade = raw < 0.1 ? raw / 0.1 : raw > 0.9 ? Math.max((1 - raw) / 0.1, 0) : 1;
      core.setAttribute("opacity", String(fade));
      glow.setAttribute("opacity", String(fade * 0.55));

      if (raw < 1) {
        raf.current = requestAnimationFrame(frame);
      } else {
        core.setAttribute("opacity", "0");
        glow.setAttribute("opacity", "0");
      }
    }
    raf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf.current);
      core.setAttribute("opacity", "0");
      glow.setAttribute("opacity", "0");
    };
  }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rects || containerWidth === 0) return null;
  const verdictColor = finished && verdict === "pass" ? "#34d399" : finished && verdict === "fail" ? "#f43f5e" : null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 hidden md:block"
      style={{ overflow: "visible", mixBlendMode: "screen" }}
      width={containerWidth}
      height={containerHeight}
      viewBox={`0 0 ${containerWidth} ${containerHeight}`}
      aria-hidden
    >
      <defs>
        <filter id="sf-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* dim always-on connectors in the gaps between cards */}
      {rails.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.25} />
      ))}

      {/* on a finished run, tint the connectors with the verdict colour */}
      {verdictColor &&
        rails.map((d, i) => (
          <path key={`v-${i}`} d={d} fill="none" stroke={verdictColor} strokeWidth={1.5} opacity={0.5} filter="url(#sf-glow)" />
        ))}

      {/* the flowing current: a soft aura and a bright core that travel along the border path */}
      {segment && (
        <path ref={glowRef} d={path} fill="none" stroke={color} strokeWidth={GLOW_W} strokeLinecap="round" filter="url(#sf-glow)" opacity={0} />
      )}
      {segment && (
        <path ref={coreRef} d={path} fill="none" stroke={color} strokeWidth={CORE_W} strokeLinecap="round" filter="url(#sf-glow)" opacity={0} />
      )}
    </svg>
  );
}
