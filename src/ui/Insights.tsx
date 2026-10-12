import { useMemo, useState, type ReactNode } from 'react';
import { MARK_LABEL, MARK_ORDER, PHASE_LABEL, moveLabel } from '../lib/explain';
import { buildInsights, colorOf, extremes, insightPlayers, outcomeFor, resolvePlayer, type Insights as InsightsData, type RatingStat, type TrendPoint } from '../lib/insights';
import { isReviewed, requestReview, updateSettings, useStore } from '../lib/store';
import type { GameRecord } from '../lib/types';
import { MarkTag } from './MarkTag';
import { OUTCOME_LABEL, TIME_CLASS_LABEL, dateLabel, gameDateLabel, perspective } from './format';
import { useWidth } from './hooks';
import { IconChevron } from './icons';
import { href, navigate } from './router';

export function Insights() {
  const ready = useStore((s) => s.ready);
  const games = useStore((s) => s.games);
  const stored = useStore((s) => s.settings.player);
  const working = useStore((s) => s.active.length > 0 || s.queue.length > 0);

  const names = useMemo(() => insightPlayers(games), [games]);
  // A name chosen before that is no longer offered (an opponent, say) gives way to the first one that is.
  const resolved = resolvePlayer(games, stored);
  const player = names.some((n) => n.name === resolved) ? resolved : names[0]?.name || resolved;
  const data = useMemo(() => (player ? buildInsights(games, player) : null), [games, player]);

  if (!ready) return <p className="muted">Opening your games…</p>;

  if (games.length === 0 || !data) {
    return (
      <div className="empty">
        <h2>Insights need some games.</h2>
        <p>Get your recent games first. Once a few are reviewed, this page shows what they have in common: where you lose accuracy, which errors repeat, and how the clock affects you.</p>
        <a className="btn" href={href()}>
          Get games
        </a>
      </div>
    );
  }

  const pending = games.filter((g) => !isReviewed(g) && colorOf(g, player));
  const options = names.length > 0 ? names.slice(0, 12) : [{ name: player, games: 0 }];

  return (
    <>
      <div className="ins-head">
        {options.length > 1 ? (
          <>
            <h1>Insights for</h1>
            <select className="select" value={player} onChange={(e) => updateSettings({ player: e.target.value })} aria-label="Player">
              {options.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <h1>Insights for {player}</h1>
        )}
      </div>
      <div className="ins-sub">
        <span>
          {data.reviewed} of {data.games} games reviewed
        </span>
        {pending.length > 0 && !working && (
          <button className="btn quiet small" type="button" onClick={() => requestReview(pending.map((g) => g.id))}>
            Review the other {pending.length}
          </button>
        )}
        {working && <span>Reviewing more games now. This page updates as they finish.</span>}
      </div>

      {data.reviewed === 0 ? (
        <div className="empty">
          <h2>No reviewed games yet.</h2>
          <p>Each review takes a few seconds. Start them here and come back, or open any game to review it on its own.</p>
        </div>
      ) : (
        <Report data={data} games={games} player={player} />
      )}
    </>
  );
}

function Report({ data, games, player }: { data: InsightsData; games: GameRecord[]; player: string }) {
  const { record } = data;
  const phases = extremes(
    data.byPhase.filter((p) => p.moves >= 10),
    (p) => p.accuracy,
  );
  // Only point at a phase when it is clearly behind the others.
  const weakPhase = phases && phases.high.accuracy - phases.low.accuracy >= 4 ? phases.low.phase : null;
  const clockRows = data.byClock.filter((b) => b.moves > 0);
  // Only point at one part of the clock when there is another to compare it with.
  const comparableClock = clockRows.filter((b) => b.moves >= 10);
  const worstClock = comparableClock.length >= 2 ? extremes(comparableClock, (b) => b.rate)!.high : null;
  const maxRate = Math.max(5, ...clockRows.map((b) => b.rate));
  const topMotif = data.motifs[0]?.count ?? 0;

  return (
    <>
      {data.takeaways.length > 0 ? (
        <ul className="takeaways">
          {data.takeaways.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="ins-sub" style={{ marginTop: -8 }}>
          {data.reviewed < 5 ? 'Patterns start to show from about five reviewed games, and settle from around ten.' : 'No strong pattern stands out yet in these games.'}
        </p>
      )}

      <div className="figures">
        <div className="figure">
          <div className="label">Average accuracy</div>
          <div className="value">
            {data.accuracy.toFixed(1)}
            <small>%</small>
          </div>
          <div className="note-line">
            White {data.byColor.w.games ? data.byColor.w.accuracy.toFixed(1) : '–'}, Black {data.byColor.b.games ? data.byColor.b.accuracy.toFixed(1) : '–'}
          </div>
        </div>
        <div className="figure">
          <div className="label">Results</div>
          <div className="value">
            {record.wins}
            <small> won </small>
            {record.losses}
            <small> lost</small>
          </div>
          <div className="note-line">{record.draws === 1 ? '1 draw' : `${record.draws} draws`}</div>
        </div>
        {data.ratings.length > 0 && <RatingFigure ratings={data.ratings} />}
        <div className="figure">
          <div className="label">Errors per game</div>
          <div className="value">{data.errorsPerGame.toFixed(1)}</div>
          <div className="note-line">Inaccuracies, mistakes, blunders and missed chances</div>
        </div>
      </div>

      <div className="panels">
        {data.reviewed >= 2 && (
          <section className="panel wide">
            <h2>Every game, one line</h2>
            <p className="hint">
              All {data.reviewed} reviewed games, newest at the top. Each peak is one of your moves that gave away winning chances: the taller,
              the more it cost. Select a line to open that game.
            </p>
            <Pulse games={games} player={player} />
          </section>
        )}

        {data.trend.length >= 2 && (
          <section className="panel wide">
            <h2>Accuracy, game by game</h2>
            <p className="hint">Oldest on the left. Select a point to open that game.</p>
            <TrendChart points={data.trend} average={data.accuracy} />
          </section>
        )}

        <section className="panel">
          <h2>Accuracy by phase</h2>
          <p className="hint">
            Average accuracy of your moves in each part of the game, while it was still undecided. Book moves and moves made once the game
            was already won or lost are left out. The light bar is your weakest phase, when one
            is clearly behind the others.
          </p>
          <Bars
            max={100}
            rows={data.byPhase.map((p) => ({
              key: p.phase,
              label: PHASE_LABEL[p.phase],
              value: p.moves ? p.accuracy : null,
              text: p.moves ? `${p.accuracy.toFixed(1)}%` : '–',
              detail: `${p.moves} moves`,
              emphasis: weakPhase === p.phase,
              flag: weakPhase === p.phase ? 'Weakest phase' : undefined,
            }))}
          />
        </section>

        <section className="panel">
          <h2>Errors and the clock</h2>
          <p className="hint">
            Mistakes, blunders and missed chances per 100 moves, by how much of your starting time was left. The light bar is where you err
            most often.
          </p>
          {clockRows.length === 0 ? (
            <p className="muted">These games have no clock times recorded.</p>
          ) : (
            <Bars
              max={maxRate}
              rows={data.byClock.map((b) => ({
                key: b.key,
                label: b.label,
                value: b.moves ? b.rate : null,
                text: b.moves ? b.rate.toFixed(1) : '–',
                detail: `${b.errors} in ${b.moves} moves`,
                emphasis: worstClock?.key === b.key && b.rate > 0,
                flag: worstClock?.key === b.key && b.rate > 0 ? 'Most errors' : undefined,
              }))}
            />
          )}
        </section>

        <section className="panel">
          <h2>Where the errors come from</h2>
          <p className="hint">
            The patterns behind your errors that can be named, counted once each time they happen. Inaccuracies count as well as mistakes and
            blunders; moves made once the game was already lost do not. Open one to see the latest positions.
          </p>
          {data.motifs.length === 0 ? <p className="muted">No named pattern in these games.</p> : <Motifs data={data} top={topMotif} />}
        </section>

        <section className="panel">
          <h2>How your moves were marked</h2>
          <p className="hint">All {data.moves} of your moves in the reviewed games.</p>
          <table className="table">
            <tbody>
              {MARK_ORDER.filter((m) => data.marks[m] > 0).map((m) => (
                <tr key={m}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <MarkTag mark={m} labelled />
                      {MARK_LABEL[m]}
                    </span>
                  </td>
                  <td>{data.marks[m]}</td>
                  <td className="muted">{((data.marks[m] / data.moves) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {data.openings.length > 0 && (
          <section className="panel wide">
            <h2>Openings</h2>
            <p className="hint">Grouped by opening family, most played first.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Opening</th>
                    <th scope="col">Games</th>
                    <th scope="col">
                      <abbr title="Won, drawn, lost">W–D–L</abbr>
                    </th>
                    <th scope="col">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openings.slice(0, 12).map((o) => (
                    <tr key={`${o.color}${o.name}`}>
                      <td>
                        <span className={`side-chip ${o.color}`} role="img" aria-label={o.color === 'w' ? 'As White' : 'As Black'} />
                        <a href={href('dictionary', 'family', o.name)}>{o.name}</a>
                      </td>
                      <td>{o.games}</td>
                      <td>
                        {o.wins}–{o.draws}–{o.losses}
                      </td>
                      <td>{o.accuracy.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** "+35", "−12", "±0". */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** The rating in the time control played most, how it moved across these games, and the others in brief. */
function RatingFigure({ ratings }: { ratings: RatingStat[] }) {
  const [main, ...others] = ratings;
  return (
    <div className="figure">
      <div className="label">{TIME_CLASS_LABEL[main.timeClass]} rating</div>
      <div className="value">{main.latest}</div>
      <div className="note-line">
        {main.games > 1 ? `${signed(main.change)} over ${main.games} games` : 'From one game'}
        {others.slice(0, 2).map((r) => `, ${TIME_CLASS_LABEL[r.timeClass]} ${r.latest}`)}
      </div>
    </div>
  );
}

interface BarRow {
  key: string;
  label: ReactNode;
  value: number | null;
  text: string;
  detail?: string;
  emphasis?: boolean;
  /** Says why the row is highlighted. */
  flag?: string;
}

/** Horizontal bars from a shared baseline, each labelled with its value. */
function Bars({ rows, max }: { rows: BarRow[]; max: number }) {
  return (
    <div className="bars" role="list">
      {rows.map((r) => (
        <div className="bar-row" role="listitem" key={r.key}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track" aria-hidden="true">
            {r.value !== null && <i className={r.emphasis ? 'emph' : undefined} style={{ width: `${Math.max(0.5, Math.min(100, (r.value / max) * 100))}%` }} />}
          </span>
          <span className="bar-value num">{r.text}</span>
          {(r.detail || r.flag) && (
            <span className="bar-detail num">
              {r.detail}
              {r.flag && <b className="bar-flag">{r.flag}</b>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Motifs({ data, top }: { data: InsightsData; top: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="motifs">
      {data.motifs.map((m) => (
        <li key={m.key}>
          <button className="motif-btn" type="button" aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)}>
            <span>{m.label}</span>
            <span className="count">{m.count}</span>
            <IconChevron />
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${(m.count / top) * 100}%` }} />
            </span>
          </button>
          {open === m.key && (
            <ul className="examples">
              {m.examples.map((ex) => (
                <li key={`${ex.gameId}${ex.ply}`}>
                  <a href={href('game', ex.gameId, ex.ply)}>
                    <b>{moveLabel(ex)}</b>{' '}
                    against {ex.opponent}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Dot({ point, cx, cy, active }: { point: TrendPoint; cx: number; cy: number; active: boolean }) {
  const r = active ? 6 : 4.5;
  if (point.outcome === 'loss') return <circle cx={cx} cy={cy} r={r - 1} fill="var(--ground-2)" stroke="var(--ink)" strokeWidth="2" />;
  return <circle cx={cx} cy={cy} r={r} fill={point.outcome === 'win' ? 'var(--ink)' : 'var(--ink-3)'} stroke="var(--ground-2)" strokeWidth="2" />;
}

function TrendChart({ points, average }: { points: TrendPoint[]; average: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const m = { l: 34, r: 14, t: 14, b: 26 };
  const low = Math.min(...points.map((p) => p.accuracy));
  const floor = Math.max(0, Math.min(60, Math.floor((low - 5) / 10) * 10));
  const innerW = Math.max(10, width - m.l - m.r);
  const innerH = H - m.t - m.b;
  const x = (i: number) => m.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => m.t + (1 - (v - floor) / (100 - floor)) * innerH;
  const ticks: number[] = [];
  for (let t = floor; t <= 100; t += floor >= 40 ? 10 : 20) ticks.push(t);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(' ');
  const nearest = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i;
    return best;
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <svg
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`Accuracy in each of ${points.length} games, averaging ${average.toFixed(1)} percent. The games list has the same numbers.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => navigate('game', points[nearest(e.clientX, e.currentTarget.getBoundingClientRect())].gameId)}
        style={{ cursor: 'pointer' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--seam)" strokeWidth="1" />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={width - m.r} y1={y(average)} y2={y(average)} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="4 4" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--seam-strong)" strokeWidth="1" />}
        <path d={path} fill="none" stroke="var(--route-under)" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path} fill="none" stroke="var(--route)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <Dot key={p.gameId} point={p} cx={x(i)} cy={y(p.accuracy)} active={hover === i} />
        ))}
        <text x={m.l} y={H - 6} textAnchor="start">
          {dateLabel(points[0].playedAt)}
        </text>
        <text x={width - m.r} y={H - 6} textAnchor="end">
          {dateLabel(points[points.length - 1].playedAt)}
        </text>
      </svg>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: Math.max(90, Math.min(width - 90, x(hover))), top: y(h.accuracy) - 12 }}>
          <b>{h.accuracy.toFixed(1)}%</b> {OUTCOME_LABEL[h.outcome].verb} against {h.opponent}
        </div>
      )}
      <div className="legend" aria-hidden="true">
        <span>
          <svg width="18" height="12" viewBox="0 0 18 12">
            <line x1="0" x2="18" y1="6" y2="6" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Average {average.toFixed(1)}%
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4.5" fill="var(--ink)" />
          </svg>
          Won
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4.5" fill="var(--ink-3)" />
          </svg>
          Drew
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="3.5" fill="none" stroke="var(--ink)" strokeWidth="2" />
          </svg>
          Lost
        </span>
      </div>
    </div>
  );
}

/** How many game lines show before the chart scrolls: fewer on a phone, where each line is taller. */
const PULSE_ROWS_IN_VIEW = { wide: 14, narrow: 8 };

/** Reviewed games of this player, newest first, as one pulse line each. Peaks are the player's costly moves. */
function Pulse({ games, player }: { games: GameRecord[]; player: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const rows = useMemo(
    () =>
      games
        .filter((g) => isReviewed(g) && perspective(g, player))
        .sort((a, b) => b.playedAt - a.playedAt)
        .map((g) => {
          const side = perspective(g, player)!;
          const opponent = side === 'w' ? g.black.name : g.white.name;
          const outcome = outcomeFor(g, side);
          const costly = g.review!.moves.filter((m) => m.color === side && m.loss >= 2).map((m) => ({ move: Math.ceil(m.ply / 2), loss: m.loss }));
          return { game: g, opponent, outcome, costly, length: Math.ceil(g.plies / 2), accuracy: g.review!.accuracy[side] };
        }),
    [games, player],
  );
  // Wide screens keep the names in a gutter; narrow ones give the lines the full width and set each name above its line.
  const narrow = width < 560;
  const left = narrow ? 4 : 190;
  const right = 8;
  const gap = narrow ? 44 : 28;
  const cap = narrow ? 24 : 52;
  const top = narrow ? 44 : 48;
  const H = top + (rows.length - 1) * gap + 14;
  const span = Math.min(80, Math.max(30, ...rows.map((r) => r.length)));
  const x = (move: number) => left + ((move - 0.5) / span) * (width - left - right);
  const sigma = Math.max(3, ((width - left - right) / span) * 0.7);
  const ticks = [10, 20, 30, 40, 50, 60, 70, 80].filter((t) => t < span);
  const lines = useMemo(
    () =>
      rows.map((r, i) => {
        const base = top + i * gap;
        const end = Math.min(width - right, x(Math.min(r.length, span) + 0.5));
        // Each costly move raises a bell curve; past three widths its lift is far below a pixel.
        const peaks = r.costly.filter((c) => c.move <= span).map((c) => ({ at: x(c.move), height: Math.min(cap - 6, c.loss * (narrow ? 1 : 1.7)) }));
        let d = '';
        for (let px = left; px <= end; px += 3) {
          let lift = 0;
          for (const p of peaks) {
            const t = (px - p.at) / sigma;
            if (t > -3 && t < 3) lift += p.height * Math.exp(-t * t);
          }
          d += `${px === left ? 'M' : 'L'}${px.toFixed(1)},${(base - Math.min(lift, cap)).toFixed(1)}`;
        }
        return { d, end, base };
      }),
    // The layout values all follow from `rows` and `width`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, width],
  );

  // Long lists scroll inside the panel; the move numbers stay above them.
  const inView = narrow ? PULSE_ROWS_IN_VIEW.narrow : PULSE_ROWS_IN_VIEW.wide;
  const scrolls = rows.length > inView;
  if (rows.length === 0) return null;
  return (
    <div className="chart pulse">
      <svg className="pulse-axis-row" height="18" viewBox={`0 0 ${width} 18`} aria-hidden="true">
        <text className="pulse-axis" x={narrow ? 0 : left - 10} y="13" textAnchor={narrow ? 'start' : 'end'}>
          move
        </text>
        {ticks.map((t) => (
          <text key={t} className="pulse-axis" x={x(t)} y="13" textAnchor="middle">
            {t}
          </text>
        ))}
      </svg>
      <div
        className={scrolls ? 'pulse-scroll is-scrolling' : 'pulse-scroll'}
        ref={ref}
        style={scrolls ? { maxHeight: top + inView * gap } : undefined}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? `${rows.length} games, scroll for more` : undefined}
      >
      <svg height={H} viewBox={`0 0 ${width} ${H}`} aria-label={`${rows.length} reviewed games, one line each, newest at the top.`}>
        {rows.map((r, i) => {
          const { d, end, base } = lines[i];
          const name = !narrow && r.opponent.length > 20 ? `${r.opponent.slice(0, 19)}…` : r.opponent;
          // An unfinished game is shown like a draw.
          const outcome = OUTCOME_LABEL[r.outcome ?? 'draw'];
          const labelY = narrow ? base - cap - 4 : base;
          return (
            <a key={r.game.id} href={href('game', r.game.id)} aria-label={`${outcome.verb.toLowerCase()} against ${r.opponent}, ${gameDateLabel(r.game)}, accuracy ${r.accuracy.toFixed(1)}%`}>
              <rect x="0" y={base - gap + 4} width={width} height={gap} fill="transparent" />
              <path className="pulse-fill" d={`${d} L${end.toFixed(1)},${H} L${left},${H} Z`} />
              <path className="pulse-line" d={d} />
              <circle className={r.outcome === 'win' ? 'pulse-chip win' : 'pulse-chip'} cx="8" cy={labelY - 4} r="7" />
              <text className="pulse-chip-text" x="8" y={labelY - 1} textAnchor="middle">
                {outcome.letter}
              </text>
              <text className="pulse-label" x="22" y={labelY}>
                {name}
              </text>
            </a>
          );
        })}
      </svg>
      </div>
      {scrolls && <p className="pulse-more">Scroll the list to see all {rows.length} games.</p>}
    </div>
  );
}
