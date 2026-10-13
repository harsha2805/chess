import type { CSSProperties } from 'react';
import { whiteWin } from '../lib/score';
import type { Color, Mark, Score } from '../lib/types';
import { MarkTag } from './MarkTag';
import wK from '../assets/pieces/wK.svg';
import wQ from '../assets/pieces/wQ.svg';
import wR from '../assets/pieces/wR.svg';
import wB from '../assets/pieces/wB.svg';
import wN from '../assets/pieces/wN.svg';
import wP from '../assets/pieces/wP.svg';
import bK from '../assets/pieces/bK.svg';
import bQ from '../assets/pieces/bQ.svg';
import bR from '../assets/pieces/bR.svg';
import bB from '../assets/pieces/bB.svg';
import bN from '../assets/pieces/bN.svg';
import bP from '../assets/pieces/bP.svg';

const PIECES: Record<string, string> = { K: wK, Q: wQ, R: wR, B: wB, N: wN, P: wP, k: bK, q: bQ, r: bR, b: bB, n: bN, p: bP };
const PIECE_ALT: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const FILES = 'abcdefgh';

/** Piece letters by square name, from the first field of a FEN. */
function placement(fen: string): Record<string, string> {
  const out: Record<string, string> = {};
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else {
          out[`${FILES[file]}${8 - r}`] = ch;
          file++;
        }
      }
    });
  return out;
}

export interface BoardProps {
  fen: string;
  orientation: Color;
  /** The move to highlight. */
  move?: { from: string; to: string };
  /** Adds the mark's bullet on the destination square. */
  mark?: Mark;
  /** A suggested move, drawn as an arrow. */
  arrow?: { from: string; to: string };
  /** Slides the moved piece (and the rook, when castling) from where it came from. */
  animate?: boolean;
  label: string;
  /** Makes the squares buttons, for moving pieces by tapping a piece and then a square. */
  onSquare?: (square: string) => void;
  /** The piece picked up, and the squares it can go to. */
  selected?: string;
  targets?: string[];
}

export function Board({ fen, orientation, move, mark, arrow, animate, label, onSquare, selected, targets }: BoardProps) {
  const pieces = placement(fen);
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const colOf = (square: string) => files.indexOf(FILES.indexOf(square[0]));
  const rowOf = (square: string) => ranks.indexOf(Number(square[1]));

  // Pieces arriving by this move, with where each came from: the piece moved, and the rook when castling.
  const arriving = new Map<string, string>();
  if (animate && move && pieces[move.to]) {
    arriving.set(move.to, move.from);
    const fileStep = FILES.indexOf(move.to[0]) - FILES.indexOf(move.from[0]);
    if (pieces[move.to].toLowerCase() === 'k' && Math.abs(fileStep) === 2) {
      const rank = move.to[1];
      if (fileStep > 0) arriving.set(`f${rank}`, `h${rank}`);
      else arriving.set(`d${rank}`, `a${rank}`);
    }
  }

  const interactive = !!onSquare;
  return (
    <div className={interactive ? 'board interactive' : 'board'} role={interactive ? 'group' : 'img'} aria-label={label}>
      {ranks.map((rank, row) =>
        files.map((file, col) => {
          const square = `${FILES[file]}${rank}`;
          const piece = pieces[square];
          const dark = (file + rank) % 2 === 1;
          const highlighted = move && (move.from === square || move.to === square);
          const target = targets?.includes(square);
          const Square = interactive ? 'button' : 'div';
          const pieceText = piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${PIECE_ALT[piece.toLowerCase()]}` : 'empty';
          return (
            <Square
              key={square}
              className={`sq${dark ? ' dark' : ''}${selected === square ? ' picked' : ''}${target ? (piece ? ' target capture' : ' target') : ''}`}
              {...(interactive
                ? {
                    type: 'button' as const,
                    onClick: () => onSquare!(square),
                    'aria-label': `${square}, ${pieceText}${selected === square ? ', picked up' : ''}${target ? ', can move here' : ''}`,
                    'aria-pressed': selected === square,
                  }
                : {})}
            >
              {highlighted && <i className="tint" />}
              {col === 0 && <span className="coord rank">{rank}</span>}
              {row === 7 && <span className="coord file">{FILES[file]}</span>}
              {piece && (
                <img
                  // A new key on each move restarts the slide.
                  key={arriving.has(square) ? fen : 'still'}
                  className={arriving.has(square) ? 'slide' : undefined}
                  style={
                    arriving.has(square)
                      ? ({ '--dx': colOf(arriving.get(square)!) - col, '--dy': rowOf(arriving.get(square)!) - row } as CSSProperties)
                      : undefined
                  }
                  src={PIECES[piece]}
                  alt={`${piece === piece.toUpperCase() ? 'White' : 'Black'} ${PIECE_ALT[piece.toLowerCase()]} on ${square}`}
                  draggable={false}
                />
              )}
            </Square>
          );
        }),
      )}
      {arrow && <Arrow x1={colOf(arrow.from)} y1={rowOf(arrow.from)} x2={colOf(arrow.to)} y2={rowOf(arrow.to)} />}
      {move && mark && (
        <div
          className={`board-tag${rowOf(move.to) === 0 ? ' edge-top' : ''}${colOf(move.to) === 7 ? ' edge-right' : ''}`}
          style={{ left: `${colOf(move.to) * 12.5}%`, top: `${rowOf(move.to) * 12.5}%` }}
        >
          <MarkTag mark={mark} />
        </div>
      )}
    </div>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const ax = x1 + 0.5;
  const ay = y1 + 0.5;
  const bx = x2 + 0.5;
  const by = y2 + 0.5;
  const length = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / length;
  const uy = (by - ay) / length;
  const head = 0.34;
  // Start a little out from the centre, stop where the head begins.
  const sx = ax + ux * 0.28;
  const sy = ay + uy * 0.28;
  const ex = bx - ux * head;
  const ey = by - uy * head;
  const px = -uy;
  const py = ux;
  const points = [
    [bx, by],
    [ex + px * 0.22, ey + py * 0.22],
    [ex - px * 0.22, ey - py * 0.22],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <svg className="board-overlay" viewBox="0 0 8 8" aria-hidden="true">
      <g opacity="0.88">
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--arrow)" strokeWidth="0.17" strokeLinecap="round" />
        <polygon points={points} fill="var(--arrow)" />
      </g>
    </svg>
  );
}

/** A thin bar showing who is ahead. White's share grows from White's side of the board. */
export function EvalBar({ score, orientation }: { score: Score; orientation: Color }) {
  const white = whiteWin(score);
  return (
    <div className={orientation === 'w' ? 'evalbar' : 'evalbar flipped'} role="img" aria-label={`White's winning chances: ${Math.round(white)}%`}>
      <i style={{ transform: `scaleY(${white / 100})` }} />
    </div>
  );
}
