import { ERROR_MARKS, MARK_ORDER, MOTIF_LABEL, SERIOUS_MARKS } from './explain';
import { isReviewed, type Color, type GameRecord, type Mark, type Phase, type Tag, type TimeClass } from './types';

export interface PhaseStat {
  phase: Phase;
  accuracy: number;
  moves: number;
}

export interface ClockStat {
  key: string;
  label: string;
  moves: number;
  errors: number;
  /** Serious errors (mistakes, blunders, missed chances) per 100 moves. */
  rate: number;
}

export interface MotifStat {
  /** The tag kind, or "hung-pawn" for pawns left to be taken, which are counted apart from pieces. */
  key: string;
  kind: Tag['kind'];
  label: string;
  count: number;
  games: number;
  examples: { gameId: string; ply: number; san: string; opponent: string }[];
}

export interface OpeningStat {
  name: string;
  color: Color;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number;
}

export interface TrendPoint {
  gameId: string;
  playedAt: number;
  accuracy: number;
  opponent: string;
  outcome: 'win' | 'draw' | 'loss';
  color: Color;
}

export interface Insights {
  player: string;
  games: number;
  reviewed: number;
  record: { wins: number; draws: number; losses: number };
  accuracy: number;
  byColor: Record<Color, { accuracy: number; games: number }>;
  byPhase: PhaseStat[];
  byClock: ClockStat[];
  byTimeClass: { timeClass: TimeClass; accuracy: number; games: number }[];
  trend: TrendPoint[];
  marks: Record<Mark, number>;
  moves: number;
  errorsPerGame: number;
  motifs: MotifStat[];
  openings: OpeningStat[];
  takeaways: string[];
}

