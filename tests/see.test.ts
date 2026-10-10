import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { forkTargets, hangingPieces, see } from '../src/lib/see';

describe('static exchange evaluation', () => {
  it('finds a free piece', () => {
    // Black knight on e5 is attacked by the d4 pawn and not defended.
    const chess = new Chess('4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1');
    expect(see(chess, 'e5')).toBe(3);
  });
  it('sees that a defended pawn is not worth a knight', () => {
    // White knight can take the e5 pawn, but the d6 pawn recaptures.
    const chess = new Chess('4k3/8/3p4/4p3/8/5N2/8/4K3 w - - 0 1');
    expect(see(chess, 'e5')).toBe(0);
  });
  it('counts a full exchange sequence', () => {
    // Pawn takes knight (+3), bishop recaptures the pawn (-1): net +2.
    const chess = new Chess('4k3/6b1/8/4n3/3P4/8/8/4K3 w - - 0 1');
    expect(see(chess, 'e5')).toBe(2);
  });
  it('respects pins against the king', () => {
    // The black rook on e7 is pinned by the rook on e1? It still may capture along the file.
    // Here the knight on d7 is pinned by the bishop on a4 and cannot recapture on e5.
    const chess = new Chess('4k3/3n4/8/4p3/B7/5N2/8/4K3 w - - 0 1');
    expect(see(chess, 'e5')).toBe(1);
  });
});

describe('hanging pieces', () => {
  it('lists pieces the side to move can win', () => {
    const chess = new Chess('4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1');
    const threats = hangingPieces(chess);
    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({ square: 'e5', piece: 'n', gain: 3 });
  });
  it('is empty when everything is defended', () => {
    const chess = new Chess();
    expect(hangingPieces(chess)).toEqual([]);
  });
});

describe('forks', () => {
  it('recognises a knight fork of king and rook', () => {
    // White knight on c7 attacks the king on e8 and the rook on a8; Black to move.
    const chess = new Chess('r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1');
    expect(forkTargets(chess, 'c7')).toEqual(['k', 'r']);
  });
  it('does not count a forking piece that can simply be taken', () => {
    // Same fork, but the queen on d8 takes the knight.
    const chess = new Chess('r2qk3/2N5/8/8/8/8/8/4K3 b - - 0 1');
    expect(forkTargets(chess, 'c7')).toEqual([]);
  });
  it('needs two real targets', () => {
    const chess = new Chess('4k3/2N5/8/8/8/8/8/4K3 b - - 0 1');
    expect(forkTargets(chess, 'c7')).toEqual([]);
  });
});
