import { Chess } from 'chess.js';
import type { Ending, GameRecord, ParsedGame, Result } from './types';

export type { Ending };

/** Lichess's game status, from its API. */
const LICHESS_STATUS: Record<string, Ending | 'draw'> = {
  mate: 'checkmate',
  resign: 'resignation',
  outoftime: 'time',
  // The opponent left and the player claimed the win; or a player never made a move.
  timeout: 'abandoned',
  noStart: 'abandoned',
  stalemate: 'stalemate',
  draw: 'draw',
};

/** A drawn game's cause, read from the final position: what is left is agreement. */
function drawFromPosition(game: ParsedGame): Ending {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const last = fens[fens.length - 1];
  const board = new Chess(last);
  if (board.isStalemate()) return 'stalemate';
  if (board.isInsufficientMaterial()) return 'insufficient';
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
  if (fens.filter((f) => key(f) === key(last)).length >= 3) return 'repetition';
  if (Number(last.split(' ')[4]) >= 100) return 'fifty';
  return 'agreement';
}

/**
 * How a game ended, from what chess.com and Lichess say about it. chess.com spells it out in
 * the PGN's Termination header ("x won by resignation", "x won - game abandoned", "Game drawn
 * by repetition"). Lichess only says "Normal", "Time forfeit" or "Abandoned" there, so its API
 * status is used when known, and otherwise the moves tell checkmate from resignation, and the
 * final position tells the kind of draw. Undefined when the game is unfinished or nothing says.
 */
export function detectEnding(game: ParsedGame, result: Result, lichessStatus?: string): Ending | undefined {
  if (result === '*') return undefined;
  const lastSan = game.moves[game.moves.length - 1]?.san ?? '';
  const draw = result === '1/2-1/2';
  const status = lichessStatus ? LICHESS_STATUS[lichessStatus] : undefined;
  if (status === 'draw') return drawFromPosition(game);
  // A draw on time: the side whose time ran out could not be mated.
  if (status === 'time' && draw) return 'time-insufficient';
  if (status) return status;

  const t = (game.headers.Termination ?? '').toLowerCase();
  if (draw && /time forfeit/.test(t)) return 'time-insufficient';
  if (/checkmate/.test(t)) return 'checkmate';
  if (/resign/.test(t)) return 'resignation';
  if (/abandon/.test(t)) return 'abandoned';
  if (/insufficient/.test(t) && /time/.test(t)) return 'time-insufficient';
  if (/on time|time forfeit|timeout|out of time/.test(t)) return 'time';
  if (/repetition/.test(t)) return 'repetition';
  if (/agree/.test(t)) return 'agreement';
  if (/stalemate/.test(t)) return 'stalemate';
  if (/insufficient/.test(t)) return 'insufficient';
  if (/50|fifty/.test(t)) return 'fifty';
  // Lichess's "Normal", or no header at all.
  if (lastSan.endsWith('#')) return 'checkmate';
  if (draw) return t === 'normal' ? drawFromPosition(game) : undefined;
  return t === 'normal' ? 'resignation' : undefined;
}

/** Short words for the games list and search: "Resignation", "On time", "Abandoned". */
export const ENDING_LABEL: Record<Ending, string> = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  time: 'On time',
  abandoned: 'Abandoned',
  agreement: 'Agreed draw',
  repetition: 'Repetition',
  stalemate: 'Stalemate',
  insufficient: 'Insufficient material',
  fifty: '50-move rule',
  'time-insufficient': 'Timeout vs insufficient material',
};

/**
 * Who was to move when the game ended: the side whose clock ran out, in a game lost or drawn
 * on time. The game starts with White to move unless its PGN sets up a position with Black to move.
 */
function toMoveAtEnd(game: GameRecord): 'w' | 'b' {
  const blackFirst = /\[FEN "[^"]* b /.test(game.pgn ?? '');
  return (game.plies % 2 === 0) !== blackFirst ? 'w' : 'b';
}

/**
 * The result in words, naming the player who resigned, left or ran out of time: "White won:
 * ben resigned", "Black won: ana ran out of time", "White won by checkmate", "Draw by repetition".
 */
export function resultWithEnding(game: GameRecord): string {
  const { result, ending } = game;
  const name = (color: 'w' | 'b') => (color === 'w' ? game.white?.name : game.black?.name) || (color === 'w' ? 'White' : 'Black');
  if (result === '*') return 'Unfinished';
  if (result === '1/2-1/2') {
    switch (ending) {
      case 'agreement':
        return 'Draw by agreement';
      case 'repetition':
        return 'Draw by repetition';
      case 'stalemate':
        return 'Draw by stalemate';
      case 'insufficient':
        return 'Draw: neither side can mate';
      case 'fifty':
        return 'Draw by the 50-move rule';
      case 'time-insufficient': {
        // As chess.com puts it: the clock ran out, but the other side could never have mated.
        const flagged = toMoveAtEnd(game);
        return `Draw: ${name(flagged)} ran out of time, but ${name(flagged === 'w' ? 'b' : 'w')} could not have forced checkmate`;
      }
      default:
        return 'Draw';
    }
  }
  const winner = result === '1-0' ? 'White' : 'Black';
  // Who resigned or left is named, as the players are on the board.
  const loser = name(result === '1-0' ? 'b' : 'w');
  switch (ending) {
    case 'checkmate':
      return `${winner} won by checkmate`;
    case 'resignation':
      return `${winner} won: ${loser} resigned`;
    case 'time':
      return `${winner} won: ${loser} ran out of time`;
    case 'abandoned':
      return `${winner} won: ${loser} abandoned the game`;
    default:
      return `${winner} won`;
  }
}
