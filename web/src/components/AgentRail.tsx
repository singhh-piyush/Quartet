import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_PHASES, signalOrder } from "../theme";
import type { RoomState, Role } from "../types";
import { useFlowState } from "../useFlowState";
import { AgentCard } from "./AgentCard";
import { SignalFlow, type CardRect } from "./SignalFlow";

interface Measured {
  rects: Record<Role, CardRect> | null;
  width: number;
  height: number;
}

// Measure each card's real rounded-rect relative to the rail, so the single travelling glow hugs the
// actual borders (1 SVG unit == 1px, no viewBox scaling). Re-measures on resize, after web fonts load,
// and observes every card (not just the rail) so a late layout shift can never drift the path.
function useMeasure(
  railRef: React.RefObject<HTMLDivElement | null>,
  cardRefs: React.MutableRefObject<Partial<Record<Role, HTMLElement | null>>>,
): Measured {
  const [m, setM] = useState<Measured>({ rects: null, width: 0, height: 0 });
  const fn = useRef<() => void>(() => {});
  useEffect(() => {
    function measure() {
      const rail = railRef.current;
      if (!rail) return;
      const rb = rail.getBoundingClientRect();
      const out: Partial<Record<Role, CardRect>> = {};
      for (const role of signalOrder) {
        const el = cardRefs.current[role];
        if (!el) return; // not mounted yet; observers retry
        const b = el.getBoundingClientRect();
        out[role] = { x: b.left - rb.left, y: b.top - rb.top, width: b.width, height: b.height };
      }
      // fractional getBoundingClientRect (not integer clientWidth) keeps the SVG units pixel-exact
      setM({ rects: out as Record<Role, CardRect>, width: rb.width, height: rb.height });
    }
    fn.current = measure;
    measure();
    const rail = railRef.current;
    if (!rail) return;
    const onResize = () => fn.current();
    const ro = new ResizeObserver(onResize);
    ro.observe(rail);
    for (const role of signalOrder) {
      const el = cardRefs.current[role];
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", onResize);
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => fn.current());
    }
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [railRef, cardRefs]);
  return m;
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
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Partial<Record<Role, HTMLElement | null>>>({});
  const { rects, width, height } = useMeasure(railRef, cardRefs);

  // Raw room transition (forward vs repair) -> the comet currently in flight.
  const segment = useFlowState(room);
  // The card showing the steady "active" glow. It only moves to the destination when the comet ARRIVES,
  // so a card never lights before the handoff reaches it.
  const [litRole, setLitRole] = useState<Role | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<typeof segment>(null);

  // Start a comet on each new segment; keep litRole on the source until onArrive lands it on the dest.
  useEffect(() => {
    if (segment) setActiveTransfer(segment);
  }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // First activation (no previous role, e.g. conductor -> spec): ignite the first card directly, no comet.
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

  // Clear the comet when the run ends.
  useEffect(() => {
    if (room.finished) setActiveTransfer(null);
  }, [room.finished]);

  const onArrive = useCallback((r: Role) => setLitRole(r), []);
  const onComplete = useCallback((id: number) => {
    setActiveTransfer((cur) => (cur && cur.id === id ? null : cur));
  }, []);

  // The lit card circles ("thinking") only once the comet has fully landed (no transfer in flight) and
  // while that agent is actually working - so the comet and the circle are never both in motion.
  const litWorking =
    litRole !== null && !room.finished && ACTIVE_PHASES.has(room.agents[litRole].phase);
  const thinkingRole = !activeTransfer && litWorking ? litRole : null;

  const card = (role: Role, withRef: boolean) => (
    <AgentCard
      ref={
        withRef
          ? (el) => {
              cardRefs.current[role] = el;
            }
          : undefined
      }
      role={role}
      state={room.agents[role]}
      active={litRole === role && !room.finished}
      thinking={thinkingRole === role}
      selected={focus === role}
      onSelect={() => onFocus(role)}
    />
  );

  return (
    <div>
      {/* md+: stations on one signal path; a single travelling glow runs along their borders on handoff */}
      <div ref={railRef} className="relative hidden items-stretch md:flex">
        <SignalFlow
          rects={rects}
          containerWidth={width}
          containerHeight={height}
          transfer={activeTransfer}
          thinkingRole={thinkingRole}
          onArrive={onArrive}
          onComplete={onComplete}
        />
        {signalOrder.map((role, i) => (
          <Fragment key={role}>
            <div className="flex-1">{card(role, true)}</div>
            {i < signalOrder.length - 1 && (
              <div className="hidden w-8 shrink-0 items-center md:flex" aria-hidden>
                <div className="h-px w-full" style={{ background: "var(--line)" }} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* mobile: 2-col grid, no connectors or flow overlay */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        {signalOrder.map((role) => (
          <Fragment key={role}>{card(role, false)}</Fragment>
        ))}
      </div>
    </div>
  );
}
