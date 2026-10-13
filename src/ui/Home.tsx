import { memo, useMemo, useState } from 'react';
import { FETCH_EVERY_HOURS } from '../config';
import { checkForGames, useAccount } from '../lib/account';
import {
  DEPTHS,
  canDeepen,
  cancelReviews,
  deepenRemaining,
  isReviewed,
  pauseDeepening,
  removeGames,
  requestReview,
  resetEngine,
  resumeDeepening,
  reviewSetting,
  updateSettings,
  useStore,
  type DepthPreset,
  type GameSort,
  type Progress,
} from '../lib/store';
import { ENDING_LABEL } from '../lib/ending';
import type { GameRecord, TimeClass } from '../lib/types';
import { ImportForm } from './ImportForm';
import { OUTCOME_LABEL, TIME_CLASS_LABEL, agoLabel, fold, gameDateLabel, perspective, resultMark, timeLabel } from './format';
import { outcomeFor, resolvePlayer } from '../lib/insights';
import { href } from './router';
import { Welcome } from './Welcome';

export function Home() {
  const ready = useStore((s) => s.ready);
  const games = useStore((s) => s.games);
  if (!ready) return <p className="muted">Opening your games…</p>;
  return games.length === 0 ? <Welcome /> : <Library games={games} />;
}

const SORTS: Record<GameSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  added: 'Recently added',
  best: 'Best accuracy',
  worst: 'Worst accuracy',
};

const TIME_CLASSES = Object.keys(TIME_CLASS_LABEL) as TimeClass[];

/** The accuracy a game is sorted by: the player's own, or both sides' average when the side is unknown. */
function sortAccuracy(game: GameRecord, player: string): number | null {
  if (!isReviewed(game)) return null;
  const side = perspective(game, player);
  const acc = game.review!.accuracy;
  return side ? acc[side] : (acc.w + acc.b) / 2;
}

