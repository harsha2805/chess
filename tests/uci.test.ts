import { describe, expect, it } from 'vitest';
import { parseInfo } from '../src/lib/uci';

describe('UCI info lines', () => {
  it('reads depth, line number, score and moves', () => {
    const info = parseInfo('info depth 12 seldepth 19 multipv 2 score cp -251 nodes 6244 nps 87943 hashfull 2 time 71 pv h5e2 c6d4 e2d1');
    expect(info).toEqual({ multipv: 2, depth: 12, move: 'h5e2', pv: ['h5e2', 'c6d4', 'e2d1'], cp: -251 });
  });
  it('reads mate scores', () => {
    expect(parseInfo('info depth 6 seldepth 2 multipv 1 score mate 1 nodes 948 pv h5f7')).toMatchObject({ mate: 1, move: 'h5f7' });
    expect(parseInfo('info depth 9 score mate -3 pv a1a2')).toMatchObject({ mate: -3, multipv: 1 });
  });
  it('ignores bounds and lines without moves', () => {
    expect(parseInfo('info depth 10 multipv 1 score cp 30 lowerbound nodes 1 pv e2e4')).toBeNull();
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
  });
});
