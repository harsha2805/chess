import { UciEngine, type Transport } from './uci';

/** Stockfish as WebAssembly: fast, and what every current browser runs. */
export const WASM_ENGINE = 'engine/stockfish-19-lite-single.js';
/** Stockfish as plain JavaScript: slow, for places where WebAssembly is switched off. */
export const ASM_ENGINE = 'engine/stockfish-19-asm.js';

/** Starts Stockfish in a Web Worker. */
export function createBrowserEngine(file: string = WASM_ENGINE): UciEngine {
  const url = new URL(`${import.meta.env.BASE_URL}${file}`, window.location.href);
  const worker = new Worker(url);
  const transport: Transport = {
    onLine: null,
    onError: null,
    send: (command) => worker.postMessage(command),
    close: () => worker.terminate(),
  };
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (typeof data !== 'string') return;
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) transport.onLine?.(trimmed);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    transport.onError?.(new Error(event.message || 'The chess engine could not start.'));
  };
  return new UciEngine(transport);
}
