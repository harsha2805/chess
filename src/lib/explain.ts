import type { Color, GameRecord, Mark, MoveReview, PieceType, Tag } from './types';

export const MARK_ORDER: Mark[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'miss',
  'mistake',
  'blunder',
];

export const MARK_LABEL: Record<Mark, string> = {
  brilliant: 'Brilliant',
  great: 'Great move',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book move',
  forced: 'Forced',
  inaccuracy: 'Inaccuracy',
  miss: 'Missed chance',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** The annotation an editor would print after the move. Most moves get none. */
export const MARK_SUFFIX: Partial<Record<Mark, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  miss: '?',
  mistake: '?',
  blunder: '??',
};

export const ERROR_MARKS: Mark[] = ['inaccuracy', 'miss', 'mistake', 'blunder'];
export const SERIOUS_MARKS: Mark[] = ['miss', 'mistake', 'blunder'];

const PIECE_NAME: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const pieceName = (p: PieceType) => PIECE_NAME[p];
export const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');

/** "12." for White's moves, "12…" for Black's. */
export function moveNumber(ply: number): string {
  const n = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${n}.` : `${n}…`;
}

export function moveLabel(m: { ply: number; san: string }): string {
  return `${moveNumber(m.ply)}${m.san}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function targetsText(targets: PieceType[]): string {
  return list(targets.slice(0, 3).map((t) => PIECE_NAME[t]));
}

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tagSentence(tag: Tag, m: MoveReview): string | null {
  switch (tag.kind) {
    case 'hung':
      return tag.moved
        ? `The ${PIECE_NAME[tag.piece]} can be taken on ${tag.square}: ${moveNumber(m.ply + 1)}${tag.by}.`
        : `It leaves the ${PIECE_NAME[tag.piece]} on ${tag.square} to be taken: ${moveNumber(m.ply + 1)}${tag.by}.`;
    case 'missed_capture':
      return `${tag.san} would have won a ${PIECE_NAME[tag.piece]}.`;
    case 'missed_mate':
      return `There was a forced mate in ${tag.in}.`;
    case 'allowed_mate':
      return `It allows mate in ${tag.in}, starting with ${moveNumber(m.ply + 1)}${tag.by}.`;
    case 'missed_fork':
      return `${tag.san} would have forked the ${targetsText(tag.targets)}.`;
    case 'allowed_fork':
      return `${moveNumber(m.ply + 1)}${tag.san} now forks the ${targetsText(tag.targets)}.`;
    case 'fork':
      return `It forks the ${targetsText(tag.targets)}.`;
    case 'time_pressure':
      return `Played with ${clockText(tag.clock)} on the clock.`;
    default:
      return null;
  }
}

export interface Commentary {
  /** One sentence that stands on its own. */
  lead: string;
  /** Supporting sentences, most useful first. */
  notes: string[];
}

/** Writes the annotator's note for one move. */
export function explain(m: MoveReview, game?: Pick<GameRecord, 'review'>): Commentary {
  const best = m.best && m.best.uci !== m.uci ? m.best.san : null;
  const who = sideName(m.color);
  const notes: string[] = [];
  let lead: string;

  const sacrifice = m.tags.find((t) => t.kind === 'sacrifice') as Extract<Tag, { kind: 'sacrifice' }> | undefined;
  const checkmate = m.tags.some((t) => t.kind === 'checkmate');

  switch (m.mark) {
    case 'brilliant':
      lead = sacrifice ? `${who} offers the ${PIECE_NAME[sacrifice.piece]}, and it works.` : 'A brilliant move.';
      break;
    case 'great':
      lead = 'The only move that holds the position together. Everything else is clearly worse.';
      break;
    case 'best':
      lead = checkmate ? 'Checkmate.' : "The engine's first choice.";
      break;
    case 'excellent':
      lead = best ? `Very nearly the best move. The engine slightly prefers ${best}.` : 'Very nearly the best move.';
      break;
    case 'good':
      lead = best ? `A sound move. ${best} was a little stronger.` : 'A sound move.';
      break;
    case 'book': {
      const opening = game?.review?.opening;
      lead = opening && opening.ply === m.ply ? `${opening.name}.` : 'A known opening move.';
      break;
    }
    case 'forced':
      lead = 'The only legal move.';
      break;
    case 'inaccuracy':
      lead = best ? `Slightly inaccurate. ${best} was better.` : 'Slightly inaccurate.';
      break;
    case 'miss':
      lead = best ? `A missed chance. ${best} would have punished the last move.` : 'A missed chance to punish the last move.';
      break;
    case 'mistake':
      lead = best ? `A mistake. ${best} was the move.` : 'A mistake.';
      break;
    case 'blunder':
      lead = best ? `A blunder. ${best} was the move.` : 'A blunder.';
      break;
  }

  for (const tag of m.tags) {
    const sentence = tagSentence(tag, m);
    if (sentence) notes.push(sentence);
  }

  if (ERROR_MARKS.includes(m.mark) && m.loss >= 5) {
    notes.push(`${who}'s winning chances go from ${Math.round(m.winBefore)}% to ${Math.round(m.winAfter)}%.`);
  }

  return { lead, notes };
}

/** A short name for each kind of error, for the insights page. */
export const MOTIF_LABEL: Partial<Record<Tag['kind'], string>> = {
  hung: 'Left a piece to be taken',
  missed_capture: 'Missed a free capture',
  missed_fork: 'Missed a fork',
  allowed_fork: 'Walked into a fork',
  missed_mate: 'Missed a forced mate',
  allowed_mate: 'Allowed a forced mate',
  time_pressure: 'Erred while short of time',
};