/** Every player name in the stored games, most frequent first. */
export function playerNames(games: GameRecord[]): { name: string; games: number }[] {
  const counts = new Map<string, { name: string; games: number }>();
  for (const g of games) {
    for (const p of [g.white.name, g.black.name]) {
      const key = p.toLowerCase();
      const entry = counts.get(key) ?? { name: p, games: 0 };
      entry.games++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * Whose games these are: the stored name when it still appears in them, otherwise a name
 * that is in at least half of the games and in more of them than anyone else.
 */
export function resolvePlayer(games: GameRecord[], stored: string): string {
  const names = playerNames(games);
  const kept = stored ? names.find((n) => n.name.toLowerCase() === stored.toLowerCase()) : undefined;
  if (kept) return kept.name;
  const [first, second] = names;
  if (first && first.games >= 2 && first.games * 2 >= games.length && (!second || first.games > second.games)) return first.name;
  return '';
}

export function colorOf(game: GameRecord, player: string): Color | null {
  const p = player.toLowerCase();
  if (game.white.name.toLowerCase() === p) return 'w';
  if (game.black.name.toLowerCase() === p) return 'b';
  return null;
}

export function outcomeFor(game: GameRecord, color: Color): 'win' | 'draw' | 'loss' | null {
  if (game.result === '1/2-1/2') return 'draw';
  if (game.result === '1-0') return color === 'w' ? 'win' : 'loss';
  if (game.result === '0-1') return color === 'b' ? 'win' : 'loss';
  return null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const CLOCK_BUCKETS = [
  { key: 'plenty', label: 'Over half left', min: 0.5 },
  { key: 'some', label: '20–50% left', min: 0.2 },
  { key: 'low', label: '10–20% left', min: 0.1 },
  { key: 'scramble', label: 'Under 10% left', min: -1 },
];

const MOTIF_KINDS = Object.keys(MOTIF_LABEL) as Tag['kind'][];
const HUNG_PAWN_LABEL = 'Left a pawn to be taken';
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
const PHASE_NAME: Record<Phase, string> = { opening: 'opening', middlegame: 'middlegame', endgame: 'endgame' };

/** Patterns across all reviewed games of one player. */
export function buildInsights(allGames: GameRecord[], player: string): Insights {
  const mine = allGames.filter((g) => colorOf(g, player));
  const reviewed = mine.filter(isReviewed).sort((a, b) => a.playedAt - b.playedAt);

  const record = { wins: 0, draws: 0, losses: 0 };
  const byColorAcc: Record<Color, number[]> = { w: [], b: [] };
  const phaseAcc: Record<Phase, number[]> = { opening: [], middlegame: [], endgame: [] };
  const clock = CLOCK_BUCKETS.map((b) => ({ ...b, moves: 0, errors: 0 }));
  const classAcc = new Map<TimeClass, number[]>();
  const marks = Object.fromEntries(MARK_ORDER.map((m) => [m, 0])) as Record<Mark, number>;
  const motifs = new Map<string, MotifStat & { gameIds: Set<string> }>();
  const openings = new Map<string, OpeningStat & { acc: number[] }>();
  const trend: TrendPoint[] = [];
  let moves = 0;
  let errors = 0;

  for (const game of reviewed) {
    const color = colorOf(game, player)!;
    const review = game.review!;
    const opponent = color === 'w' ? game.black.name : game.white.name;
    const outcome = outcomeFor(game, color);
    if (outcome === 'win') record.wins++;
    else if (outcome === 'draw') record.draws++;
    else if (outcome === 'loss') record.losses++;

    const accuracy = review.accuracy[color];
    byColorAcc[color].push(accuracy);
    if (!classAcc.has(game.timeClass)) classAcc.set(game.timeClass, []);
    classAcc.get(game.timeClass)!.push(accuracy);
    if (outcome) trend.push({ gameId: game.id, playedAt: game.playedAt, accuracy, opponent, outcome, color });

    const base = game.timeControl?.base;
    let previousClock = base;
    // The piece left hanging on the player's previous move, so that leaving it there again is not a second error.
    let stillHanging = '';

    for (const m of review.moves) {
      if (m.color !== color) continue;
      moves++;
      marks[m.mark]++;
      if (m.mark !== 'book') phaseAcc[m.phase].push(m.accuracy);
      const serious = SERIOUS_MARKS.includes(m.mark);
      if (ERROR_MARKS.includes(m.mark)) errors++;

      if (base && m.clock !== undefined && game.timeClass !== 'daily') {
        const available = (previousClock ?? m.clock) / base;
        const bucket = clock.find((b) => available >= b.min)!;
        if (m.mark !== 'book') {
          bucket.moves++;
          if (serious) bucket.errors++;
        }
        previousClock = m.clock;
      }

      const hung = m.tags.find((t): t is Extract<Tag, { kind: 'hung' }> => t.kind === 'hung');
      const hungKey = hung && ERROR_MARKS.includes(m.mark) ? `${hung.piece}${hung.square}` : '';
      const repeat = hungKey !== '' && hungKey === stillHanging;
      stillHanging = hungKey;

      if (ERROR_MARKS.includes(m.mark)) {
        for (const tag of m.tags) {
          if (!MOTIF_KINDS.includes(tag.kind)) continue;
          if (tag.kind === 'hung' && repeat) continue;
          const pawn = tag.kind === 'hung' && tag.piece === 'p';
          const key = pawn ? 'hung-pawn' : tag.kind;
          let stat = motifs.get(key);
          if (!stat) {
            const label = pawn ? HUNG_PAWN_LABEL : MOTIF_LABEL[tag.kind]!;
            stat = { key, kind: tag.kind, label, count: 0, games: 0, examples: [], gameIds: new Set() };
            motifs.set(key, stat);
          }
          stat.count++;
          stat.gameIds.add(game.id);
          stat.examples.push({ gameId: game.id, ply: m.ply, san: m.san, opponent });
        }
      }
    }

    if (review.opening) {
      const family = review.opening.name.split(':')[0].trim();
      const key = `${color}|${family}`;
      let stat = openings.get(key);
      if (!stat) {
        stat = { name: family, color, games: 0, wins: 0, draws: 0, losses: 0, accuracy: 0, acc: [] };
        openings.set(key, stat);
      }
      stat.games++;
      if (outcome === 'win') stat.wins++;
      else if (outcome === 'draw') stat.draws++;
      else if (outcome === 'loss') stat.losses++;
      stat.acc.push(accuracy);
    }
  }

  const byPhase: PhaseStat[] = PHASES.map((phase) => ({ phase, accuracy: mean(phaseAcc[phase]), moves: phaseAcc[phase].length }));
  const byClock: ClockStat[] = clock.map((b) => ({
    key: b.key,
    label: b.label,
    moves: b.moves,
    errors: b.errors,
    rate: b.moves ? (b.errors / b.moves) * 100 : 0,
  }));
  const motifList: MotifStat[] = [...motifs.values()]
    .map(({ gameIds, ...m }) => ({ ...m, games: gameIds.size, examples: m.examples.slice(-6).reverse() }))
    .sort((a, b) => b.count - a.count);
  const openingList: OpeningStat[] = [...openings.values()]
    .map(({ acc, ...o }) => ({ ...o, accuracy: mean(acc) }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const byColor = {
    w: { accuracy: mean(byColorAcc.w), games: byColorAcc.w.length },
    b: { accuracy: mean(byColorAcc.b), games: byColorAcc.b.length },
  };

  // ---- Takeaways: only said when there are enough moves behind them ----
  const takeaways: string[] = [];
  const phasesWithData = byPhase.filter((p) => p.moves >= 25);
  if (phasesWithData.length >= 2) {
    const worst = phasesWithData.reduce((a, b) => (b.accuracy < a.accuracy ? b : a));
    const best = phasesWithData.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));
    if (best.accuracy - worst.accuracy >= 4) {
      takeaways.push(
        `The ${PHASE_NAME[worst.phase]} is where you lose the most: ${worst.accuracy.toFixed(0)}% accuracy, against ${best.accuracy.toFixed(0)}% in the ${PHASE_NAME[best.phase]}.`,
      );
    }
  }
  const calm = byClock[0];
  const scramble = byClock[3];
  if (calm.moves >= 40 && scramble.moves >= 15 && calm.rate > 0 && scramble.rate >= calm.rate * 1.5) {
    takeaways.push(
      `With under 10% of your time left you make a serious error ${(scramble.rate / calm.rate).toFixed(1)} times as often as with a full clock.`,
    );
  } else if (calm.moves >= 40 && scramble.moves >= 15 && calm.rate === 0 && scramble.errors >= 2) {
    takeaways.push(`All of your serious errors with a clock running came with under 10% of your time left.`);
  }
  if (motifList[0] && motifList[0].count >= 3) {
    const top = motifList[0];
    takeaways.push(`Your most common error: ${top.label.toLowerCase()}, ${top.count} times in ${top.games} ${top.games === 1 ? 'game' : 'games'}.`);
  }
  if (byColor.w.games >= 3 && byColor.b.games >= 3 && Math.abs(byColor.w.accuracy - byColor.b.accuracy) >= 4) {
    const better = byColor.w.accuracy > byColor.b.accuracy ? 'White' : 'Black';
    takeaways.push(`You play ${Math.abs(byColor.w.accuracy - byColor.b.accuracy).toFixed(0)} points more accurately with ${better}.`);
  }
  const triedOpenings = openingList.filter((o) => o.games >= 3);
  if (triedOpenings.length >= 2) {
    const worst = triedOpenings.reduce((a, b) => (b.accuracy < a.accuracy ? b : a));
    const best = triedOpenings.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));
    if (best.accuracy - worst.accuracy >= 5) {
      takeaways.push(`Your steadiest opening is the ${best.name}; the ${worst.name} gives you the most trouble.`);
    }
  }

  return {
    player,
    games: mine.length,
    reviewed: reviewed.length,
    record,
    accuracy: mean(reviewed.map((g) => g.review!.accuracy[colorOf(g, player)!])),
    byColor,
    byPhase,
    byClock,
    byTimeClass: [...classAcc.entries()].map(([timeClass, acc]) => ({ timeClass, accuracy: mean(acc), games: acc.length })),
    trend,
    marks,
    moves,
    errorsPerGame: reviewed.length ? errors / reviewed.length : 0,
    motifs: motifList,
    openings: openingList,
    takeaways,
  };
}
