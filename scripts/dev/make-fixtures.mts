// Generates synthetic test games (engine self-play with injected errors and clocks).
// Test data only: these are not human games and are not shipped with the site.
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { createNodeEngine } from '../node-engine.ts';

const N = Number(process.argv[2] ?? 8);
const out = process.argv[3] ?? 'tests/games/fixtures.pgn';
const engine = createNodeEngine();
let seed = 20261011;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const opponents = ['knightfall_88', 'e4_enjoyer', 'Sicilian_Dan', 'pawnstorm42', 'RookieMistake', 'the_london_guy', 'Zugzwang_Zoe', 'bishop_pair'];
const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(1);
  return `${h}:${String(m).padStart(2, '0')}:${sec.padStart(4, '0')}`;
};

const games: string[] = [];
for (let g = 0; g < N; g++) {
  const base = g % 3 === 0 ? 180 : 600;
  const meWhite = g % 2 === 0;
  const opp = opponents[g % opponents.length];
  const chess = new Chess();
  const clocks = { w: base, b: base };
  const errRate = { w: 0.06 + rnd() * 0.08, b: 0.06 + rnd() * 0.08 };
  const body: string[] = [];
  let flagged: 'w' | 'b' | null = null;
  await engine.newGame();
  while (!chess.isGameOver() && chess.history().length < 110) {
    const turn = chess.turn();
    const low = clocks[turn] < base * 0.12;
    const legal = chess.moves({ verbose: true });
    let uci: string;
    const ply = chess.history().length;
    if (ply > 8 && rnd() < errRate[turn] * (low ? 3 : 1)) {
      const pick = legal[Math.floor(rnd() * legal.length)];
      uci = pick.lan;
    } else {
      const lines = await engine.search(chess.fen(), { depth: ply < 10 ? 4 : 7, multipv: ply < 10 ? 3 : 1 });
      const choice = ply < 10 ? lines[Math.floor(rnd() * lines.length)] : lines[0];
      uci = choice.move;
    }
    const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const spend = low ? 0.5 + rnd() * 2 : ply < 12 ? 1 + rnd() * 4 : 2 + rnd() * rnd() * (base / 12);
    clocks[turn] = Math.max(0, clocks[turn] - spend);
    const no = Math.ceil((ply + 1) / 2);
    body.push(`${turn === 'w' ? `${no}.` : `${no}...`} ${mv.san} {[%clk ${fmt(clocks[turn])}]}`);
    if (clocks[turn] <= 0) { flagged = turn; break; }
  }
  let result = '1/2-1/2';
  if (flagged) result = flagged === 'w' ? '0-1' : '1-0';
  else if (chess.isCheckmate()) result = chess.turn() === 'w' ? '0-1' : '1-0';
  else if (!chess.isGameOver()) {
    const lines = await engine.search(chess.fen(), { depth: 8, multipv: 1 });
    const cp = (lines[0].mate !== undefined ? Math.sign(lines[0].mate) * 9999 : lines[0].cp ?? 0) * (chess.turn() === 'w' ? 1 : -1);
    result = cp > 150 ? '1-0' : cp < -150 ? '0-1' : '1/2-1/2';
  }
  const day = String(1 + g).padStart(2, '0');
  const headers = [
    ['Event', 'Live Chess'], ['Site', 'Chess.com'], ['Date', `2026.10.${day}`], ['Round', '-'],
    ['White', meWhite ? 'harsha2805' : opp], ['Black', meWhite ? opp : 'harsha2805'], ['Result', result],
    ['UTCDate', `2026.10.${day}`], ['UTCTime', `1${g % 10}:20:00`],
    ['WhiteElo', String(1180 + Math.floor(rnd() * 120))], ['BlackElo', String(1180 + Math.floor(rnd() * 120))],
    ['TimeControl', String(base)], ['Link', `https://www.chess.com/game/live/9900000${g}`],
  ].map(([k, v]) => `[${k} "${v}"]`).join('\n');
  games.push(`${headers}\n\n${body.join(' ')} ${result}`);
  console.log(`game ${g + 1}: ${chess.history().length} plies, ${result}`);
}
writeFileSync(out, games.join('\n\n') + '\n');
engine.dispose();
