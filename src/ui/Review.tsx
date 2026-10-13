import { useEffect, useMemo, useRef, useState } from 'react';
import { MARK_LABEL, MARK_ORDER, MARK_SUFFIX, NOTABLE_MARKS, PHASE_LABEL, clockText, explain, moveLabel, moveNumber, sideName } from '../lib/explain';
import { resolvePlayer } from '../lib/insights';
import { parsePgn } from '../lib/pgn';
import { formatScore } from '../lib/score';
import { AUTOPLAY_SPEEDS, getState, isDeep, isReviewed, requestReview, resetEngine, reviewSetting, reviewShortfall, updateSettings, useStore } from '../lib/store';
import type { Color, GameRecord, GameReview, Mark, MoveReview, ParsedGame } from '../lib/types';
import { Board, EvalBar } from './Board';
import { EvalGraph } from './EvalGraph';
import { MarkTag } from './MarkTag';
import { ENDING_LABEL, resultWithEnding } from '../lib/ending';
import { gameDateLabel, gameSite, perspective, resultMark, timeLabel } from './format';
import { IconExternal, IconFirst, IconFlip, IconLast, IconNext, IconPause, IconPlay, IconPrev } from './icons';
import { href } from './router';

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
  // Read once: following every change to the games list would draw the whole page again each time a review finishes.
  const [flipped, setFlipped] = useState(() => {
    const { games, settings } = getState();
    return perspective(game, resolvePlayer(games, settings.player)) === 'b';
  });
  const [showBest, setShowBest] = useState(false);
  const [playing, setPlaying] = useState(false);
  const speed = useStore((s) => s.settings.autoplay);

  const setPly = (next: number) => {
    setPlyRaw(Math.max(0, Math.min(total, next)));
    setShowBest(false);
  };
  const plyRef = useRef(ply);
  plyRef.current = ply;

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    // Playing from the last move starts the game over.
    if (plyRef.current >= total) setPly(0);
    setPlaying(true);
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  // Each move stays up for the chosen time. Stepping by hand restarts the wait from the new move.
  useEffect(() => {
    if (!playing) return;
    if (ply >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setPly(ply + 1), speed * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ply, speed, total]);

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
      else if (e.key === ' ' && !(target && /^(BUTTON|A)$/.test(target.tagName))) togglePlayRef.current();
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
            <b>{resultWithEnding(game)}</b> {game.result !== '*' && <span className="num">{resultMark(game.result)}</span>}
          </span>
          {timeLabel(game) && <span>{timeLabel(game)}</span>}
          <span>{gameDateLabel(game)}</span>
          {gameSite(game) && <span>{gameSite(game)}</span>}
          {review?.opening && <a href={href('dictionary', 'opening', review.opening.name)}>{review.opening.name}</a>}
          {review && <ReviewSetting game={game} review={review} />}
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
            <button className="icon-btn edge" type="button" onClick={() => setPly(0)} disabled={ply === 0} aria-label="First move" title="Start (Home)">
              <IconFirst />
            </button>
            <button className="icon-btn" type="button" onClick={() => setPly(ply - 1)} disabled={ply === 0} aria-label="Previous move" title="Previous (left arrow)">
              <IconPrev />
            </button>
            <button className="icon-btn" type="button" onClick={() => setPly(ply + 1)} disabled={ply === total} aria-label="Next move" title="Next (right arrow)">
              <IconNext />
            </button>
            <button className="icon-btn edge" type="button" onClick={() => setPly(total)} disabled={ply === total} aria-label="Last move" title="End (End)">
              <IconLast />
            </button>
            <button
              className="icon-btn play"
              type="button"
              onClick={togglePlay}
              disabled={total === 0}
              aria-pressed={playing}
              aria-label={playing ? 'Pause' : 'Play through the moves'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <select
              className="select speed"
              value={speed}
              onChange={(e) => updateSettings({ autoplay: Number(e.target.value) })}
              aria-label="Seconds per move"
              title="Seconds per move"
            >
              {AUTOPLAY_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} s
                </option>
              ))}
            </select>
            <span className="spacer" />
            <button className="icon-btn" type="button" onClick={() => setFlipped((v) => !v)} aria-label="Turn the board round" title="Turn the board round (F)">
              <IconFlip />
            </button>
          </div>
        </div>

        <div className="side">
          <section className="sign" aria-live="polite">
            {review ? (
              <Note game={game} review={review} move={moveReview} showBest={viewingBest} bestDiffers={bestDiffers} onToggleBest={() => {
                  setPlaying(false);
                  setShowBest((v) => !v);
                }} />
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
            <Notation parsed={parsed} review={review} ply={ply} onSelect={setPly} result={game.result} ending={game.ending} />
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
            <small>%</small>
            <span className="visually-hidden"> accuracy</span>
          </span>
        )}
        {clock !== undefined && <span className="clock">{clockText(clock)}</span>}
      </span>
    </div>
  );
}

