import { memo, useMemo, useState, type PointerEvent } from 'react';
import { MARK_SUFFIX, NOTABLE_MARKS, PHASE_LABEL, moveLabel } from '../lib/explain';
import { formatScore, whiteWin } from '../lib/score';
import type { MoveReview, Phase, Score } from '../lib/types';
import { useWidth } from './hooks';

const H = 168;
const TOP = 26;
const BOTTOM = 12;
const PAD = 10;

/** A path that only runs flat, upright or at 45 degrees between stations, like a transit diagram. */
function octilinear(points: [number, number][]): string {
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const rise = Math.abs(dy);
    if (rise > dx) d += ` L${x0.toFixed(1)},${(y0 + Math.sign(dy) * (rise - dx)).toFixed(1)}`;
    else d += ` L${(x0 + rise).toFixed(1)},${y1.toFixed(1)}`;
    d += ` L${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/**
 * The line map: White's winning chances through the game, drawn as one transit route.
 * Higher means better for White. Phases are fare zones, marked moves are interchanges,
 * and the ring is the move on the board. Click or drag along it to move through the game.
 */
/** What the line map draws: the score at the start, then each move's mark, phase and score after it. A saved review is one. */
export interface LineData {
  startEval: Score;
  moves: Pick<MoveReview, 'ply' | 'san' | 'mark' | 'phase' | 'evalAfter'>[];
}

export function EvalGraph({ review, ply, onSelect }: { review: LineData; ply: number; onSelect: (ply: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const [hover, setHover] = useState<number | null>(null);
  const n = review.moves.length;

  const x = (i: number) => xAt(i, n, width);
  const points = useMemo(
    () => [review.startEval, ...review.moves.map((m) => m.evalAfter)].map((score, i) => [xAt(i, review.moves.length, width), y(whiteWin(score))] as [number, number]),
    [review, width],
  );

  const plyAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD) / (rect.width - PAD * 2)));
    return Math.round(ratio * n);
  };

  const here = points[Math.min(ply, n)];
  const hereMove = ply > 0 ? review.moves[ply - 1] : null;
  const hereText = hereMove ? `${moveLabel(hereMove)}${MARK_SUFFIX[hereMove.mark] ?? ''}` : 'Start';
  const labelW = Math.max(52, hereText.length * 7.4 + 16);
  const labelX = Math.max(labelW / 2, Math.min(width - labelW / 2, here[0]));
  const labelAbove = here[1] > TOP + 34;
  const labelY = labelAbove ? here[1] - 38 : here[1] + 18;

  const tipMove = hover !== null && hover > 0 ? review.moves[hover - 1] : null;
  const tipX = hover !== null ? Math.max(60, Math.min(width - 60, x(hover))) : 0;

  return (
    <div className="linemap">
      <div className="linemap-head" aria-hidden="true">
        <span>White better ↑</span>
        <span>Black better ↓</span>
      </div>
      <div
        ref={ref}
        className="graph"
        role="img"
        aria-label="White's winning chances through the game, drawn as a line. Use the move list or the arrow keys to step through it."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSelect(plyAt(e));
        }}
        onPointerMove={(e) => {
          const at = plyAt(e);
          setHover(at);
          if (e.buttons & 1) onSelect(at);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <svg height={H} viewBox={`0 0 ${width} ${H}`}>
          <Route review={review} points={points} width={width} />
          {hover !== null && hover !== ply && <circle cx={x(hover)} cy={points[hover][1]} r="8" fill="none" stroke="var(--focus)" strokeWidth="2.5" />}
          <g className="here" style={{ transform: `translate(${here[0]}px, ${here[1]}px)` }}>
            <circle r="11" fill="var(--sign)" stroke="var(--sign-ink)" strokeWidth="4" />
            <circle r="4" fill="var(--sign-ink)" />
          </g>
          <g>
            <rect x={labelX - labelW / 2} y={labelY} width={labelW} height="21" rx="5" fill="var(--sign)" />
            <text className="here-label" x={labelX} y={labelY + 15} textAnchor="middle">
              {hereText}
            </text>
          </g>
        </svg>
        {hover !== null && hover !== ply && (
          <div className="graph-tip" style={{ left: tipX }}>
            {tipMove ? (
              <>
                {moveLabel(tipMove)}
                {MARK_SUFFIX[tipMove.mark] ?? ''} {formatScore(tipMove.evalAfter)}
              </>
            ) : (
              'Start'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Where position `i` of `n` moves sits across the map. */
const xAt = (i: number, n: number, width: number) => (n === 0 ? PAD : PAD + (i / n) * (width - PAD * 2));
const y = (win: number) => TOP + (1 - win / 100) * (H - TOP - BOTTOM);

/**
 * The parts of the map that do not move: phase zones, the even line, the route and its
 * interchanges. Memoised, so hovering or dragging along the line only redraws the ring and
 * the labels.
 */
const Route = memo(function Route({ review, points, width }: { review: LineData; points: [number, number][]; width: number }) {
  const zones = useMemo(() => {
    const out: { phase: Phase; from: number; to: number }[] = [];
    review.moves.forEach((m, i) => {
      const last = out[out.length - 1];
      if (last && last.phase === m.phase) last.to = i + 1;
      else out.push({ phase: m.phase, from: last ? last.to : 0, to: i + 1 });
    });
    return out;
  }, [review]);
  const route = octilinear(points);
  return (
    <>
      {zones.map((z, k) => {
        const name = PHASE_LABEL[z.phase].toUpperCase();
        const [x0] = points[z.from];
        const [x1] = points[z.to];
        return (
          <g key={z.from}>
            {k > 0 && <line x1={x0} x2={x0} y1="0" y2={H} stroke="var(--seam)" strokeDasharray="3 4" />}
            {x1 - x0 > name.length * 7.6 + 12 && (
              <text className="zone-label" x={x0 + 6} y="12">
                {name}
              </text>
            )}
          </g>
        );
      })}
      <line x1="0" x2={width} y1={y(50)} y2={y(50)} stroke="var(--band)" strokeWidth="1" strokeDasharray="2 4" />
      <path d={route} fill="none" stroke="var(--route-under)" strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
      <path d={route} fill="none" stroke="var(--route)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      {review.moves.map((m, i) =>
        NOTABLE_MARKS.includes(m.mark) ? (
          <circle key={m.ply} cx={points[i + 1][0]} cy={points[i + 1][1]} r="6.5" fill={`var(--m-${m.mark})`} stroke="var(--route)" strokeWidth="2.5" />
        ) : null,
      )}
    </>
  );
});
