import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Cell {
  visible: boolean;
  update(visible: boolean): void;
}

const cells = new Map<Element, Cell>();
const selectedCells = new Set<Element>();
let observer: IntersectionObserver | null = null;

function updateCell(target: Element, cell: Cell): void {
  const selection = target.ownerDocument.getSelection();
  // Replacing text nodes under a selection would collapse it, including a
  // selection spanning multiple rows. Wait until it leaves this cell.
  if (selection && !selection.isCollapsed) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      if (selection.getRangeAt(i).intersectsNode(target)) {
        selectedCells.add(target);
        return;
      }
    }
  }
  selectedCells.delete(target);
  cell.update(cell.visible);
}

function updateSelectedCells(): void {
  for (const target of selectedCells) {
    const cell = cells.get(target);
    if (cell) updateCell(target, cell);
  }
}

function observe(target: Element, update: Cell['update']): () => void {
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const cell = cells.get(entry.target);
        if (!cell) continue;
        cell.visible = entry.isIntersecting;
        updateCell(entry.target, cell);
      }
    }, { rootMargin: '600px 0px' });
    document.addEventListener('selectionchange', updateSelectedCells);
  }
  cells.set(target, { visible: false, update });
  observer.observe(target);
  return () => {
    observer?.unobserve(target);
    cells.delete(target);
    selectedCells.delete(target);
    if (cells.size === 0) {
      observer?.disconnect();
      observer = null;
      document.removeEventListener('selectionchange', updateSelectedCells);
    }
  };
}

/** Keep text and marks mounted, but only pay for nearby syntax token spans. */
export function DeferredSyntax({ children }: { children(visible: boolean): ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    return observe(ref.current, setVisible);
  }, []);

  return <span ref={ref}>{children(visible)}</span>;
}
