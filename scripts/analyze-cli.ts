// Usage: npm run analyze -- path/to/game.pgn [depth]
// Prints the review of a PGN file to the terminal. Handy for tuning the marks.
import { readFileSync } from 'node:fs';
import { analyzeGame } from '../src/lib/analyze';
import { parsePgn, splitPgn } from '../src/lib/pgn';
import { formatScore } from '../src/lib/score';
import { createNodeEngine, loadBook } from './node-engine';

const file = process.argv[2];
const depth = Number(process.argv[3] ?? 12);
if (!file) {
  console.error('Usage: npm run analyze -- game.pgn [depth]');
  process.exit(1);
}

const engine = createNodeEngine();
const book = loadBook();

for (const pgn of splitPgn(readFileSync(file, 'utf8'))) {
  const game = parsePgn(pgn);
  const started = Date.now();
  const review = await analyzeGame(game, engine, { depth, movetime: 3000, book });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${game.headers.White ?? '?'} - ${game.headers.Black ?? '?'}  ${game.result}   (${review.engine}, depth ${depth}, ${secs}s)`);
  if (review.opening) console.log(`${review.opening.eco} ${review.opening.name}`);
  console.log(`Accuracy  White ${review.accuracy.w.toFixed(1)}  Black ${review.accuracy.b.toFixed(1)}\n`);
  for (const m of review.moves) {
    const no = m.color === 'w' ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}...`;
    const tags = m.tags.map((t) => JSON.stringify(t)).join(' ');
    console.log(
      `${no.padEnd(6)}${m.san.padEnd(8)}${m.mark.padEnd(11)}${formatScore(m.evalAfter).padStart(6)}  loss ${m.loss.toFixed(1).padStart(5)}  ${m.phase.padEnd(10)} best ${(m.best?.san ?? '-').padEnd(7)} ${tags}`,
    );
  }
}
engine.dispose();
