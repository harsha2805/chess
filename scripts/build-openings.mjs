// Builds src/data/openings.json from the Lichess chess-openings TSV files (CC0).
// Key: piece placement + side to move + castling rights. Value: "ECO|Name" for a
// named position, "" for an unnamed position that lies on a named line.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data', 'openings');
const book = {};
let named = 0;

const key = (fen) => fen.split(' ').slice(0, 3).join(' ');

for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
    sans.forEach((san, i) => {
      chess.move(san);
      const k = key(chess.fen());
      if (i === sans.length - 1) {
        book[k] = `${eco}|${name}`;
        named++;
      } else if (!(k in book)) {
        book[k] = '';
      }
    });
  }
}

writeFileSync(join(root, 'src', 'data', 'openings.json'), JSON.stringify(book));
console.log(`openings.json: ${Object.keys(book).length} positions, ${named} named`);
