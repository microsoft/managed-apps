import { useEffect, useState } from 'react';

/**
 * Scrollbar minimap showing colored markers where changes are in the file.
 * Aligns with the actual scrollbar of .workarea__center.
 */
export function ChangeMap({ markers }: { markers: Array<{ position: number; type: 'add' | 'del' }> }) {
  const [rect, setRect] = useState<{ top: number; height: number } | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const el = document.querySelector('.workarea__center');
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, height: r.height });
      setHasOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Hide when no markers, no rect, or content doesn't scroll.
  if (markers.length === 0 || !rect || !hasOverflow) return null;

  // Consolidate adjacent markers into ranges.
  const minHeight = 0.003;
  const consolidated: Array<{ top: number; height: number; type: 'add' | 'del' }> = [];
  let i = 0;
  while (i < markers.length) {
    const start = markers[i];
    let end = start;
    const type = start.type;
    while (i + 1 < markers.length && markers[i + 1].type === type && markers[i + 1].position - end.position < 0.005) {
      i++;
      end = markers[i];
    }
    consolidated.push({
      top: start.position,
      height: Math.max(end.position - start.position + minHeight, minHeight),
      type,
    });
    i++;
  }

  const handleClick = (position: number) => {
    const scrollEl = document.querySelector('.workarea__center');
    if (!scrollEl) return;
    const scrollTarget = position * (scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTo({ top: scrollTarget, behavior: 'smooth' });
  };

  return (
    <div
      className="diff__changemap"
      style={{ top: `${rect.top}px`, height: `${rect.height}px` }}
    >
      {consolidated.map((m, idx) => (
        <div
          key={idx}
          className={`diff__changemap-mark diff__changemap-mark--${m.type}`}
          style={{ top: `${m.top * 100}%`, height: `${Math.max(m.height * 100, 0.4)}%` }}
          onClick={() => handleClick(m.top)}
        />
      ))}
    </div>
  );
}
