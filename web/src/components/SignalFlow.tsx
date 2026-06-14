import { useEffect, useMemo, useRef } from "react";
import { roleMeta, signalOrder } from "../theme";
import type { FlowSegment } from "../useFlowState";
import type { CardRect } from "../useCardRects";
import type { Role } from "../types";

// Calm instrument signal: a dim always-on rail Spec -> Coder -> Tester -> Repairer, and on each
// handoff one soft glowing packet that eases along the segment leaving a short trail, while the
// source card edge dims and the destination edge lights. Forward flow uses the source colour; a
// repair bounce arcs back below the row in fail-red.
const TRAIL = 26;       // length of the bright comet dash (svg units)
const CORE_W = 2;       // bright core stroke width
const GLOW_W = 7;       // soft aura stroke width
const HEAD_R = 4;       // glowing packet radius
const ARC_DIP = 52;     // repair arc depth below the row
const DURATION = 1100;  // ms for one packet to travel a segment

// Ease in-out cubic: gentle start and stop so it reads as a transfer, not a streak.
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function segPath(seg: FlowSegment, rects: Record<Role, CardRect>): string {
  const fr = rects[seg.from];
  const tr = rects[seg.to];
  if (seg.mode === "forward") {
    return `M ${fr.x + fr.width} ${fr.y + fr.height / 2} L ${tr.x} ${tr.y + tr.height / 2}`;
  }
  const x0 = fr.x + fr.width / 2;
  const y0 = fr.y + fr.height;
  const x1 = tr.x + tr.width / 2;
  const y1 = tr.y + tr.height;
  return `M ${x0} ${y0} C ${x0} ${y0 + ARC_DIP}, ${x1} ${y1 + ARC_DIP}, ${x1} ${y1}`;
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
  const headRef = useRef<SVGCircleElement>(null);
  const srcRef = useRef<SVGRectElement>(null);
  const dstRef = useRef<SVGRectElement>(null);
  const raf = useRef<number>(0);

  const rails = useMemo(() => {
    if (!rects) return [];
    const out: string[] = [];
    for (let i = 0; i < signalOrder.length - 1; i++) {
      const fr = rects[signalOrder[i]];
      const tr = rects[signalOrder[i + 1]];
      out.push(`M ${fr.x + fr.width} ${fr.y + fr.height / 2} L ${tr.x} ${tr.y + tr.height / 2}`);
    }
    return out;
  }, [rects]);

  const path = segment && rects ? segPath(segment, rects) : "";
  const color = segment ? pulseColor(segment) : "#fff";
  const dstColor = segment ? roleMeta[segment.to].color : "#fff";
  const srcRect = segment && rects ? rects[segment.from] : null;
  const dstRect = segment && rects ? rects[segment.to] : null;

  useEffect(() => {
    if (!segment || !coreRef.current || !glowRef.current || !headRef.current) return;
    const core = coreRef.current;
    const glow = glowRef.current;
    const head = headRef.current;
    const src = srcRef.current;
    const dst = dstRef.current;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (dst) dst.setAttribute("opacity", "0.5");
      return;
    }

    const total = core.getTotalLength();
    const dash = `${TRAIL} ${total + TRAIL}`;
    core.setAttribute("stroke-dasharray", dash);
    glow.setAttribute("stroke-dasharray", dash);

    let start = 0;
    function frame(ts: number) {
      if (!start) start = ts;
      const raw = Math.min((ts - start) / DURATION, 1);
      const t = easeInOut(raw);
      const offset = TRAIL - t * total;
      core.setAttribute("stroke-dashoffset", String(offset));
      glow.setAttribute("stroke-dashoffset", String(offset));

      const pt = core.getPointAtLength(Math.min(t * total, total - 0.5));
      head.setAttribute("cx", String(pt.x));
      head.setAttribute("cy", String(pt.y));

      const fade = raw < 0.08 ? raw / 0.08 : raw > 0.92 ? (1 - raw) / 0.08 : 1;
      core.setAttribute("opacity", String(fade));
      glow.setAttribute("opacity", String(fade * 0.5));
      head.setAttribute("opacity", String(fade));
      if (src) src.setAttribute("opacity", String((1 - t) * 0.55));
      if (dst) dst.setAttribute("opacity", String(t * 0.6));

      if (raw < 1) {
        raf.current = requestAnimationFrame(frame);
      } else {
        core.setAttribute("opacity", "0");
        glow.setAttribute("opacity", "0");
        head.setAttribute("opacity", "0");
        if (src) src.setAttribute("opacity", "0");
        if (dst) dst.setAttribute("opacity", "0.4");
      }
    }
    raf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf.current);
      for (const el of [core, glow, head, src, dst]) el?.setAttribute("opacity", "0");
    };
  }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rects || containerWidth === 0) return null;
  const verdictColor = finished && verdict === "pass" ? "#34d399" : finished && verdict === "fail" ? "#f43f5e" : null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 hidden md:block"
      style={{ overflow: "visible" }}
      width={containerWidth}
      height={containerHeight}
      viewBox={`0 0 ${containerWidth} ${containerHeight}`}
      aria-hidden
    >
      <defs>
        <filter id="sf-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {rails.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      ))}

      {verdictColor &&
        rails.map((d, i) => (
          <path key={`v-${i}`} d={d} fill="none" stroke={verdictColor} strokeWidth={1.5} opacity={0.32} filter="url(#sf-glow)" />
        ))}

      {segment && srcRect && (
        <rect ref={srcRef} x={srcRect.x} y={srcRect.y} width={srcRect.width} height={srcRect.height} rx={9} ry={9} fill="none" stroke={color} strokeWidth={1.5} filter="url(#sf-glow)" opacity={0} />
      )}
      {segment && dstRect && (
        <rect ref={dstRef} x={dstRect.x} y={dstRect.y} width={dstRect.width} height={dstRect.height} rx={9} ry={9} fill="none" stroke={dstColor} strokeWidth={1.5} filter="url(#sf-glow)" opacity={0} />
      )}

      {segment && (
        <path ref={glowRef} d={path} fill="none" stroke={color} strokeWidth={GLOW_W} strokeLinecap="round" filter="url(#sf-glow)" opacity={0} />
      )}
      {segment && (
        <path ref={coreRef} d={path} fill="none" stroke={color} strokeWidth={CORE_W} strokeLinecap="round" opacity={0} />
      )}
      {segment && <circle ref={headRef} r={HEAD_R} fill={color} filter="url(#sf-glow)" opacity={0} />}
    </svg>
  );
}
