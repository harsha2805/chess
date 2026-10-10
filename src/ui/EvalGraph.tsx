import { useMemo, useState, type PointerEvent } from 'react';
import { MARK_SUFFIX, moveLabel } from '../lib/explain';
import { formatScore, whiteWin } from '../lib/score';
import type { GameReview, Mark } from '../lib/types';
import { useWidth } from './hooks';

const DOTTED: Mark[] = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];
const H = 92;

/**
 * White's winning chances through the game. The light area is White's share, the dark
 * area Black's, the same way the bar beside the board reads. Click or drag to move through the game.
 */
export function EvalGraph({ review, ply, onSelect }: { review: GameReview; ply: number; onSelect: (ply: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);
  const n = review.moves.length;

  const wins = useMemo(() => [whiteWin(review.startEval), ...review.moves.map((m) => whiteWin(m.evalAfter))], [review]);
  const x = (i: number) => (n === 0 ? 0 : (i / n) * width);
  const y = (win: number) => 3 + (1 - win / 100) * (H - 6);

  const line = wins.map((w, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${H} L0,${H} Z`;

  const plyAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(ratio * n);
  };

  const shown = hover ?? null;
  const tipMove = shown !== null && shown > 0 ? review.moves[shown - 1] : null;
  const tipX = shown !== null ? Math.max(56, Math.min(width - 56, x(shown))) : 0;

  return (
    <div
      ref={ref}
      className="graph"
      role="img"
      aria-label="White's winning chances through the game. Use the move list or the arrow keys to step through it."
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
      <svg height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
        <rect width={width} height={H} fill="#2b3644" />
        <path d={area} fill="#f4f6f8" />
        <line x1="0" x2={width} y1={H / 2} y2={H / 2} stroke="#8e99a6" strokeWidth="1" />
        {review.moves.map((m, i) =>
          DOTTED.includes(m.mark) ? (
            <circle key={m.ply} cx={x(i + 1)} cy={y(wins[i + 1])} r="4" fill={`var(--m-${m.mark})`} stroke="#fff" strokeWidth="1.5" />
          ) : null,
        )}
        {shown !== null && shown !== ply && (
          <line x1={x(shown)} x2={x(shown)} y1="0" y2={H} stroke="#fff" strokeWidth="1" style={{ mixBlendMode: 'difference' }} opacity="0.6" />
        )}
        <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#fff" strokeWidth="2" style={{ mixBlendMode: 'difference' }} />
      </svg>
      {shown !== null && (
        <div className="graph-tip" style={{ left: tipX }}>
          {tipMove ? (
            <>
              <span>
                {moveLabel(tipMove)}
                {MARK_SUFFIX[tipMove.mark] ?? ''}
              </span>{' '}
              {formatScore(tipMove.evalAfter)}
            </>
          ) : (
            'Start'
          )}
        </div>
      )}
    </div>
  );
}
