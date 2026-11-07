import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from '../../lib/icons';
import { useWheelHorizontalScroll } from '../../lib/useWheelHorizontalScroll';

interface HorizontalScrollProps {
  children: ReactNode;
  className?: string;
}

const DRAG_THRESHOLD = 6;

export function HorizontalScroll({ children, className = '' }: HorizontalScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const wheelRef = useWheelHorizontalScroll();
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      wheelRef(node);
      if (node) {
        requestAnimationFrame(updateScrollButtons);
      }
    },
    [wheelRef, updateScrollButtons],
  );
  const dragStateRef = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateScrollButtons();
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateScrollButtons);
      document.body.style.removeProperty('user-select');
    };
  }, [updateScrollButtons]);

  const scrollByStep = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(260, el.clientWidth * 0.72), behavior: 'smooth' });
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = ref.current;
    if (!el) return;

    dragStateRef.current = {
      active: true,
      dragging: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
    document.body.style.userSelect = 'none';
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const drag = dragStateRef.current;
    if (!el || !drag.active || drag.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - drag.startX;
    if (!drag.dragging && Math.abs(deltaX) > DRAG_THRESHOLD) {
      drag.dragging = true;
      el.setPointerCapture(drag.pointerId);
    }

    if (!drag.dragging) return;
    el.scrollLeft = drag.startScrollLeft - deltaX;
    e.preventDefault();
  };

  const stopDragging = (pointerId: number) => {
    const el = ref.current;
    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== pointerId) return;

    if (el?.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);

    drag.active = false;
    window.setTimeout(() => {
      drag.dragging = false;
    }, 0);
    document.body.style.removeProperty('user-select');
  };

  return (
    <div className="relative group/hscroll">
      <div
        ref={setRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => stopDragging(e.pointerId)}
        onPointerCancel={(e) => stopDragging(e.pointerId)}
        onClickCapture={(e) => {
          if (dragStateRef.current.dragging) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={`flex gap-4 overflow-x-hidden pb-2 scrollbar-hide cursor-grab active:cursor-grabbing ${className}`}
        style={{
          contain: 'layout paint style',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>

      {canLeft && (
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          aria-label="Scroll left"
          className="liquid-pill absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-14 rounded-full flex items-center justify-center text-white/85 hover:text-white opacity-0 group-hover/hscroll:opacity-100 transition-opacity duration-200 cursor-pointer"
        >
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
      )}

      {canRight && (
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          aria-label="Scroll right"
          className="liquid-pill absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-14 rounded-full flex items-center justify-center text-white/90 hover:text-white opacity-90 group-hover/hscroll:opacity-100 transition-opacity duration-200 cursor-pointer"
        >
          <ChevronRight size={18} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
