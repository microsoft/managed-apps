import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Edge auto-scroll for a scrollable drop region during a pointer drag.
 *
 * The Engineers and Backlog regions each scroll independently, so a card picked
 * up in one region must still be droppable on a target that is currently out of
 * view. The browser only auto-scrolls the document, never an
 * inner `overflow-y-auto` container — so we do it ourselves: while the pointer
 * is within EDGE px of a region's top/bottom edge, scroll that region (speed
 * ramps with how deep into the edge zone the pointer is).
 *
 * Pointer movement stops firing when the pointer is held still, so scrolling runs on
 * a requestAnimationFrame loop driven by the last measured velocity rather than
 * off the events themselves. The loop stops at the scroll bounds and on
 * pointer-up/leave/unmount, so it can never keep running after a drag.
 */
export function useDragAutoScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const velocity = useRef(0);
  const frame = useRef<number | null>(null);

  const stop = useCallback(() => {
    velocity.current = 0;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const step = useCallback(() => {
    const el = ref.current;
    if (!el || velocity.current === 0) {
      frame.current = null;
      return;
    }
    const before = el.scrollTop;
    el.scrollTop = before + velocity.current;
    // Hit the top/bottom bound — nothing more to scroll, so idle the loop.
    if (el.scrollTop === before) {
      frame.current = null;
      velocity.current = 0;
      return;
    }
    frame.current = requestAnimationFrame(step);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el || e.buttons !== 1) {
        stop();
        return;
      }
      const EDGE = 56; // px of hot zone at each edge
      const MAX = 16; // px per frame at the very edge
      const rect = el.getBoundingClientRect();
      const fromTop = e.clientY - rect.top;
      const fromBottom = rect.bottom - e.clientY;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

      let v = 0;
      if (fromTop >= 0 && fromTop < EDGE && !atTop) {
        v = -Math.ceil(((EDGE - fromTop) / EDGE) * MAX);
      } else if (fromBottom >= 0 && fromBottom < EDGE && !atBottom) {
        v = Math.ceil(((EDGE - fromBottom) / EDGE) * MAX);
      }
      velocity.current = v;
      if (v !== 0 && frame.current === null) {
        frame.current = requestAnimationFrame(step);
      } else if (v === 0) {
        stop();
      }
    },
    [step, stop],
  );

  useEffect(() => stop, [stop]);

  return {
    ref,
    stop,
    handlers: {
      onPointerMove,
      onPointerLeave: stop,
    },
  };
}