/**
 * Which setting made the review, and whether the time limit cut it short. Below Deep, a way to
 * give this game a Deep review now, or how far the background review of it has got.
 */
/** The dot between parts of a line, drawn rather than typed, as in the move notes. */
const Sep = () => <span className="sep" aria-hidden="true" />;

function ReviewSetting({ game, review }: { game: GameRecord; review: GameReview }) {
  const slow = useStore((s) => s.slowEngine);
  const active = useStore((s) => s.active.find((a) => a.id === game.id) ?? null);
  const queued = useStore((s) => s.queue.includes(game.id));
  const background = useStore((s) => (s.deepening?.id === game.id ? s.deepening : null));
  const elsewhere = useStore((s) => s.elsewhere[game.id]);
  const notice = useStore((s) => s.notices[game.id]);
  const deepenIdle = useStore((s) => s.settings.deepenIdle);
  const shortfall = reviewShortfall(review);
  const belowDeep = !slow && !isDeep(review);
  const deepNow = () => requestReview([game.id], { first: true, again: true, target: 'deep' });

  if (active) return <span className="num">Reviewing again: {Math.round((active.done / active.total) * 100)}%</span>;
  if (queued) return <span>{reviewSetting(review)}, queued to be reviewed again</span>;
  return (
    <span>
      {reviewSetting(review)}
      {shortfall && <span title={shortfall}>, cut short by the time limit</span>}
      {background ? (
        <>
          <Sep />
          <span className="num">Deep review in the background: {Math.round((background.done / background.total) * 100)}%</span>{' '}
          <button className="linklike" type="button" onClick={deepNow}>
            Finish it now
          </button>
        </>
      ) : (
        belowDeep && (
          <>
            <Sep />
            {elsewhere !== undefined && <>Your other device is giving it a Deep review ({elsewhere}% when last heard). </>}
            <button className="linklike" type="button" onClick={deepNow} title="The most accurate verdict on this game. About a minute on a laptop.">
              Deep review this game now
            </button>
            {deepenIdle && elsewhere === undefined && <> or leave it to the background</>}
          </>
        )
      )}
      {notice && <><Sep />{notice}</>}
    </span>
  );
}

