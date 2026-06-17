import { useEffect, useRef, useState } from "react";
import type { RefObject, MutableRefObject } from "react";
import type { Role } from "./types";
import { signalOrder } from "./theme";

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CardRectsState {
  rects: Record<Role, CardRect> | null;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Measures each agent card's position relative to the row container.
 * Re-measures on ResizeObserver (container size change) and window resize.
 *
 * Returns null until all four cards and the container are mounted.
 */
export function useCardRects(
  containerRef: RefObject<HTMLElement | null>,
  cardRefs: MutableRefObject<Partial<Record<Role, HTMLElement | null>>>,
): CardRectsState {
  const [state, setState] = useState<CardRectsState>({
    rects: null,
    containerWidth: 0,
    containerHeight: 0,
  });

  // Store the measure function in a ref so the closure inside
  // ResizeObserver always calls the latest version.
  const measureFnRef = useRef<() => void>(() => {});

  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      if (!container) return;
      const cb = container.getBoundingClientRect();
      const out: Partial<Record<Role, CardRect>> = {};
      for (const role of signalOrder) {
        const el = cardRefs.current[role];
        if (!el) return; // not yet mounted; ResizeObserver will retry
        const b = el.getBoundingClientRect();
        out[role] = {
          x: b.left - cb.left,
          y: b.top - cb.top,
          width: b.width,
          height: b.height,
        };
      }
      setState({
        rects: out as Record<Role, CardRect>,
        // Use the client box (what `absolute inset-0` fills) so 1 SVG unit == 1px with no viewBox
        // scaling. scrollWidth would diverge from the rendered SVG size under any overflow and shift
        // every drawn coordinate.
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
      });
    }

    measureFnRef.current = measure;
    measure();

    const container = containerRef.current;
    if (!container) return;

    // Stable wrapper so add/removeEventListener match the same reference
    const onResize = () => measureFnRef.current();

    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [containerRef, cardRefs]);

  return state;
}
