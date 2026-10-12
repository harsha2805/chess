import { useMemo, useState } from 'react';
import { SAMPLE_PGN } from '../config';
import { parsePgn } from '../lib/pgn';
import { DEPTHS, cancelReviews, isReviewed, removeGames, requestReview, resetEngine, updateSettings, useStore, type DepthPreset } from '../lib/store';
import type { GameRecord } from '../lib/types';
import { Board } from './Board';
import { ImportForm, openSample } from './ImportForm';
import { gameDateLabel, perspective, resultMark, timeLabel } from './format';
import { outcomeFor, resolvePlayer } from '../lib/insights';
import { href } from './router';

export function Home() {
  const ready = useStore((s) => s.ready);
  const games = useStore((s) => s.games);
  if (!ready) return <p className="muted">Opening your games…</p>;
  return games.length === 0 ? <Welcome /> : <Library games={games} />;
}

function Welcome() {
  // The position after 16.Qb8+ in the sample game, the most famous queen sacrifice there is.
  const demo = useMemo(() => {
    const move = parsePgn(SAMPLE_PGN).moves[30];
    return { fen: move.fenAfter, from: move.from, to: move.to };
  }, []);

  return (
    <div className="intro">
      <div>
        <h1>See where each game was won and lost.</h1>
        <p className="lede">
          Stockfish goes through your chess.com or Lichess games move by move, and shows what keeps going wrong from one game to the next.
          Free, with no daily limit.
        </p>
        <ImportForm />
      </div>
      <figure className="demo" style={{ margin: 0 }}>
        <Board
          fen={demo.fen}
          orientation="w"
          move={{ from: demo.from, to: demo.to }}
          mark="brilliant"
          label="Morphy against Duke Karl and Count Isouard, Paris 1858, after 16.Qb8+: the white queen gives check on b8, where the knight can take it."
        />
        <figcaption className="caption">
          <b>
            16.Qb8+<span className="ink-brilliant">!!</span>
          </b>{' '}
          White offers the queen, and it works: after 16…Nxb8 comes 17.Rd8 mate. Morphy, Paris 1858.{' '}
          <button className="linklike" type="button" onClick={() => void openSample()}>
            Review this game
          </button>
        </figcaption>
      </figure>
    </div>
  );
}

function Library({ games }: { games: GameRecord[] }) {
  const queue = useStore((s) => s.queue);
  const active = useStore((s) => s.active);
  const engine = useStore((s) => s.engine);
  const engineError = useStore((s) => s.engineError);
  const failures = useStore((s) => s.failures);
  const settings = useStore((s) => s.settings);
  const [confirmClear, setConfirmClear] = useState(false);
  const [adding, setAdding] = useState(false);
  const player = useMemo(() => resolvePlayer(games, settings.player), [games, settings.player]);

  const pending = games.filter((g) => !isReviewed(g));
  const reviewedCount = games.length - pending.length;
  const working = !!active || queue.length > 0;
  const activeGame = active ? games.find((g) => g.id === active.id) : undefined;
  const remaining = queue.length + (active ? 1 : 0);

  return (
    <>
      <div className="list-head">
        <h1>Games</h1>
        <button className="btn quiet" type="button" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : 'Add games'}
        </button>
        <select
          className="select"
          value={settings.depth}
          onChange={(e) => updateSettings({ depth: e.target.value as DepthPreset })}
          aria-label="How deeply to review"
          title={DEPTHS[settings.depth].hint}
        >
          {(Object.keys(DEPTHS) as DepthPreset[]).map((d) => (
            <option key={d} value={d}>
              {DEPTHS[d].label} review
            </option>
          ))}
        </select>
        {working ? (
          <button className="btn quiet" type="button" onClick={cancelReviews}>
            Stop reviewing
          </button>
        ) : (
          pending.length > 0 && (
            <button className="btn" type="button" onClick={() => requestReview(pending.map((g) => g.id))}>
              Review {pending.length === games.length ? 'all' : 'the other'} {pending.length}
            </button>
          )
        )}
      </div>

      {adding && <ImportForm compact />}

      <div className="list-status" aria-live="polite">
        {engine === 'failed' ? (
          <p className="notice error">
            <strong>The chess engine did not start.</strong> {engineError ? `${engineError} ` : ''}
            <button className="linklike" type="button" onClick={resetEngine}>
              Try again
            </button>
          </p>
        ) : working ? (
          <>
            <div className="row">
              <span>
                {engine === 'starting'
                  ? 'Starting the engine…'
                  : activeGame
                    ? `Reviewing ${activeGame.white.name} against ${activeGame.black.name}`
                    : 'Reviewing…'}
              </span>
              <span className="num">{remaining} to go</span>
            </div>
            <div className="progress" role="progressbar" aria-label="Current game" aria-valuemin={0} aria-valuemax={100} aria-valuenow={active ? Math.round((active.done / active.total) * 100) : 0}>
              <i style={{ width: `${active ? (active.done / active.total) * 100 : 0}%` }} />
            </div>
          </>
        ) : (
          <p>
            {games.length} {games.length === 1 ? 'game' : 'games'}, {reviewedCount} reviewed.{' '}
            {reviewedCount >= 3 && <a href={href('insights')}>See what they have in common</a>}
          </p>
        )}
      </div>

      <ul className="games">
        {games.map((g) => (
          <GameRow
            key={g.id}
            game={g}
            player={player}
            progress={active?.id === g.id ? active.done / active.total : null}
            queued={queue.includes(g.id)}
            failure={failures[g.id]}
          />
        ))}
      </ul>

      <div className="list-foot">
        <span>Reviews are saved in this browser. Nothing is uploaded.</span>
        {confirmClear ? (
          <span>
            Remove all {games.length} games and their reviews?{' '}
            <button
              className="linklike"
              type="button"
              onClick={() => {
                void removeGames(games.map((g) => g.id));
                setConfirmClear(false);
              }}
            >
              Remove them
            </button>{' '}
            <button className="linklike" type="button" onClick={() => setConfirmClear(false)}>
              Keep them
            </button>
          </span>
        ) : (
          <button className="linklike" type="button" onClick={() => setConfirmClear(true)}>
            Remove all games
          </button>
        )}
      </div>
    </>
  );
}