function Waiting({ game }: { game: GameRecord }) {
  const mine = useStore((s) => s.active.find((a) => a.id === game.id) ?? null);
  const busy = useStore((s) => s.active.length > 0);
  const queue = useStore((s) => s.queue);
  const engine = useStore((s) => s.engine);
  const engineError = useStore((s) => s.engineError);
  const failure = useStore((s) => s.failures[game.id]);
  const slow = useStore((s) => s.slowEngine);

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
  const waiting = !mine && (queue.includes(game.id) || busy);
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
  return sans.map((san, k) => (k === 0 || (firstPly + k) % 2 === 1 ? `${moveNumber(firstPly + k)}${san}` : san)).join(' ');
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
        <div className="sign-head">
          <div className="sign-title">
            <h2 className="note-move">Starting position</h2>
            {review.opening && (
              <a className="note-mark" href={href('dictionary', 'opening', review.opening.name)}>
                {review.opening.name}
              </a>
            )}
          </div>
          <span className="note-eval">{formatScore(review.startEval)}</span>
        </div>
        <p className="lead">
          White played at {review.accuracy.w.toFixed(1)}% accuracy and Black at {review.accuracy.b.toFixed(1)}%.
        </p>
        <p>Step through with the arrow keys or the buttons under the board, or pick a stop on the line below.</p>
      </>
    );
  }
  const note = explain(move, game);
  const suffix = MARK_SUFFIX[move.mark];
  return (
    <>
      <div className="sign-head">
        <MarkTag mark={move.mark} />
        <div className="sign-title">
          <h2 className="note-move">
            {moveLabel(move)}
            {suffix}
          </h2>
          <span className="note-mark">
            <a href={href('dictionary', 'mark', move.mark)} title="What this label means">
              {MARK_LABEL[move.mark]}
            </a>
            <span className="sep" aria-hidden="true" />
            <span className="visually-hidden">, </span>
            <a href={href('dictionary', 'term', 'phases')} title="How the phases are decided">
              {PHASE_LABEL[move.phase]}
            </a>
          </span>
        </div>
        <a className="note-eval" href={href('dictionary', 'term', 'evaluation')} title="Evaluation after the move, in pawns, from White's side. What the number means">
          {formatScore(move.evalAfter)}
        </a>
      </div>
      <p className="lead">{note.lead}</p>
      {note.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
      {((bestDiffers && move.best) || (move.mark !== 'book' && move.follow && move.follow.length > 0)) && (
        <div className="sign-lines">
          {bestDiffers && move.best && (
            <p className="line">
              <b>Better was</b>
              {lineText(move.ply, move.best.pv.slice(0, 4))}
              <button className="pill" type="button" onClick={onToggleBest}>
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
        </div>
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
  ending: GameRecord['ending'];
}

function Notation({ parsed, review, ply, onSelect, result, ending }: NotationProps) {
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
    // On phones the list is part of the page. Follow the move only while the list is on screen,
    // so stepping from the board never pulls the page away from what the person is reading.
    if (container.scrollHeight <= container.clientHeight) {
      const rect = container.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) current.scrollIntoView({ block: 'nearest' });
      return;
    }
    // Scroll by whole rows, keeping one row of context around the current move.
    const row = current.closest<HTMLElement>('.nrow') ?? current;
    const starts = [...container.querySelectorAll<HTMLElement>('.nrow')].map((r) => r.offsetTop);
    if (row.offsetTop < container.scrollTop) {
      const want = row.offsetTop - row.offsetHeight;
      container.scrollTop = Math.max(0, ...starts.filter((t) => t <= want));
    } else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) {
      const want = row.offsetTop + row.offsetHeight * 2 - container.clientHeight;
      container.scrollTop = Math.min(container.scrollHeight, ...starts.filter((t) => t >= want));
    }
  }, [ply]);

  const rows: [ParsedGame['moves'][number] | undefined, ParsedGame['moves'][number] | undefined][] = [];
  parsed.moves.forEach((m, i) => {
    if (m.color === 'w' || i === 0) rows.push(m.color === 'w' ? [m, undefined] : [undefined, m]);
    else rows[rows.length - 1][1] = m;
  });

  const cell = (m: ParsedGame['moves'][number] | undefined) => {
    if (!m) return <span />;
    const r = review?.moves[m.ply - 1];
    return (
      <button
        type="button"
        className="mv"
        aria-current={ply === m.ply ? 'true' : undefined}
        aria-label={`${moveLabel(m)}${r ? `, ${MARK_LABEL[r.mark]}` : ''}`}
        onClick={() => onSelect(m.ply)}
      >
        {r && NOTABLE_MARKS.includes(r.mark) && <MarkTag mark={r.mark} labelled />}
        {m.san}
      </button>
    );
  };

  return (
    <div className="notation" ref={box}>
      {rows.map(([w, b]) => (
        <div className="nrow" key={(w ?? b)!.ply}>
          <span className="no">{Math.ceil((w ?? b)!.ply / 2)}</span>
          {cell(w)}
          {cell(b)}
        </div>
      ))}
      {result !== '*' && (
        <span className="result">
          {resultMark(result)}
          {ending && <span className="result-why">{ENDING_LABEL[ending]}</span>}
        </span>
      )}
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
    return (
      <td>
        {NOTABLE_MARKS.includes(mark) ? (
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
          <th scope="col" title={game.white.name}>
            {game.white.name}
          </th>
          <th scope="col" title={game.black.name}>
            {game.black.name}
          </th>
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
