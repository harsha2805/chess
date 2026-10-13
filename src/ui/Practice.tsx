import { Chess, type Move, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { moveLabel } from '../lib/explain';
import { recordsFromPgn } from '../lib/importers';
import { ANALYSIS_DEPTH, BOT_ELO_MIN, ENGINE_ELO_MAX, analyse, botMove, closePractice, startingElo, stopAnalysis, type Analysis } from '../lib/practice';
import { formatScore } from '../lib/score';
import { addGames, holdDeepening, savePracticeLine } from '../lib/store';
import type { Color, GameRecord, ParsedGame, PracticeLine, Result } from '../lib/types';
import { Board, EvalBar } from './Board';
import { IconFirst, IconFlip, IconLast, IconNext, IconPrev } from './icons';
import { navigate } from './router';

export type PracticeMode = 'explore' | 'play';

export interface PracticeStart {
  /** How many moves of the real game come before practice starts. */
  fromPly: number;
  /** Moves already made from there, in SAN: the engine's better move, or a kept line. */
  moves: string[];
  mode: PracticeMode;
  /** The kept line being carried on, if any. */
  line?: PracticeLine;
}

interface Step {
  san: string;
  from: string;
  to: string;
  fen: string;
}

const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');

/** The moves from `fen`, as far as they are legal. */
function replay(fen: string, sans: string[]): Step[] {
  const chess = new Chess(fen);
  const out: Step[] = [];
  for (const san of sans) {
    try {
      const m = chess.move(san);
      out.push({ san: m.san, from: m.from, to: m.to, fen: chess.fen() });
    } catch {
      break;
    }
  }
  return out;
}

/** How a practice game stands at its last position: over, and why, or still going. */
function outcome(baseFen: string, steps: Step[], resigned: Color | null): { result: Result; why: string } | null {
  if (resigned) return { result: resigned === 'w' ? '0-1' : '1-0', why: `${sideName(resigned)} resigned` };
  const chess = new Chess(baseFen);
  for (const s of steps) chess.move(s.san);
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', why: 'Checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', why: 'Stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', why: 'Neither side can mate' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', why: 'The same position came up three times' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', why: 'Fifty moves with no capture or pawn move' };
  return null;
}

/**
 * Playing on from a position of a real game: exploring moves for both sides with Stockfish
 * watching at full strength, or playing one side against the bot. Nothing here changes the
 * game or its review. On the way out, the person keeps the line or the bot game, or forgets it.
 */
export function PracticeView({ game, parsed, start, onExit }: { game: GameRecord; parsed: ParsedGame; start: PracticeStart; onExit: () => void }) {
  const baseFen = start.fromPly > 0 ? parsed.moves[start.fromPly - 1].fenAfter : parsed.startFen;
  const baseTurn = new Chess(baseFen).turn();
  const baseOffset = (Math.max(1, Number(baseFen.split(' ')[5]) || 1) - 1) * 2 + (baseTurn === 'b' ? 1 : 0);
  const [mode, setMode] = useState<PracticeMode>(start.mode);
  const [steps, setSteps] = useState<Step[]>(() => replay(baseFen, start.moves));
  const [cursor, setCursor] = useState(() => replay(baseFen, start.moves).length);
  const [slide, setSlide] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  // In play: the person's side, the bot's strength, whether the engine's view shows, and a resignation.
  const me = game.me ?? baseTurn;
  const [side, setSide] = useState<Color>(me);
  const [elo, setElo] = useState(() => startingElo((me === 'w' ? game.white : game.black).rating));
  const [showEngine, setShowEngine] = useState(start.mode === 'explore');
  const [resigned, setResigned] = useState<Color | null>(null);
  const [thinking, setThinking] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [flipped, setFlipped] = useState(me === 'b');

  // The background reviews wait while the person practises; the practice engines close on the way out.
  useEffect(() => {
    const release = holdDeepening();
    return () => {
      release();
      stopAnalysis();
      closePractice();
    };
  }, []);

  const fen = cursor === 0 ? baseFen : steps[cursor - 1].fen;
  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn = chess.turn();
  const atEnd = cursor === steps.length;
  const over = mode === 'play' ? outcome(baseFen, steps, resigned) : null;
  const myTurn = mode === 'explore' || (turn === side && atEnd && !over && !thinking);

  // Full-strength analysis of the position on the board, while it is shown.
  useEffect(() => {
    if (!showEngine) {
      stopAnalysis();
      setAnalysis(null);
      return;
    }
    setAnalysis(null);
    return analyse(fen, setAnalysis);
  }, [fen, showEngine]);

  const go = (next: number) => {
    const target = Math.max(0, Math.min(steps.length, next));
    setSlide(target === cursor + 1);
    setCursor(target);
    setPicked(null);
  };

  /** Plays a move from the position shown. A different move from one already in the line replaces the rest of it. */
  const play = (m: { from: string; to: string; promotion?: string }) => {
    let made: Move;
    try {
      made = new Chess(fen).move(m);
    } catch {
      return;
    }
    const next = steps[cursor];
    const rest = next && next.san === made.san ? steps : [...steps.slice(0, cursor), { san: made.san, from: made.from, to: made.to, fen: made.after }];
    setSteps(rest);
    setSlide(true);
    setCursor(cursor + 1);
    setPicked(null);
  };

  // The bot answers in play, after a short pause so its move can be seen coming.
  const botToken = useRef(0);
  useEffect(() => {
    if (mode !== 'play' || over || !atEnd || turn === side) return;
    const token = ++botToken.current;
    setThinking(true);
    const started = Date.now();
    botMove(fen, elo)
      .then(async (uci) => {
        const wait = 600 - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (token !== botToken.current) return;
        setThinking(false);
        play({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      })
      .catch(() => token === botToken.current && setThinking(false));
    return () => {
      botToken.current++;
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fen, side, atEnd, !!over]);

  const targets = useMemo<string[]>(() => (picked ? chess.moves({ square: picked as Square, verbose: true }).map((m) => m.to) : []), [picked, chess]);

  const onSquare = (square: string) => {
    if (!myTurn || promotion) return;
    const piece = chess.get(square as Square);
    if (picked && targets.includes(square)) {
      const moving = chess.get(picked as Square);
      if (moving?.type === 'p' && (square[1] === '8' || square[1] === '1')) {
        setPromotion({ from: picked, to: square });
        return;
      }
      play({ from: picked, to: square });
      return;
    }
    setPicked(piece && piece.color === turn && (mode === 'explore' || piece.color === side) ? square : null);
  };

  // The arrow keys step through the line, as on the game itself.
  const goRef = useRef(go);
  goRef.current = go;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') goRef.current(cursorRef.current - 1);
      else if (e.key === 'ArrowRight') goRef.current(cursorRef.current + 1);
      else if (e.key === 'Home') goRef.current(0);
      else if (e.key === 'End') goRef.current(Infinity);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const switchMode = (next: PracticeMode) => {
    if (next === mode) return;
    setMode(next);
    setShowEngine(next === 'explore');
    setResigned(null);
    // A game against the bot carries on from the position on the board, with the person on their own side.
    if (next === 'play') {
      setSteps(steps.slice(0, cursor));
      setSide(me);
    }
  };

  /** Takes back the person's last move in play, and the bot's answer to it. */
  const takeBack = () => {
    let n = steps.length;
    if (n > 0 && new Chess(n === 1 ? baseFen : steps[n - 2].fen).turn() !== side) n--;
    if (n > 0) n--;
    botToken.current++;
    setThinking(false);
    setResigned(null);
    setSteps(steps.slice(0, n));
    setSlide(false);
    setCursor(n);
  };

  const branchLabel = start.fromPly === 0 ? 'the starting position' : `after ${moveLabel(parsed.moves[start.fromPly - 1])}`;
  const engineScore = analysis && analysis.fen === fen ? analysis.score : null;
  const best = analysis && analysis.fen === fen && myTurn ? analysis.lines[0] : undefined;
  const last = cursor > 0 ? steps[cursor - 1] : null;
  const orientation: Color = flipped ? 'b' : 'w';
  const botName = `Stockfish ${elo >= ENGINE_ELO_MAX ? '(full strength)' : elo}`;

  // ---- Keeping or forgetting on the way out ----

  const keepLine = async () => {
    const now = Date.now();
    await savePracticeLine(game.id, {
      id: start.line?.id ?? `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      fromPly: start.fromPly,
      moves: steps.map((s) => s.san),
      createdAt: start.line?.createdAt ?? now,
      updatedAt: now,
    });
    onExit();
  };

  const saveBotGame = async () => {
    const pgnGame = new Chess(baseFen);
    for (const s of steps) pgnGame.move(s.san);
    const mine = side === 'w' ? game.white : game.black;
    const result = over?.result ?? '*';
    const winner = result === '1-0' ? 'w' : result === '0-1' ? 'b' : null;
    const nameOf = (c: Color) => (c === side ? mine.name : 'Stockfish bot');
    const termination = !over
      ? 'Unfinished'
      : winner
        ? `${nameOf(winner)} won ${resigned ? 'by resignation' : 'by checkmate'}`
        : `Game drawn by ${over.why === 'Stalemate' ? 'stalemate' : over.why.startsWith('Neither') ? 'insufficient material' : over.why.startsWith('The same') ? 'repetition' : '50-move rule'}`;
    const headers: Record<string, string> = {
      Event: 'Practice against Stockfish',
      Site: 'ChessDebrief',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: nameOf('w'),
      Black: nameOf('b'),
      Result: result,
      Termination: termination,
      SetUp: '1',
      FEN: baseFen,
    };
    // The bot is named once; its rating goes in the rating header, as for any player.
    if (mine.rating) headers[side === 'w' ? 'WhiteElo' : 'BlackElo'] = String(mine.rating);
    headers[side === 'w' ? 'BlackElo' : 'WhiteElo'] = String(Math.min(elo, ENGINE_ELO_MAX));
    for (const [k, v] of Object.entries(headers)) pgnGame.setHeader(k, v);
    const { records } = recordsFromPgn(pgnGame.pgn(), 'bot');
    const record = records[0];
    if (!record) return onExit();
    const id = `bot:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    // How it ended comes from the Termination header, as for a chess.com game.
    const saved: GameRecord = { ...record, id, me: side, bot: { elo: Math.min(elo, ENGINE_ELO_MAX), from: { id: game.id, ply: start.fromPly } } };
    await addGames([saved]);
    navigate('game', id);
  };

  const leave = () => {
    const changed = start.line ? steps.map((s) => s.san).join(' ') !== start.line.moves.join(' ') : steps.length > 0;
    if (!changed) return onExit();
    setLeaving(true);
  };

  const lineText = (pv: string[], startTurn: Color, ply: number) => {
    let n = Math.floor(ply / 2) + 1;
    let color = startTurn;
    return pv
      .slice(0, 8)
      .map((san, i) => {
        const prefix = color === 'w' ? `${n}. ` : i === 0 ? `${n}… ` : '';
        if (color === 'b') n++;
        color = color === 'w' ? 'b' : 'w';
        return prefix + san;
      })
      .join(' ');
  };
  // Half-moves played before the position shown, for numbering moves as the game does.
  const plyAt = baseOffset + cursor;

  return (
    <div className="review practice">
      <div className="stage">
        <div className="stage-inner">
          <div className="player">
            <span className={`pip ${orientation === 'w' ? 'b' : 'w'}`} aria-hidden="true" />
            <span className="name">{mode === 'play' && side === orientation ? botName : sideName(orientation === 'w' ? 'b' : 'w')}</span>
          </div>
          <div className="board-row">
            {engineScore ? <EvalBar score={engineScore} orientation={orientation} /> : <div className="evalbar" aria-hidden="true" style={{ opacity: 0.35 }} />}
            <Board
              fen={fen}
              orientation={orientation}
              move={last ? { from: last.from, to: last.to } : undefined}
              arrow={best ? { from: best.uci.slice(0, 2), to: best.uci.slice(2, 4) } : undefined}
              animate={slide}
              label={`Practice board, ${sideName(turn)} to move.`}
              onSquare={onSquare}
              selected={picked ?? undefined}
              targets={targets}
            />
          </div>
          <div className="player">
            <span className={`pip ${orientation}`} aria-hidden="true" />
            <span className="name">{mode === 'play' && side !== orientation ? botName : mode === 'play' ? 'You' : sideName(orientation)}</span>
          </div>
        </div>
        {promotion && (
          <div className="promotion" role="group" aria-label="Promote the pawn to">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button key={p} className="btn quiet small" type="button" onClick={() => {
                  play({ ...promotion, promotion: p });
                  setPromotion(null);
                }}>
                {{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}
              </button>
            ))}
          </div>
        )}
        <div className="controls">
          <button className="icon-btn edge" type="button" onClick={() => go(0)} disabled={cursor === 0} aria-label="Back to where practice started" title="Start (Home)">
            <IconFirst />
          </button>
          <button className="icon-btn" type="button" onClick={() => go(cursor - 1)} disabled={cursor === 0} aria-label="Previous move" title="Previous (left arrow)">
            <IconPrev />
          </button>
          <button className="icon-btn" type="button" onClick={() => go(cursor + 1)} disabled={atEnd} aria-label="Next move" title="Next (right arrow)">
            <IconNext />
          </button>
          <button className="icon-btn edge" type="button" onClick={() => go(steps.length)} disabled={atEnd} aria-label="Last move" title="End (End)">
            <IconLast />
          </button>
          <span className="spacer" />
          <button className="icon-btn" type="button" onClick={() => setFlipped((v) => !v)} aria-label="Turn the board round" title="Turn the board round">
            <IconFlip />
          </button>
        </div>
      </div>

      <div className="side">
        <section className="sign practice-sign">
          <p className="practice-tag">Practice: not part of this game or its review</p>
          <div className="practice-modes" role="tablist" aria-label="Practice mode">
            <button type="button" role="tab" aria-selected={mode === 'explore'} onClick={() => switchMode('explore')}>
              Explore
            </button>
            <button type="button" role="tab" aria-selected={mode === 'play'} onClick={() => switchMode('play')}>
              Play against Stockfish
            </button>
          </div>
          <p className="practice-from">
            From {branchLabel}.{' '}
            {mode === 'explore'
              ? 'Move for both sides by tapping a piece and then a square.'
              : over
                ? ''
                : thinking
                  ? `${botName} is thinking…`
                  : turn === side
                    ? 'Your move.'
                    : ''}
          </p>

          {mode === 'play' && (
            <div className="practice-play">
              <label className="practice-elo">
                <span>Bot rating</span>
                <button type="button" className="btn quiet small" onClick={() => setElo((e) => Math.max(BOT_ELO_MIN, e - 10))} aria-label="10 points weaker">
                  −10
                </button>
                <input
                  className="input num"
                  type="number"
                  min={BOT_ELO_MIN}
                  max={ENGINE_ELO_MAX}
                  step={10}
                  value={elo}
                  onChange={(e) => setElo(Math.max(BOT_ELO_MIN, Math.min(ENGINE_ELO_MAX, Number(e.target.value) || BOT_ELO_MIN)))}
                />
                <button type="button" className="btn quiet small" onClick={() => setElo((e) => Math.min(ENGINE_ELO_MAX, e + 10))} aria-label="10 points stronger">
                  +10
                </button>
              </label>
              <p className="hint">
                Starts at your rating in this game. An estimate: the bot plays at about this strength.
                {steps.length === 0 && (
                  <>
                    {' '}
                    You play{' '}
                    <button type="button" className="linklike" onClick={() => setSide(side === 'w' ? 'b' : 'w')}>
                      {sideName(side)}
                    </button>
                    .
                  </>
                )}
              </p>
              <label className="check">
                <input type="checkbox" checked={showEngine} onChange={(e) => setShowEngine(e.target.checked)} />
                <span>Show what Stockfish thinks while you play</span>
              </label>
            </div>
          )}

          {over && (
            <p className="practice-over">
              <b>
                {over.result === '1/2-1/2' ? 'Draw' : (over.result === '1-0') === (side === 'w') ? 'You won' : `${botName} won`}
              </b>
              : {over.why}.
            </p>
          )}

          {showEngine && (
            <div className="practice-engine" aria-live="polite">
              {!analysis || analysis.fen !== fen ? (
                <p className="muted">Stockfish is looking at this position…</p>
              ) : analysis.lines.length === 0 ? (
                <p>The game is over in this position.</p>
              ) : (
                <>
                  <p className="practice-eval">
                    <b className="num">{formatScore(analysis.score)}</b>
                    <span className="muted num">
                      {' '}
                      depth {analysis.depth}
                      {analysis.done ? '' : ` of ${ANALYSIS_DEPTH}`}
                    </span>
                  </p>
                  <ol className="practice-lines">
                    {analysis.lines.map((l, i) => (
                      <li key={i}>
                        <span className="num">{formatScore(l.score)}</span> <span>{lineText(l.pv, turn, plyAt)}</span>
                        {i === 0 && myTurn && !promotion && (
                          <button type="button" className="pill" onClick={() => play({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), promotion: l.uci[4] })}>
                            Play {l.san}
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">{mode === 'play' ? 'This game' : 'This line'}</h2>
          {steps.length === 0 ? (
            <p className="muted">No moves yet.</p>
          ) : (
            <ol className="practice-moves">
              {steps.map((s, i) => {
                const ply = baseOffset + i;
                const color: Color = (i % 2 === 0) === (baseTurn === 'w') ? 'w' : 'b';
                return (
                  <li key={i}>
                    {(color === 'w' || i === 0) && <span className="muted num">{Math.floor(ply / 2) + 1}{color === 'w' ? '.' : '…'}</span>}
                    <button type="button" aria-pressed={cursor === i + 1} onClick={() => go(i + 1)}>
                      {s.san}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="practice-actions">
            {mode === 'play' && !over && steps.length > 0 && (
              <>
                <button type="button" className="btn quiet small" onClick={takeBack} disabled={thinking}>
                  Take back
                </button>
                <button type="button" className="btn quiet small" onClick={() => setResigned(side)}>
                  Resign
                </button>
              </>
            )}
            {mode === 'explore' && steps.length > 0 && (
              <button type="button" className="btn quiet small" onClick={() => {
                  setSteps(steps.slice(0, Math.max(0, cursor - 1)));
                  setSlide(false);
                  setCursor(Math.max(0, cursor - 1));
                }} disabled={cursor === 0}>
                Undo
              </button>
            )}
            <button type="button" className="btn small" onClick={leave}>
              Back to the game
            </button>
          </div>

          {leaving && (
            <div className="practice-leave" role="dialog" aria-label="Keep or forget">
              {mode === 'explore' ? (
                <>
                  <p>
                    <b>Keep this line with the game?</b> It is saved apart from the review, and never changes it or your stats.
                  </p>
                  <button type="button" className="btn small" onClick={() => void keepLine()}>
                    Keep it
                  </button>
                </>
              ) : (
                <>
                  <p>
                    <b>Save this game against {botName}?</b> It is kept with your games against the bot, apart from your real games and
                    stats, and you can review it.
                  </p>
                  <button type="button" className="btn small" onClick={() => void saveBotGame()}>
                    Save it
                  </button>
                </>
              )}
              <button type="button" className="btn quiet small" onClick={onExit}>
                {start.line && mode === 'explore' ? 'Forget the changes' : 'Forget it'}
              </button>
              <button type="button" className="linklike" onClick={() => setLeaving(false)}>
                Carry on
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

