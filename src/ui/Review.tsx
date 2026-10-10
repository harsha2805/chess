import { useEffect, useMemo, useRef, useState } from 'react';
import { ERROR_MARKS, MARK_LABEL, MARK_ORDER, MARK_SUFFIX, clockText, explain, moveLabel, moveNumber, sideName } from '../lib/explain';
import { resolvePlayer } from '../lib/insights';
import { parsePgn } from '../lib/pgn';
import { formatScore } from '../lib/score';
import { isReviewed, requestReview, resetEngine, useStore } from '../lib/store';
import type { Color, GameRecord, GameReview, Mark, MoveReview, ParsedGame } from '../lib/types';
import { Board, EvalBar } from './Board';
import { EvalGraph } from './EvalGraph';
import { MarkTag } from './MarkTag';
import { dateLabel, perspective, resultMark, resultText, timeLabel } from './format';
import { IconExternal, IconFirst, IconFlip, IconLast, IconNext, IconPrev } from './icons';
import { href } from './router';

/** Marks whose colour also tints the move's annotation in the notation. */
const INKED: Mark[] = ['brilliant', 'great', 'inaccuracy', 'miss', 'mistake', 'blunder'];

export function Review({ id, startPly }: { id: string; startPly?: number }) {
  const ready = useStore((s) => s.ready);
  const game = useStore((s) => s.games.find((g) => g.id === id));
  if (!ready) return <p className="muted">Opening the game…</p>;
  if (!game) {
    return (
      <div className="empty">
        <h2>This game is not saved in this browser.</h2>
        <p>Reviews are kept on the device that made them. Get the game again from its username or PGN.</p>
        <a className="btn" href={href()}>
          Go to games
        </a>
      </div>
    );
  }
  return <ReviewGame key={game.id} game={game} startPly={startPly} />;
}

