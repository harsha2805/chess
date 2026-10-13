import { describe, expect, it } from 'vitest';
import { ENDING_LABEL, detectEnding, resultWithEnding } from '../src/lib/ending';
import { recordsFromChessCom, recordsFromLichess, recordsFromPgn } from '../src/lib/importers';
import { parsePgn } from '../src/lib/pgn';
import type { GameRecord, Result } from '../src/lib/types';

const pgn = (moves: string, result: Result, termination?: string) =>
  `[Event "Test"]\n[White "w"]\n[Black "b"]\n[Result "${result}"]\n${termination ? `[Termination "${termination}"]\n` : ''}\n${moves} ${result}`;

const ending = (moves: string, result: Result, termination?: string, status?: string) => detectEnding(parsePgn(pgn(moves, result, termination)), result, status);

const SHORT = '1. e4 e5 2. Nf3 Nc6';
const MATE = '1. f3 e5 2. g4 Qh4#';
// Knights shuffle back and forth: the start position comes up a third time.
const REPEAT = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8';

describe('how a game ended', () => {
  it('reads chess.com terminations', () => {
    expect(ending(SHORT, '1-0', 'me won by resignation')).toBe('resignation');
    expect(ending(SHORT, '0-1', 'them won on time')).toBe('time');
    expect(ending(SHORT, '1-0', 'me won - game abandoned')).toBe('abandoned');
    expect(ending(MATE, '0-1', 'them won by checkmate')).toBe('checkmate');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by agreement')).toBe('agreement');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by repetition')).toBe('repetition');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by stalemate')).toBe('stalemate');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by insufficient material')).toBe('insufficient');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by timeout vs insufficient material')).toBe('time-insufficient');
    expect(ending(SHORT, '1/2-1/2', 'Game drawn by 50-move rule')).toBe('fifty');
  });

  it('reads Lichess statuses, which say more than its PGN', () => {
    expect(ending(SHORT, '1-0', 'Normal', 'resign')).toBe('resignation');
    expect(ending(SHORT, '0-1', 'Time forfeit', 'outoftime')).toBe('time');
    // The opponent left and the win was claimed: AFK.
    expect(ending(SHORT, '1-0', 'Abandoned', 'timeout')).toBe('abandoned');
    expect(ending(SHORT, '1/2-1/2', 'Time forfeit', 'outoftime')).toBe('time-insufficient');
    expect(ending(REPEAT, '1/2-1/2', 'Normal', 'draw')).toBe('repetition');
    expect(ending(SHORT, '1/2-1/2', 'Normal', 'draw')).toBe('agreement');
  });

  it('works out a Lichess ending from the PGN alone, for games saved before', () => {
    expect(ending(MATE, '0-1', 'Normal')).toBe('checkmate');
    expect(ending(SHORT, '1-0', 'Normal')).toBe('resignation');
    expect(ending(SHORT, '1-0', 'Time forfeit')).toBe('time');
    expect(ending(SHORT, '0-1', 'Abandoned')).toBe('abandoned');
    expect(ending(REPEAT, '1/2-1/2', 'Normal')).toBe('repetition');
  });

  it('says nothing it cannot tell', () => {
    expect(ending(SHORT, '1-0')).toBeUndefined();
    expect(ending(SHORT, '*')).toBeUndefined();
    expect(ending(MATE, '0-1')).toBe('checkmate');
    expect(ending(SHORT, '1-0', 'Rules infraction')).toBeUndefined();
  });

  it('is kept on imported games', () => {
    const chesscom = recordsFromChessCom(
      [{ uuid: 'u1', pgn: pgn(SHORT, '0-1', 'them won - game abandoned'), white: { username: 'me' }, black: { username: 'them' } }],
      'me',
    )[0];
    expect(chesscom.ending).toBe('abandoned');
    const lichess = recordsFromLichess(
      [{ id: 'abc', status: 'resign', winner: 'white', pgn: pgn(SHORT, '1-0', 'Normal'), players: { white: { user: { name: 'me' } }, black: { user: { name: 'x' } } } }],
      'me',
    )[0];
    expect(lichess.ending).toBe('resignation');
    expect(recordsFromPgn(pgn(SHORT, '1-0')).records[0].ending).toBeNull();
  });

  it('puts it in words', () => {
    const game = (result: Result, end: GameRecord['ending']) => ({ result, ending: end, white: { name: 'ana' }, black: { name: 'ben' } }) as GameRecord;
    expect(resultWithEnding(game('1-0', 'resignation'))).toBe('White won: ben resigned');
    expect(resultWithEnding(game('0-1', 'abandoned'))).toBe('Black won: ana abandoned the game');
    expect(resultWithEnding(game('0-1', 'time'))).toBe('Black won: ana ran out of time');
    expect(resultWithEnding(game('1-0', 'checkmate'))).toBe('White won by checkmate');
    expect(resultWithEnding(game('1/2-1/2', 'repetition'))).toBe('Draw by repetition');
    expect(resultWithEnding(game('1-0', null))).toBe('White won');
    expect(resultWithEnding(game('*', undefined))).toBe('Unfinished');
    expect(ENDING_LABEL.abandoned).toBe('Abandoned');
    // As in a real chess.com game: White, with a rook, ran out of time against a bare king.
    const flagged = { ...game('1/2-1/2', 'time-insufficient'), plies: 146, pgn: '' } as GameRecord;
    expect(resultWithEnding(flagged)).toBe('Draw: ana ran out of time, but ben could not have forced checkmate');
    expect(resultWithEnding({ ...flagged, plies: 145 })).toBe('Draw: ben ran out of time, but ana could not have forced checkmate');
  });
});
