import { hashString, seededRandom } from '../lib/format';

const W = 640;
const H = 120;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function rows(rand: () => number) {
  const bandY = round(20 + rand() * 50);
  const lines = Array.from({ length: 4 }, (_, i) => {
    const y = round(18 + i * 26 + rand() * 6);
    const x1 = round(24 + rand() * 180);
    const x2 = round(x1 + 120 + rand() * 260);
    return { y, x1, x2 };
  });
  const dashX = round(W - 140 + rand() * 40);
  return (
    <>
      <rect className="motif-soft" x="0" y={bandY} width={W} height="30" />
      {lines.map((l, i) => (
        <line key={i} className="motif-line" x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} />
      ))}
      {lines.slice(0, 3).map((l, i) => (
        <line key={`d${i}`} className="motif-line" x1={dashX} y1={l.y} x2={dashX + 24} y2={l.y} />
      ))}
    </>
  );
}

function blocks(rand: () => number) {
  const count = 3;
  const items = Array.from({ length: count }, (_, i) => {
    const w = round(70 + rand() * 90);
    const x = round(40 + i * 190 + rand() * 40);
    const top = rand() > 0.5;
    return { x, w, y: top ? 0 : round(48 + rand() * 20), h: top ? round(54 + rand() * 20) : H };
  });
  const barX = round(items[1].x + items[1].w - 8);
  const lineY = round(70 + rand() * 20);
  return (
    <>
      {items.map((b, i) => (
        <rect key={i} className="motif-soft" x={b.x} y={b.y} width={b.w} height={b.h} />
      ))}
      <rect className="motif-accent" x={barX} y="0" width="8" height={H} />
      <line className="motif-line motif-line--dashed" x1="0" y1={lineY} x2={W} y2={lineY} />
    </>
  );
}

function orb(rand: () => number) {
  const cx = round(120 + rand() * 400);
  const cy = round(50 + rand() * 20);
  const r = round(18 + rand() * 10);
  const boxX = round(cx - 70);
  return (
    <>
      <rect className="motif-soft" x={boxX} y="14" width="140" height="92" rx="14" />
      <rect className="motif-outline" x={round(boxX - 160 - rand() * 60)} y="-20" width="130" height="44" rx="12" />
      <rect className="motif-outline" x={round(boxX + 180 + rand() * 60)} y="96" width="130" height="44" rx="12" />
      <circle className="motif-accent" cx={cx} cy={cy} r={r} />
      <path className="motif-soft-strong" d={`M${cx} ${cy} L${cx} ${round(cy - r)} A${r} ${r} 0 0 1 ${round(cx + r * 0.87)} ${round(cy - r * 0.5)} Z`} />
    </>
  );
}

function steps(rand: () => number) {
  const start = round(30 + rand() * 120);
  const size = 34;
  const items = Array.from({ length: 6 }, (_, i) => ({
    x: round(start + i * (size + 22)),
    y: round(H - 24 - i * 14 - rand() * 6),
  }));
  const dot = items[Math.floor(rand() * items.length)];
  return (
    <>
      <line className="motif-line" x1="0" y1={H - 8} x2={W} y2={H - 8} />
      {items.map((s, i) => (
        <rect key={i} className="motif-soft" x={s.x} y={s.y - size} width={size} height={size} rx="6" />
      ))}
      <circle className="motif-accent" cx={dot.x + size / 2} cy={dot.y - size / 2} r="7" />
    </>
  );
}

const PATTERNS = [rows, blocks, orb, steps];

/* Square thumbnails (100 × 100), for the suggestion-card illustrations. */
const S = 100;

function squareLines(rand: () => number) {
  const bandY = round(38 + rand() * 10);
  const ys = [12, 24, bandY + 6, bandY + 13, 74, 86];
  return (
    <>
      <rect className="motif-soft" x="0" y={bandY} width={S} height="19" />
      {ys.map((y, i) => (
        <line key={i} className="motif-line" x1={round(10 + rand() * 6)} y1={y} x2={round(46 + rand() * 22)} y2={y} />
      ))}
      {ys.filter((_, i) => i % 2 === 0).map((y, i) => (
        <line key={`d${i}`} className="motif-line" x1="80" y1={y} x2="90" y2={y} />
      ))}
    </>
  );
}

function squareBlocks(rand: () => number) {
  const topW = round(28 + rand() * 10);
  const bottomY = round(46 + rand() * 8);
  return (
    <>
      <rect className="motif-soft" x="8" y="0" width={topW} height={round(40 + rand() * 8)} />
      <rect className="motif-soft" x="60" y={bottomY} width="32" height={S} />
      <rect className="motif-accent" x={round(8 + topW - 6)} y="0" width="5" height="46" />
      <rect className="motif-accent" x="60" y={bottomY} width="5" height={S} />
      <line className="motif-line motif-line--dashed" x1="4" y1="58" x2="54" y2="58" />
    </>
  );
}

function squarePitch(rand: () => number) {
  const r = round(12 + rand() * 4);
  return (
    <>
      <rect className="motif-outline" x="18" y="-12" width="64" height="24" rx="6" />
      <rect className="motif-soft" x="18" y="22" width="64" height="56" rx="8" />
      <rect className="motif-outline" x="18" y="22" width="64" height="56" rx="8" />
      <circle className="motif-accent" cx="50" cy="50" r={r} />
      <path className="motif-soft-strong" d={`M50 50 L50 ${round(50 - r)} A${r} ${r} 0 0 1 ${round(50 + r * 0.87)} ${round(50 - r * 0.5)} Z`} />
      <rect className="motif-outline" x="18" y="88" width="64" height="24" rx="6" />
    </>
  );
}

const SQUARE_PATTERNS = [squareLines, squareBlocks, squarePitch];

/**
 * Decorative coral motif, generated deterministically from a seed: a wide band by default,
 * or a square thumbnail.
 */
export function Motif({
  seed,
  className,
  square = false,
  variant,
}: {
  seed: string;
  className?: string;
  square?: boolean;
  /** Forces the pattern style (e.g. a card's position in a row) so neighbours never match. */
  variant?: number;
}) {
  const hash = hashString(seed);
  const rand = seededRandom(hash);
  const patterns = square ? SQUARE_PATTERNS : PATTERNS;
  const pattern = patterns[(variant ?? hash) % patterns.length];
  const [w, h] = square ? [S, S] : [W, H];
  return (
    <svg
      className={`motif${square ? ' motif--square' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="motif-bg" x="0" y="0" width={w} height={h} />
      {pattern(rand)}
    </svg>
  );
}