function ReviewGame({ game, startPly }: { game: GameRecord; startPly?: number }) {
  const stored = useStore((s) => s.settings.player);
  const allGames = useStore((s) => s.games);
  const parsed = useMemo<ParsedGame | null>(() => {
    try {
      return parsePgn(game.pgn);
    } catch {
      return null;
    }
  }, [game.pgn]);
  const review = isReviewed(game) ? game.review! : null;
  const total = parsed?.moves.length ?? 0;
  const [ply, setPlyRaw] = useState(() => Math.max(0, Math.min(total, startPly ?? 0)));
  const [flipped, setFlipped] = useState(() => perspective(game, resolvePlayer(allGames, stored)) === 'b');
  const [showBest, setShowBest] = useState(false);

  const setPly = (next: number) => {
    setPlyRaw(Math.max(0, Math.min(total, next)));
    setShowBest(false);
  };
  const plyRef = useRef(ply);
  plyRef.current = ply;

  // Opening a game that has no review yet starts one, ahead of anything queued.
  useEffect(() => {
    if (!isReviewed(game) && parsed) requestReview([game.id], { first: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const current = plyRef.current;
      if (e.key === 'ArrowLeft') setPly(current - 1);
      else if (e.key === 'ArrowRight') setPly(current + 1);
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(total);
      else if (e.key === 'f' || e.key === 'F') setFlipped((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (!parsed) {
    return (
      <div className="empty">
        <h2>This game could not be read.</h2>
        <p>Its PGN is damaged or is not standard chess.</p>
        <a className="btn" href={href()}>
          Go to games
        </a>
      </div>
    );
  }

  const move = ply > 0 ? parsed.moves[ply - 1] : null;
  const moveReview = review && ply > 0 ? review.moves[ply - 1] : null;
  const orientation: Color = flipped ? 'b' : 'w';
  const bestDiffers = !!moveReview?.best && moveReview.best.uci !== moveReview.uci;
  const viewingBest = showBest && bestDiffers && !!move;

  const fen = viewingBest ? move!.fenBefore : move ? move.fenAfter : parsed.startFen;
  const score = review ? (viewingBest ? (ply > 1 ? review.moves[ply - 2].evalAfter : review.startEval) : moveReview ? moveReview.evalAfter : review.startEval) : null;

  const clockFor = (color: Color): number | undefined => {
    for (let i = ply - 1; i >= 0; i--) {
      const m = parsed.moves[i];
      if (m.color === color && m.clock !== undefined) return m.clock;
    }
    return parsed.moves.some((m) => m.clock !== undefined) ? game.timeControl?.base : undefined;
  };

  const top: Color = orientation === 'w' ? 'b' : 'w';
  const boardLabel = move
    ? viewingBest
      ? `Position before ${moveLabel(move)}, with the engine's choice ${moveReview!.best!.san} shown as an arrow.`
      : `Position after ${moveLabel(move)}.`
    : 'Starting position.';

  return (
    <>
      <a className="backlink" href={href()}>
        <IconPrev />
        Games
      </a>
      <header className="review-head">
        <h1>
          {game.white.name} <span className="muted" style={{ fontWeight: 400 }}>against</span> {game.black.name}
        </h1>
        <div className="meta">
          <span>
            {resultText(game)} {game.result !== '*' && <span className="num">({resultMark(game.result)})</span>}
          </span>
          {timeLabel(game) && <span>{timeLabel(game)}</span>}
          <span>{dateLabel(game.playedAt)}</span>
          {review?.opening && <span>{review.opening.name}</span>}
          {game.url && (
            <a href={game.url} target="_blank" rel="noreferrer">
              Original game
              <IconExternal />
            </a>
          )}
        </div>
      </header>

      <div className="review">
        <div className="stage">
          <div className="stage-inner">
          <PlayerBar game={game} color={top} clock={clockFor(top)} accuracy={review?.accuracy[top]} />
          <div className="board-row">
            {score ? <EvalBar score={score} orientation={orientation} /> : <div className="evalbar" aria-hidden="true" style={{ opacity: 0.35 }} />}
            <Board
              fen={fen}
              orientation={orientation}
              move={move && !viewingBest ? { from: move.from, to: move.to } : undefined}
              mark={!viewingBest ? moveReview?.mark : undefined}
              arrow={viewingBest ? { from: moveReview!.best!.uci.slice(0, 2), to: moveReview!.best!.uci.slice(2, 4) } : undefined}
              label={boardLabel}
            />
          </div>
          <PlayerBar game={game} color={orientation} clock={clockFor(orientation)} accuracy={review?.accuracy[orientation]} />
          </div>
          <div className="controls">
            <button className="icon-btn" type="button" onClick={() => setPly(0)} disabled={ply === 0} aria-label="First move" title="Start (Home)">
              <IconFirst />
            </button>
            <button className="icon-btn" type="button" onClick={() => setPly(ply - 1)} disabled={ply === 0} aria-label="Previous move" title="Previous (left arrow)">
              <IconPrev />
            </button>
            <button className="icon-btn" type="button" onClick={() => setPly(ply + 1)} disabled={ply === total} aria-label="Next move" title="Next (right arrow)">
              <IconNext />
            </button>
            <button className="icon-btn" type="button" onClick={() => setPly(total)} disabled={ply === total} aria-label="Last move" title="End (End)">
              <IconLast />
            </button>
            <span className="spacer" />
            <button className="icon-btn" type="button" onClick={() => setFlipped((v) => !v)} aria-label="Turn the board round" title="Turn the board round (F)">
              <IconFlip />
            </button>
          </div>
        </div>

        <div className="side">
          <section className="note" aria-live="polite">
            {review ? (
              <Note game={game} review={review} move={moveReview} showBest={viewingBest} bestDiffers={bestDiffers} onToggleBest={() => setShowBest((v) => !v)} />
            ) : (
              <Waiting game={game} />
            )}
          </section>

          {review && (
            <section>
              <EvalGraph review={review} ply={ply} onSelect={setPly} />
            </section>
          )}

          <section>
            <h2 className="section-title">Moves</h2>
            <Notation parsed={parsed} review={review} ply={ply} onSelect={setPly} result={game.result} />
          </section>

          {review && (
            <section>
              <h2 className="section-title">Summary</h2>
              <Summary game={game} review={review} ply={ply} onSelect={setPly} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function PlayerBar({ game, color, clock, accuracy }: { game: GameRecord; color: Color; clock?: number; accuracy?: number }) {
  const p = color === 'w' ? game.white : game.black;
  return (
    <div className="player">
      <span className={`pip ${color}`} aria-hidden="true" />
      <span className="name">{p.name}</span>
      {p.rating ? <span className="rating num">{p.rating}</span> : null}
      <span className="right">
        {accuracy !== undefined && (
          <span className="acc" title={`${sideName(color)}'s accuracy`}>
            {accuracy.toFixed(1)}
            <span className="muted" style={{ fontWeight: 500 }}>
              %
            </span>
          </span>
        )}
        {clock !== undefined && <span className="clock">{clockText(clock)}</span>}
      </span>
    </div>
  );
}

function Waiting({ game }: { game: GameRecord }) {
  const active = useStore((s) => s.active);
  const queue = useStore((s) => s.queue);
  const engine = useStore((s) => s.engine);
  const engineError = useStore((s) => s.engineError);
  const failure = useStore((s) => s.failures[game.id]);
  const slow = useStore((s) => s.slowEngine);
  const mine = active?.id === game.id ? active : null;

  if (engine === 'failed') {
    return (
      <div className="notice error">
        <strong>The chess engine did not start.</strong> {engineError ?? ''} You can still step through the moves.{' '}
        <button
          className="linklike"
          type="button"
          onClick={() => {
            resetEngine();
            requestReview([game.id], { first: true });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (failure) {
    return (
      <div className="notice error">
        <strong>{failure}</strong>{' '}
        <button className="linklike" type="button" onClick={() => requestReview([game.id], { first: true })}>
          Try again
        </button>
      </div>
    );
  }
  const pct = mine ? Math.round((mine.done / mine.total) * 100) : 0;
  const waiting = !mine && (queue.includes(game.id) || !!active);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p>
        {engine === 'starting' || (!mine && !waiting)
          ? 'Starting the engine…'
          : mine
            ? `Reviewing the game: ${mine.done} of ${mine.total} positions.`
            : 'Waiting for another review to finish…'}
      </p>
      <div className="progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="muted" style={{ fontFamily: 'var(--sans)', fontSize: '0.875rem' }}>
        {slow
          ? 'This preview is running the slow backup engine, so the review takes longer and looks less far ahead than on the live site.'
          : 'Stockfish works from the last move back to the first. You can step through the game while it runs.'}
      </p>
    </div>
  );
}

/** Formats an engine line as running notation: "14.Rd1 Qe6 15.Bxd7+". */
function lineText(firstPly: number, sans: string[]): string {
  return sans
    .map((san, k) => {
      const ply = firstPly + k;
      if (ply % 2 === 1) return `${Math.ceil(ply / 2)}.${san}`;
      return k === 0 ? `${Math.ceil(ply / 2)}…${san}` : san;
    })
    .join(' ');
}

interface NoteProps {
  game: GameRecord;
  review: GameReview;
  move: MoveReview | null;
  showBest: boolean;
  bestDiffers: boolean;
  onToggleBest: () => void;
}

function Note({ game, review, move, showBest, bestDiffers, onToggleBest }: NoteProps) {
  if (!move) {
    return (
      <>
        <div className="note-head">
          <span className="note-move">Starting position</span>
          <span className="note-eval">{formatScore(review.startEval)}</span>
        </div>
        <p>
          {review.opening ? `${review.opening.name}. ` : ''}
          White played at {review.accuracy.w.toFixed(1)}% accuracy and Black at {review.accuracy.b.toFixed(1)}%.
        </p>
        <p className="line">Step through with the arrow keys or the buttons under the board, or pick a move below.</p>
      </>
    );
  }
  const note = explain(move, game);
  const suffix = MARK_SUFFIX[move.mark];
  return (
    <>
      <div className="note-head">
        <span className="note-move">
          {moveLabel(move)}
          {suffix && <span className={`ink-${move.mark}`}>{suffix}</span>}
        </span>
        <span className="note-mark">
          <MarkTag mark={move.mark} labelled />
          {MARK_LABEL[move.mark]}
        </span>
        <span className="note-eval" title="Evaluation after the move, in pawns, from White's side">
          {formatScore(move.evalAfter)}
        </span>
      </div>
      <p>{note.lead}</p>
      {note.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
      {bestDiffers && move.best && (
        <p className="line">
          <b>Better was</b>
          {lineText(move.ply, move.best.pv.slice(0, 4))}{' '}
          <button className="linklike" type="button" onClick={onToggleBest}>
            {showBest ? 'Back to the move played' : 'Show on the board'}
          </button>
        </p>
      )}
      {move.mark !== 'book' && move.follow && move.follow.length > 0 && (
        <p className="line">
          <b>Likely next</b>
          {lineText(move.ply + 1, move.follow)}
        </p>
      )}
    </>
  );
}

interface NotationProps {
  parsed: ParsedGame;
  review: GameReview | null;
  ply: number;
  onSelect: (ply: number) => void;
  result: GameRecord['result'];
}

function Notation({ parsed, review, ply, onSelect, result }: NotationProps) {
  const box = useRef<HTMLDivElement>(null);

  // Keep the current move visible inside the list without scrolling the page.
  useEffect(() => {
    const container = box.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container) return;
    if (!current) {
      container.scrollTop = 0;
      return;
    }
    const top = current.offsetTop - container.offsetTop;
    if (top < container.scrollTop + 8) container.scrollTop = Math.max(0, top - 40);
    else if (top + current.offsetHeight > container.scrollTop + container.clientHeight - 8) {
      container.scrollTop = top + current.offsetHeight - container.clientHeight + 40;
    }
  }, [ply]);

  return (
    <div className="notation" ref={box}>
      {parsed.moves.map((m, i) => {
        const r = review?.moves[i];
        const suffix = r ? MARK_SUFFIX[r.mark] : undefined;
        const showNumber = m.color === 'w' || i === 0;
        return (
          <span key={m.ply}>
            {showNumber && <span className="no">{moveNumber(m.ply)}</span>}
            <button
              type="button"
              className="mv"
              aria-current={ply === m.ply ? 'true' : undefined}
              aria-label={`${moveLabel(m)}${r ? `, ${MARK_LABEL[r.mark]}` : ''}`}
              onClick={() => onSelect(m.ply)}
            >
              {m.san}
              {suffix && r && <span className={`sfx ${INKED.includes(r.mark) ? `ink-${r.mark}` : ''}`}>{suffix}</span>}
            </button>{' '}
          </span>
        );
      })}
      {result !== '*' && <span className="result">{resultMark(result)}</span>}
    </div>
  );
}

function Summary({ game, review, ply, onSelect }: { game: GameRecord; review: GameReview; ply: number; onSelect: (ply: number) => void }) {
  const counts = useMemo(() => {
    const c = { w: {} as Record<Mark, number>, b: {} as Record<Mark, number> };
    for (const m of review.moves) c[m.color][m.mark] = (c[m.color][m.mark] ?? 0) + 1;
    return c;
  }, [review]);

  /** Jumps to the next move of that side with that mark, going round at the end. */
  const jump = (color: Color, mark: Mark) => {
    const hits = review.moves.filter((m) => m.color === color && m.mark === mark).map((m) => m.ply);
    if (hits.length === 0) return;
    onSelect(hits.find((p) => p > ply) ?? hits[0]);
  };

  const rows = MARK_ORDER.filter((mark) => (counts.w[mark] ?? 0) + (counts.b[mark] ?? 0) > 0);
  const cell = (color: Color, mark: Mark) => {
    const n = counts[color][mark] ?? 0;
    if (n === 0) return <td className="zero">0</td>;
    const linked = ERROR_MARKS.includes(mark) || mark === 'brilliant' || mark === 'great';
    return (
      <td>
        {linked ? (
          <button type="button" onClick={() => jump(color, mark)} title={`Go to ${sideName(color)}'s next ${MARK_LABEL[mark].toLowerCase()}`}>
            {n}
          </button>
        ) : (
          n
        )}
      </td>
    );
  };

  return (
    <table className="summary">
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left' }}>
            <span className="visually-hidden">Mark</span>
          </th>
          <th scope="col">{game.white.name}</th>
          <th scope="col">{game.black.name}</th>
        </tr>
      </thead>
      <tbody>
        <tr className="acc-row">
          <th scope="row">Accuracy</th>
          <td>{review.accuracy.w.toFixed(1)}</td>
          <td>{review.accuracy.b.toFixed(1)}</td>
        </tr>
        {rows.map((mark) => (
          <tr key={mark}>
            <th scope="row">
              <span>
                <MarkTag mark={mark} labelled />
                {MARK_LABEL[mark]}
              </span>
            </th>
            {cell('w', mark)}
            {cell('b', mark)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
