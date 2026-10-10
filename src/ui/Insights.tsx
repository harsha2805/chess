import { useMemo, useState, type ReactNode } from 'react';
import { MARK_LABEL, MARK_ORDER } from '../lib/explain';
import { buildInsights, playerNames, resolvePlayer, type Insights as InsightsData, type TrendPoint } from '../lib/insights';
import { isReviewed, requestReview, updateSettings, useStore } from '../lib/store';
import type { Phase } from '../lib/types';
import { MarkTag } from './MarkTag';
import { dateLabel } from './format';
import { useWidth } from './hooks';
import { IconChevron } from './icons';
import { href, navigate } from './router';

const PHASE_LABEL: Record<Phase, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

export function Insights() {
  const ready = useStore((s) => s.ready);
  const games = useStore((s) => s.games);
  const stored = useStore((s) => s.settings.player);
  const working = useStore((s) => !!s.active || s.queue.length > 0);

  const names = useMemo(() => playerNames(games), [games]);
  const player = resolvePlayer(games, stored) || names[0]?.name || '';
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

  const pending = games.filter((g) => !isReviewed(g) && (g.white.name === player || g.black.name === player));
  const options = names.filter((n) => n.games >= 2 || n.name === player).slice(0, 12);

  return (
    <>
      <div className="ins-head">
        <h1>Insights for</h1>
        <select className="select" value={player} onChange={(e) => updateSettings({ player: e.target.value })} aria-label="Player">
          {options.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name}
            </option>
          ))}
        </select>
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
        <Report data={data} />
      )}
    </>
  );
}

function Report({ data }: { data: InsightsData }) {
  const { record } = data;
  const phases = data.byPhase.filter((p) => p.moves >= 10);
  const worstPhase = phases.reduce<(typeof phases)[number] | null>((a, b) => (!a || b.accuracy < a.accuracy ? b : a), null);
  const bestPhase = phases.reduce<(typeof phases)[number] | null>((a, b) => (!a || b.accuracy > a.accuracy ? b : a), null);
  // Only point at a phase when it is clearly behind the others.
  const weakPhase = worstPhase && bestPhase && bestPhase.accuracy - worstPhase.accuracy >= 4 ? worstPhase.phase : null;
  const clockRows = data.byClock.filter((b) => b.moves > 0);
  const worstClock = clockRows.filter((b) => b.moves >= 10).reduce<(typeof clockRows)[number] | null>((a, b) => (!a || b.rate > a.rate ? b : a), null);
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
        <div className="figure">
          <div className="label">Errors per game</div>
          <div className="value">{data.errorsPerGame.toFixed(1)}</div>
          <div className="note-line">Inaccuracies, mistakes, blunders and missed chances</div>
        </div>
      </div>

      <div className="panels">
        {data.trend.length >= 2 && (
          <section className="panel wide">
            <h2>Accuracy, game by game</h2>
            <p className="hint">Oldest on the left. Select a point to open that game.</p>
            <TrendChart points={data.trend} average={data.accuracy} />
          </section>
        )}

        <section className="panel">
          <h2>Accuracy by phase</h2>
          <p className="hint">Average accuracy of your moves in each part of the game. Book moves are left out.</p>
          <Bars
            max={100}
            rows={data.byPhase.map((p) => ({
              key: p.phase,
              label: PHASE_LABEL[p.phase],
              value: p.moves ? p.accuracy : null,
              text: p.moves ? `${p.accuracy.toFixed(1)}%` : 'No moves',
              detail: `${p.moves} moves`,
              emphasis: weakPhase === p.phase,
            }))}
          />
        </section>

        <section className="panel">
          <h2>Errors and the clock</h2>
          <p className="hint">Mistakes, blunders and missed chances per 100 moves, by how much of your starting time was left.</p>
          {clockRows.length === 0 ? (
            <p className="muted">These games have no clock times recorded.</p>
          ) : (
            <Bars
              max={maxRate}
              rows={data.byClock.map((b) => ({
                key: b.key,
                label: b.label,
                value: b.moves ? b.rate : null,
                text: b.moves ? b.rate.toFixed(1) : 'No moves',
                detail: `${b.errors} in ${b.moves} moves`,
                emphasis: worstClock?.key === b.key && b.rate > 0,
              }))}
            />
          )}
        </section>

        <section className="panel">
          <h2>Where the errors come from</h2>
          <p className="hint">The patterns behind your errors that can be named. Open one to see the positions.</p>
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
                        {o.name}
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

interface BarRow {
  key: string;
  label: ReactNode;
  value: number | null;
  text: string;
  detail?: string;
  emphasis?: boolean;
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
          {r.detail && <span className="bar-detail num">{r.detail}</span>}
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
        <li key={m.kind}>
          <button className="motif-btn" type="button" aria-expanded={open === m.kind} onClick={() => setOpen(open === m.kind ? null : m.kind)}>
            <span>{m.label}</span>
            <span className="count">{m.count}</span>
            <IconChevron />
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${(m.count / top) * 100}%` }} />
            </span>
          </button>
          {open === m.kind && (
            <ul className="examples">
              {m.examples.map((ex) => (
                <li key={`${ex.gameId}${ex.ply}`}>
                  <a href={href('game', ex.gameId, ex.ply)}>
                    <b>
                      {Math.ceil(ex.ply / 2)}
                      {ex.ply % 2 === 1 ? '.' : '…'}
                      {ex.san}
                    </b>{' '}
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

const OUTCOME_WORD = { win: 'Won', draw: 'Drew', loss: 'Lost' } as const;

function Dot({ point, cx, cy, active }: { point: TrendPoint; cx: number; cy: number; active: boolean }) {
  const r = active ? 6 : 4.5;
  if (point.outcome === 'loss') return <circle cx={cx} cy={cy} r={r - 1} fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" />;
  return <circle cx={cx} cy={cy} r={r} fill={point.outcome === 'win' ? 'var(--ink)' : 'var(--ink-3)'} stroke="var(--paper)" strokeWidth="2" />;
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
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={width - m.r} y1={y(average)} y2={y(average)} stroke="var(--ink-3)" strokeWidth="1" />
        <text x={width - m.r} y={y(average) - 5} textAnchor="end" className="cat">
          average {average.toFixed(1)}
        </text>
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--line-strong)" strokeWidth="1" />}
        <path d={path} fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
          <b>{h.accuracy.toFixed(1)}%</b> {OUTCOME_WORD[h.outcome]} against {h.opponent}
        </div>
      )}
      <div className="legend" aria-hidden="true">
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