/** Everything a search can match in one game: players, opening, time control, date and outcome. */
function searchText(game: GameRecord, player: string): string {
  const side = perspective(game, player);
  const outcome = side ? outcomeFor(game, side) : null;
  return fold(
    [
      game.white.name,
      game.black.name,
      game.review?.opening?.name,
      game.review?.opening?.eco,
      timeLabel(game),
      TIME_CLASS_LABEL[game.timeClass],
      gameDateLabel(game),
      outcome && `${OUTCOME_LABEL[outcome].verb} ${outcome}`,
      game.ending && ENDING_LABEL[game.ending],
      side === 'w' ? 'white' : side === 'b' ? 'black' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function progressOf(active: Progress[], id: string): number | null {
  const a = active.find((p) => p.id === id);
  return a ? a.done / a.total : null;
}

function Library({ games }: { games: GameRecord[] }) {
  const queue = useStore((s) => s.queue);
  const active = useStore((s) => s.active);
  const engine = useStore((s) => s.engine);
  const engineError = useStore((s) => s.engineError);
  const failures = useStore((s) => s.failures);
  const settings = useStore((s) => s.settings);
  const slow = useStore((s) => s.slowEngine);
  const deepening = useStore((s) => s.deepening);
  const deepenPaused = useStore((s) => s.deepenPaused);
  const accountStatus = useAccount((s) => s.status);
  const linked = useAccount((s) => s.accounts);
  const checking = useAccount((s) => s.checking);
  const lastAdded = useAccount((s) => s.lastAdded);
  const syncError = useAccount((s) => s.syncError);
  const signedIn = accountStatus === 'signed-in';
  const lastChecked = linked.reduce<number | null>((max, a) => (a.lastFetchedAt && (!max || a.lastFetchedAt > max) ? a.lastFetchedAt : max), null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [adding, setAdding] = useState(false);
  const player = useMemo(() => resolvePlayer(games, settings.player), [games, settings.player]);
  const [query, setQuery] = useState('');
  const [timeClass, setTimeClass] = useState<TimeClass | 'all'>('all');
  const classes = useMemo(() => TIME_CLASSES.filter((c) => games.some((g) => g.timeClass === c)), [games]);
  // Built once per change to the games, not on every keystroke.
  const index = useMemo(() => new Map(games.map((g) => [g.id, searchText(g, player)])), [games, player]);
  const visible = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const list = games.filter(
      (g) => (timeClass === 'all' || g.timeClass === timeClass) && words.every((w) => index.get(g.id)!.includes(w)),
    );
    const sort = settings.sort;
    if (sort === 'newest') return list; // The store keeps games newest first.
    if (sort === 'oldest') return [...list].reverse();
    if (sort === 'added') return [...list].sort((a, b) => b.addedAt - a.addedAt);
    // Unreviewed games go last whichever way accuracy is sorted.
    return [...list].sort((a, b) => {
      const x = sortAccuracy(a, player);
      const y = sortAccuracy(b, player);
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
      return sort === 'best' ? y - x : x - y;
    });
  }, [games, index, query, timeClass, settings.sort, player]);
  const filtered = visible.length !== games.length;
  const clearFilters = () => {
    setQuery('');
    setTimeClass('all');
  };

  const pending = useMemo(() => games.filter((g) => !isReviewed(g)), [games]);
  const reviewedCount = games.length - pending.length;
  const working = active.length > 0 || queue.length > 0;
  const activeGame = active.length === 1 ? games.find((g) => g.id === active[0].id) : undefined;
  const remaining = queue.length + active.length;
  // With several engines at work, the bar shows how far along they are together.
  const activeShare = active.length ? active.reduce((sum, a) => sum + a.done / a.total, 0) / active.length : 0;
  const preset = DEPTHS[settings.depth];
  // The backup engine cannot look further than it already did, so it offers nothing to redo.
  const lighter = useMemo(() => (slow ? [] : games.filter((g) => canDeepen(g, settings.depth))), [games, slow, settings.depth]);
  const queued = useMemo(() => new Set(queue), [queue]);
  // Background Deep reviews: what is left, and the game under way.
  const deepenIdle = settings.deepenIdle && !slow;
  const toDeepen = useMemo(() => (deepenIdle ? deepenRemaining(games) : 0), [deepenIdle, games, deepening]);
  const deepGame = deepening ? games.find((g) => g.id === deepening.id) : undefined;

  return (
    <>
      <div className="list-head">
        <h1>Games</h1>
        {signedIn && linked.length > 0 && (
          <button className="btn quiet" type="button" disabled={checking} onClick={() => void checkForGames(true)}>
            {checking ? 'Checking…' : 'Check for new games'}
          </button>
        )}
        <button className="btn quiet" type="button" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : 'Add games'}
        </button>
        <select
          className="select"
          value={settings.depth}
          onChange={(e) => updateSettings({ depth: e.target.value as DepthPreset })}
          aria-label="How deeply to review"
          aria-describedby="depth-note"
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

      <p className="depth-note" id="depth-note">
        <b>{preset.label} review:</b> {preset.hint} {preset.summary} <a href={href('about')}>How the settings differ</a>
      </p>
      {!slow && (
        <label className="depth-note check">
          <input type="checkbox" checked={settings.deepenIdle} onChange={(e) => updateSettings({ deepenIdle: e.target.checked })} />
          <span>
            Give every game a Deep review in the background while this tab is open. It uses one core, gives way when you ask for a
            review, and pauses on battery. Best on a laptop that is plugged in.
          </span>
        </label>
      )}

      {adding && <ImportForm compact />}

      {games.length > 1 && (
        <div className="list-tools">
          <input
            className="input list-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by player, opening or date"
            aria-label="Search your games"
          />
          {classes.length > 1 && (
            <select className="select" value={timeClass} onChange={(e) => setTimeClass(e.target.value as TimeClass | 'all')} aria-label="Time control">
              <option value="all">All speeds</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {TIME_CLASS_LABEL[c]}
                </option>
              ))}
            </select>
          )}
          <select className="select" value={settings.sort} onChange={(e) => updateSettings({ sort: e.target.value as GameSort })} aria-label="Order games by">
            {(Object.keys(SORTS) as GameSort[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s]}
              </option>
            ))}
          </select>
        </div>
      )}

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
                  : active.length > 1
                    ? `Reviewing ${active.length} games at once`
                    : activeGame
                      ? `Reviewing ${activeGame.white.name} against ${activeGame.black.name}`
                      : 'Reviewing…'}
              </span>
              <span className="num">{remaining} to go</span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label={active.length > 1 ? 'Games being reviewed' : 'Current game'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(activeShare * 100)}
            >
              <i style={{ width: `${activeShare * 100}%` }} />
            </div>
          </>
        ) : (
          <p>
            {filtered && visible.length > 0 && (
              <>
                Showing {visible.length} of {games.length}.{' '}
                <button className="linklike" type="button" onClick={clearFilters}>
                  Show all
                </button>
                <br />
              </>
            )}
            {signedIn && lastAdded !== null && lastAdded > 0 && (
              <>
                {lastAdded} new {lastAdded === 1 ? 'game' : 'games'} came in.{' '}
              </>
            )}
            {games.length} {games.length === 1 ? 'game' : 'games'}, {reviewedCount} reviewed.{' '}
            {reviewedCount >= 3 && <a href={href('insights')}>See what they have in common</a>}
            {deepenIdle ? (
              deepenPaused ? (
                <>
                  <br />
                  Background Deep reviews are paused.{' '}
                  <button className="linklike" type="button" onClick={resumeDeepening}>
                    Resume
                  </button>
                </>
              ) : deepening && deepGame ? (
                <>
                  <br />
                  <span className="num">
                    Deep review in the background: {deepGame.white.name} against {deepGame.black.name},{' '}
                    {Math.round((deepening.done / deepening.total) * 100)}%{toDeepen > 1 ? `, ${toDeepen - 1} more after it` : ''}.
                  </span>{' '}
                  Keep this tab open.{' '}
                  <button className="linklike" type="button" onClick={pauseDeepening}>
                    Pause
                  </button>
                </>
              ) : (
                toDeepen > 0 && (
                  <>
                    <br />
                    {toDeepen === 1 ? 'One game' : `${toDeepen} games`} will get a Deep review in the background while this tab is open.
                  </>
                )
              )
            ) : (
              lighter.length > 0 && (
                <>
                  <br />
                  {lighter.length === 1 ? 'One was' : `${lighter.length} were`} reviewed at a lighter setting.{' '}
                  <button className="linklike" type="button" onClick={() => requestReview(lighter.map((g) => g.id), { again: true })}>
                    Review {lighter.length === 1 ? 'it' : 'them'} again with {preset.label}
                  </button>
                </>
              )
            )}
          </p>
        )}
      </div>

      {visible.length === 0 && (
        <p className="muted list-empty">
          No games match{query.trim() ? ` “${query.trim()}”` : ''}
          {timeClass !== 'all' ? ` in ${TIME_CLASS_LABEL[timeClass].toLowerCase()}` : ''}.{' '}
          <button className="linklike" type="button" onClick={clearFilters}>
            Show all games
          </button>
        </p>
      )}

      <ul className="games">
        {visible.map((g) => (
          <GameRow
            key={g.id}
            game={g}
            player={player}
            progress={progressOf(active, g.id)}
            queued={queued.has(g.id)}
            failure={failures[g.id]}
          />
        ))}
      </ul>

      <div className="list-foot">
        {signedIn ? (
          <span>
            {syncError ? (
              <span className="error-text">{syncError}</span>
            ) : linked.length > 0 ? (
              <>
                Saved to your account. New games come in every {FETCH_EVERY_HOURS} hours{lastChecked ? `; last checked ${agoLabel(lastChecked)}` : ''}.
              </>
            ) : (
              <>
                Saved to your account. Get games by username and new ones will come in every {FETCH_EVERY_HOURS} hours.
              </>
            )}{' '}
            <a href={href('account')}>Account</a>
          </span>
        ) : accountStatus === 'signed-out' ? (
          <span>
            Reviews are saved in this browser only. <a href={href('signup')}>Create an account</a> to keep them on every device and get new games
            every {FETCH_EVERY_HOURS} hours.
          </span>
        ) : (
          <span>Reviews are saved in this browser. Nothing is uploaded.</span>
        )}
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

