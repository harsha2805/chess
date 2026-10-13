import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { describeMove } from '../src/lib/describe';

/** Plays `moves` from `fen` and describes each one. */
function words(moves: string[], fen?: string): string[] {
  const chess = new Chess(fen);
  return moves.map((san) => describeMove(chess.move(san)));
}

describe('moves in plain words', () => {
  it('describes the opening moves of the Najdorf', () => {
    expect(words(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])).toEqual([
      'White’s e-pawn moves two squares, from e2 to e4, claiming space in the centre.',
      'Black’s c-pawn moves two squares, from c7 to c5.',
      'White’s knight comes out from g1 to f3.',
      'Black’s d-pawn moves one square, from d7 to d6.',
      'White’s d-pawn moves two squares, from d2 to d4, claiming space in the centre.',
      'Black’s c-pawn takes White’s pawn on d4.',
      'White’s knight takes Black’s pawn on d4.',
      'Black’s knight comes out from g8 to f6.',
      'White’s knight comes out from b1 to c3.',
      'Black’s a-pawn moves one square, from a7 to a6.',
    ]);
  });

  it('describes castling, a fianchetto and a check', () => {
    const [, , , fianchetto] = words(['g3', 'e5', 'Nf3', 'e4', 'Bg2']).slice(1);
    expect(fianchetto).toBe('White’s bishop comes out from f1 to g2, onto the long diagonal: a fianchetto.');
    expect(words(['O-O'], 'rnbqkbnr/pppppppp/8/8/8/5NP1/PPPPPPBP/RNBQK2R w KQkq - 0 1')[0]).toBe(
      'White castles on the king’s side: the king goes to g1 and the rook from h1 to f1, tucking the king away and bringing the rook towards the centre.',
    );
    expect(words(['e4', 'e5', 'Bc4', 'Nc6', 'Bxf7+'])[4]).toBe('White’s bishop takes Black’s pawn on f7. Check: Black’s king is attacked.');
    expect(words(['f3', 'e5', 'g4', 'Qh4#'])[3]).toBe('Black’s queen goes from d8 to h4. Checkmate.');
  });

  it('describes en passant and promotion', () => {
    expect(words(['exd6'], 'k7/8/8/3pP3/8/8/8/K7 w - d6 0 1')[0]).toBe('White’s e-pawn takes Black’s pawn en passant, landing on d6.');
    expect(words(['b8=Q+'], '7k/1P6/8/8/8/8/8/K7 w - - 0 1')[0]).toBe(
      'White’s b-pawn moves one square, from b7 to b8 and becomes a queen. Check: Black’s king is attacked.',
    );
  });
});
