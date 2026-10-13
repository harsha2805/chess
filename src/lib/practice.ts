import { Chess } from 'chess.js';
import { WASM_ENGINE, createBrowserEngine } from './engine-browser';
import { toWhite } from './score';
import type { RawLine, Score } from './types';
import type { UciEngine } from './uci';

// ---- Practice: playing on from a position, apart from the reviews ----
//
// Two engines of their own, never the ones the review queue uses. The bot's engine has its
// strength turned down, and an option set on an engine stays set, so sharing one with the
// reviews would weaken them. The analysis engine always plays at full strength.

/**
 * How far the live analysis looks. It keeps going while the person stays on a position, so a
 * sharp combination that only shows 25 moves ahead is found. Phones stop sooner, to spare the
 * battery, unless asked to look deeper.
 */
export const ANALYSIS_DEPTH = 30;
export const PHONE_ANALYSIS_DEPTH = 22;

/** How far to look on this device. */
export function analysisDepth(): number {
  if (typeof window === 'undefined') return ANALYSIS_DEPTH;
  return window.matchMedia?.('(pointer: coarse)').matches ? PHONE_ANALYSIS_DEPTH : ANALYSIS_DEPTH;
}

/** Stockfish limits its own strength only between these ratings. */
export const ENGINE_ELO_MIN = 1320;
export const ENGINE_ELO_MAX = 3190;
/** The lowest rating the bot is offered at: below it, play is close to random. */
export const BOT_ELO_MIN = 400;

export interface AnalysisLine {
  /** The first move, in UCI and SAN. */
  uci: string;
  san: string;
  /** The line it starts, in SAN. */
  pv: string[];
  /** White's point of view. */
  score: Score;
}

export interface Analysis {
  fen: string;
  depth: number;
  /** Best line first. Empty when the game is over in this position. */
  lines: AnalysisLine[];
  /** White's point of view. */
  score: Score;
  /** How far this search goes. */
  target: number;
  /** True once the search has reached `target`. */
  done: boolean;
}

type EngineFactory = () => UciEngine;
let factory: EngineFactory = () => createBrowserEngine(WASM_ENGINE);
/** Lets the tests run Node engines in place of the browser's workers. */
export function setPracticeEngineFactory(f: EngineFactory) {
  factory = f;
}

let analysisEngine: UciEngine | null = null;
let botEngine: UciEngine | null = null;
let botElo: number | null = null;

function engine(which: 'analysis' | 'bot'): UciEngine {
  if (which === 'analysis') return (analysisEngine ??= factory());
  return (botEngine ??= factory());
}

/** Closes the practice engines, as when leaving practice. */
export function closePractice() {
  analysisEngine?.dispose();
  botEngine?.dispose();
  analysisEngine = null;
  botEngine = null;
  botElo = null;
}

/** The SAN of a line of UCI moves played from `fen`, as far as it stays legal. */
function sanLine(fen: string, uci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uci) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** A finished position needs no engine: mate, stalemate, or a draw by the rules. */
function terminal(fen: string): Score | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { mate: 0, cp: chess.turn() === 'w' ? -100000 : 100000 };
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { cp: 0 };
  return null;
}

let analysisToken = 0;

/**
 * Analyses `fen` at full strength to `depth` moves ahead, reporting each deeper result as it
 * arrives, best three lines first. A new call stops the one before. Returns a function that stops it.
 */
export function analyse(fen: string, onUpdate: (a: Analysis) => void, depth = analysisDepth()): () => void {
  const token = ++analysisToken;
  const live = () => token === analysisToken;
  const end = terminal(fen);
  if (end) {
    onUpdate({ fen, depth: 0, target: depth, lines: [], score: end, done: true });
    return () => undefined;
  }
  const turn = new Chess(fen).turn();
  const eng = engine('analysis');
  eng.stop();
  const report = (raw: RawLine[], done: boolean) => {
    if (!live() || raw.length === 0) return;
    const lines = raw.map((r) => {
      const pv = sanLine(fen, r.pv);
      return { uci: r.move, san: pv[0] ?? r.move, pv, score: toWhite(r, turn) };
    });
    onUpdate({ fen, depth: raw[0].depth, target: depth, lines, score: lines[0].score, done });
  };
  void eng
    .search(fen, { depth, multipv: 3, onUpdate: (raw) => report(raw, false) })
    .then((raw) => report(raw, true))
    .catch(() => undefined);
  return () => {
    if (live()) {
      analysisToken++;
      eng.stop();
    }
  };
}

/** Stops the live analysis without starting another. */
export function stopAnalysis() {
  analysisToken++;
  analysisEngine?.stop();
}

/**
 * How the bot plays at a given rating. From 1320 up, Stockfish limits itself. Below that it
 * can go no lower, so the bot looks only a few moves ahead and picks among its best moves at
 * random, favouring the better ones less the lower the rating, as weaker players do.
 */
export function botStyle(elo: number): { limit: boolean; depth: number; choices: number; temperature: number } {
  if (elo >= ENGINE_ELO_MIN) return { limit: true, depth: 30, choices: 1, temperature: 0 };
  // From BOT_ELO_MIN to ENGINE_ELO_MIN, 0 at the bottom and 1 at the top.
  const t = Math.max(0, Math.min(1, (elo - BOT_ELO_MIN) / (ENGINE_ELO_MIN - BOT_ELO_MIN)));
  return {
    limit: false,
    depth: Math.round(1 + t * 9),
    choices: 6,
    // How many centipawns a move may give up and still be picked often.
    temperature: Math.round(320 - t * 290),
  };
}

const MATE_CP = 100000;
const asCp = (line: RawLine) => (line.mate !== undefined ? Math.sign(line.mate || 1) * (MATE_CP - Math.abs(line.mate)) : (line.cp ?? 0));

/**
 * Picks the bot's move from the engine's lines (scored for the side to move). A move is
 * picked less often the more it gives up, by a factor e for every `temperature` centipawns.
 * `random` returns a number from 0 to 1, as Math.random does.
 */
export function pickMove(lines: RawLine[], temperature: number, random: () => number = Math.random): string {
  if (lines.length === 0) throw new Error('No move to pick');
  if (temperature <= 0 || lines.length === 1) return lines[0].move;
  const best = asCp(lines[0]);
  const weights = lines.map((l) => Math.exp(-Math.max(0, best - asCp(l)) / temperature));
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lines.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return lines[i].move;
  }
  return lines[lines.length - 1].move;
}

/** The bot's move in `fen`, in UCI, playing at about `elo`. */
export async function botMove(fen: string, elo: number): Promise<string> {
  const eng = engine('bot');
  const style = botStyle(elo);
  const target = style.limit ? Math.min(ENGINE_ELO_MAX, Math.round(elo)) : null;
  if (target !== botElo) {
    await eng.setOptions(target === null ? { UCI_LimitStrength: false } : { UCI_LimitStrength: true, UCI_Elo: target });
    botElo = target;
  }
  const lines = await eng.search(fen, { depth: style.depth, multipv: style.choices, movetime: style.limit ? 1000 : undefined });
  return pickMove(lines, style.temperature);
}

/** The rating the bot starts at: the person's own in the game, else a common club rating. */
export function startingElo(rating: number | undefined): number {
  const r = rating ?? 1200;
  return Math.max(BOT_ELO_MIN, Math.min(ENGINE_ELO_MAX, Math.round(r)));
}