/** One game in the list. Memoised: while reviews run, only the rows whose progress changes are drawn again. */
const GameRow = memo(function GameRow({ game, player, progress, queued, failure }: RowProps) {
  const side = perspective(game, player);
  const outcome = side ? outcomeFor(game, side) : null;
  const reviewed = isReviewed(game);
  const opponent = side === 'w' ? game.black : side === 'b' ? game.white : null;
  const time = timeLabel(game);

  return (
    <li className="game">
      {outcome ? (
        <span className={`res ${outcome}`} title={OUTCOME_LABEL[outcome].verb}>
          <span aria-hidden="true">{OUTCOME_LABEL[outcome].letter}</span>
          <span className="visually-hidden">{OUTCOME_LABEL[outcome].verb}</span>
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
        {reviewed && game.review!.opening ? <a href={href('dictionary', 'opening', game.review!.opening.name)}>{game.review!.opening.name}</a> : <span>{Math.ceil(game.plies / 2)} moves</span>}
        {game.ending && <span>{ENDING_LABEL[game.ending]}</span>}
        {time && <span>{time}</span>}
        <span>{gameDateLabel(game)}</span>
      </span>
      <span className="end">
        {progress !== null ? (
          <span className="mini-progress">
            <small className="num">{Math.round(progress * 100)}%</small>
            <span className="progress">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        ) : reviewed ? (
          <span className="acc" title={`Accuracy, from a ${reviewSetting(game.review!)}${queued ? '. Queued to be reviewed again' : ''}`}>
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
});
