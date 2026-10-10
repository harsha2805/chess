// Copies the single-threaded lite Stockfish build into public/engine so it is
// served next to the app. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(to, { recursive: true });
for (const f of files) {
  if (!existsSync(join(from, f))) {
    console.error(`Missing ${f}. Run "npm install" first.`);
    process.exit(1);
  }
  copyFileSync(join(from, f), join(to, f));
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(to, 'COPYING.txt'));
console.log('Engine files copied to public/engine');
