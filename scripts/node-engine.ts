// Runs the same WASM Stockfish build the site ships, as a Node child process.
// Used by the tests and the command-line reviewer.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UciEngine, type Transport } from '../src/lib/uci';
import { bookKey, type BookLookup } from '../src/lib/analyze';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createNodeEngine(): UciEngine {
  const path = join(root, 'node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js');
  const child = spawn(process.execPath, [path], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '';
  const transport: Transport = {
    onLine: null,
    onError: null,
    send: (command) => child.stdin.write(command + '\n'),
    close: () => {
      child.stdin.end('quit\n');
      child.kill();
    },
  };
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) transport.onLine?.(line);
    }
  });
  child.on('error', (e) => transport.onError?.(e));
  // Writing to an engine that has just been closed fails with EPIPE; nothing is waiting for it.
  child.stdin.on('error', () => undefined);
  return new UciEngine(transport);
}

export function loadBook(): BookLookup {
  const book = JSON.parse(readFileSync(join(root, 'src', 'data', 'openings.json'), 'utf8')) as Record<string, string>;
  return (fen) => book[bookKey(fen)];
}
