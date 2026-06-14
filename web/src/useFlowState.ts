import { useEffect, useRef, useState } from "react";
import type { RoomState, Role } from "./types";
import { signalOrder } from "./theme";

export type FlowMode = "forward" | "repair";

export interface FlowSegment {
  from: Role;
  to: Role;
  mode: FlowMode;
  /** Monotonically increasing - retriggers the SVG animation on each new segment. */
  id: number;
}

/**
 * Derives the latest in-flight segment from the replay room state.
 *
 * Direction is inferred by comparing signalOrder indices: a decreasing index
 * jump (e.g. repairer->coder) is a repair bounce; increasing is forward flow.
 * The event stream has no explicit {from, to} edge - activeRole is last-writer-wins.
 *
 * Returns null before the first transition and when finished.
 */
export function useFlowState(room: RoomState): FlowSegment | null {
  const [segment, setSegment] = useState<FlowSegment | null>(null);
  const prevRef = useRef<Role | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const next = room.finished ? null : room.activeRole;
    const prev = prevRef.current;
    if (next === prev) return;
    prevRef.current = next;

    // Only emit when transitioning between two concrete agent roles.
    // conductor never updates activeRole so it won't appear here, but guard anyway.
    if (
      prev !== null &&
      next !== null &&
      prev !== "conductor" &&
      next !== "conductor"
    ) {
      const fromIdx = signalOrder.indexOf(prev);
      const toIdx = signalOrder.indexOf(next);
      if (fromIdx !== -1 && toIdx !== -1) {
        const mode: FlowMode = toIdx < fromIdx ? "repair" : "forward";
        setSegment({ from: prev, to: next, mode, id: ++idRef.current });
      }
    }
  }, [room.activeRole, room.finished]);

  return segment;
}
