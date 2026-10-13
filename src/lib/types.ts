export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*';

/**
 * A position score from White's point of view.
 * - `cp`: centipawns.
 * - `mate`: moves to mate. Positive means White mates, negative means Black mates.
 *   `mate: 0` marks the final checkmate position; `cp` then carries the winner's sign.
 */
export interface Score {
  cp?: number;
  mate?: number;
}

export interface EngineLine {
  /** First move of the line in UCI form, e.g. "e2e4" or "e7e8q". */
  move: string;
  pv: string[];
  /** White's point of view. */
  score: Score;
  depth: number;
}

export interface PositionEval {
  /** Best line first. Empty when the position is terminal. */
  lines: EngineLine[];
  /** Score of the position itself (best line, or the terminal result). White's point of view. */
  score: Score;
}

export interface EvaluateOptions {
  depth: number;
  multipv: number;
  /** Upper bound per position in milliseconds. */
  movetime?: number;
}

export interface Engine {
  readonly name: string;
  newGame(): Promise<void>;
  /** Resolves with lines scored from the side to move's point of view. */
  search(fen: string, opts: EvaluateOptions): Promise<RawLine[]>;
  stop(): void;
  dispose(): void;
}

export interface RawLine {
  move: string;
  pv: string[];
  /** Side to move's point of view. */
  cp?: number;
  mate?: number;
  depth: number;
}

export interface ParsedMove {
  /** 1-based half-move number. */
  ply: number;
  color: Color;
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  fenBefore: string;
  fenAfter: string;
  /** Seconds left on the mover's clock after the move, when the PGN records it. */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: ParsedMove[];
  result: Result;
}

export type Mark =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'miss'
  | 'mistake'
  | 'blunder';

export type Phase = 'opening' | 'middlegame' | 'endgame';

export type Tag =
  | { kind: 'hung'; piece: PieceType; square: string; by: string; moved: boolean }
  | { kind: 'missed_capture'; san: string; piece: PieceType }
  | { kind: 'missed_mate'; in: number }
  | { kind: 'allowed_mate'; in: number; by: string }
  | { kind: 'missed_fork'; san: string; targets: PieceType[] }
  | { kind: 'allowed_fork'; san: string; targets: PieceType[] }
  | { kind: 'fork'; targets: PieceType[] }
  | { kind: 'sacrifice'; piece: PieceType }
  | { kind: 'only_move' }
  | { kind: 'checkmate' }
  | { kind: 'time_pressure'; clock: number };

export type TagKind = Tag['kind'];

export interface MoveReview {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  mark: Mark;
  /** Winning chances given up by this move, in percentage points (0 to 100). */
  loss: number;
  accuracy: number;
  /** Mover's winning chances with best play before the move. */
  winBefore: number;
  /** Mover's winning chances after the move actually played. */
  winAfter: number;
  /** Position after the move, White's point of view. */
  evalAfter: Score;
  /** The engine's first choice in the position before the move. */
  best?: { uci: string; san: string; pv: string[] };
  /** The engine's expected reply to the move played. */
  reply?: { uci: string; san: string };
  /** How the engine expects the game to continue after the move played, in SAN. */
  follow?: string[];
  tags: Tag[];
  phase: Phase;
  clock?: number;
  /** Seconds spent on this move, when clocks are known. */
  spent?: number;
}

export interface GameReview {
  version: number;
  engine: string;
  /** The depth the engine was asked to reach in every position. */
  depth: number;
  /**
   * The depth the engine actually reached, on average over the positions it searched. Below
   * `depth` when the time limit stopped some searches early. Missing on older reviews.
   */
  reached?: number;
  /** How many positions the time limit stopped before `depth`. Missing on older reviews. */
  capped?: number;
  analyzedAt: number;
  startEval: Score;
  moves: MoveReview[];
  accuracy: { w: number; b: number };
  opening?: { eco: string; name: string; ply: number };
}

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';

export interface PlayerInfo {
  name: string;
  rating?: number;
}

export interface GameRecord {
  id: string;
  source: 'chesscom' | 'lichess' | 'pgn' | 'sample';
  /** "chesscom:name" or "lichess:name" when imported from an account. */
  account?: string;
  url?: string;
  pgn: string;
  white: PlayerInfo;
  black: PlayerInfo;
  result: Result;
  playedAt: number;
  timeControl?: { base: number; inc: number };
  timeClass: TimeClass;
  /** Which side the person reviewing played, when known. */
  me?: Color;
  plies: number;
  addedAt: number;
  review?: GameReview;
}

export const REVIEW_VERSION = 1;

export const isReviewed = (g: GameRecord) => !!g.review && g.review.version === REVIEW_VERSION;

/**
 * How strong a review is, compared key by key: the review format first (an outdated review is
 * not shown at all), then the depth asked for, then the depth reached, then the later one.
 * The server ranks reviews the same way (GameSync::rank).
 */
export function reviewRank(r: GameReview): number[] {
  return [r.version ?? 0, r.depth ?? 0, r.reached ?? r.depth ?? 0, r.analyzedAt ?? 0];
}

/** Below zero when `a` is the weaker review, above zero when it is the stronger, zero when they rank the same. */
export function compareReviews(a: GameReview, b: GameReview): number {
  const ra = reviewRank(a);
  const rb = reviewRank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return 0;
}

/**
 * The stronger of two reviews, so a deeper review is never replaced by a lighter one made
 * later. On a tie the first is kept, so two equal copies never replace each other back and forth.
 */
export function betterReview(a: GameReview | null | undefined, b: GameReview | null | undefined): GameReview | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return compareReviews(b, a) > 0 ? b : a;
}