interface RowProps {
  game: GameRecord;
  player: string;
  progress: number | null;
  queued: boolean;
  failure?: string;
}

function GameRow({ game, player, progress, queued, failure }: RowProps) {
  const side = perspective(game, player);
  const outcome = side ? outcomeFor(game, side) : null;
  const reviewed = isReviewed(game);
  const opponent = side === 'w' ? game.black : side === 'b' ? game.white : null;
  const chip = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : outcome === 'draw' ? 'D' : null;
  const outcomeWord = outcome === 'win' ? 'Won' : outcome === 'loss' ? 'Lost' : outcome === 'draw' ? 'Drew' : null;

  return (
    <li className="game">
      {chip ? (
        <span className={`res ${outcome}`} title={outcomeWord ?? undefined}>
          <span aria-hidden="true">{chip}</span>
          <span className="visually-hidden">{outcomeWord}</span>
        </span>
      ) : (
        <span className="res" style={{ fontSize: '0.6875rem' }}>
          {resultMark(game.result)}
        </span>
      )}
      <span className="who">
        <a href={href('game', game.id)}>
          {opponent ? (
            <>
              <span className="muted" style={{ fontWeight: 400 }}>
                {side === 'w' ? 'White against' : 'Black against'}{' '}
              </span>
              {opponent.name}
              {opponent.rating ? <span className="rating"> {opponent.rating}</span> : null}
            </>
          ) : (
            <>
              {game.white.name} <span className="muted" style={{ fontWeight: 400 }}>against</span> {game.black.name}
            </>
          )}
        </a>
      </span>
      <span className="sub">
        {reviewed && game.review!.opening ? <span>{game.review!.opening.name}</span> : <span>{Math.ceil(game.plies / 2)} moves</span>}
        {timeLabel(game) && <span>{timeLabel(game)}</span>}
        <span>{gameDateLabel(game)}</span>
      </span>
      <span className="end">
        {reviewed ? (
          <span className="acc" title="Accuracy">
            {side ? (
              <>
                <b>{game.review!.accuracy[side].toFixed(1)}</b>
                <small>them {game.review!.accuracy[side === 'w' ? 'b' : 'w'].toFixed(1)}</small>
              </>
            ) : (
              <>
                <b>{game.review!.accuracy.w.toFixed(1)}</b>
                <small>Black {game.review!.accuracy.b.toFixed(1)}</small>
              </>
            )}
          </span>
        ) : progress !== null ? (
          <span className="mini-progress">
            <small className="num">{Math.round(progress * 100)}%</small>
            <span className="progress">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        ) : queued ? (
          <small className="muted">Queued</small>
        ) : failure ? (
          <small className="muted">{failure}</small>
        ) : (
          <button className="btn quiet small" type="button" onClick={() => requestReview([game.id], { first: true })}>
            Review
          </button>
        )}
      </span>
    </li>
  );
}
