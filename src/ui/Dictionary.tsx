import { Chess } from 'chess.js';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { describeMove } from '../lib/describe';
import { ENDINGS, MARK_MEANING, ORIGINS, TERMS, openingFamily } from '../lib/dictionary';
import { MARK_LABEL, MARK_ORDER, MARK_SUFFIX } from '../lib/explain';
import { useStore } from '../lib/store';
import { Board } from './Board';
import { fold } from './format';
import { IconFirst, IconLast, IconNext, IconPause, IconPlay, IconPrev } from './icons';
import { MarkTag } from './MarkTag';
import { href } from './router';

type Line = [eco: string, name: string, moves: string];

interface Family {
  name: string;
  lines: Line[];
  /** For search, worked out once: the folded family name, and each line's folded name and moves. */
  folded: string;
  keys: { name: string; moves: string }[];
  /** The shortest line, which shows how the family starts. */
  first: Line;
  ecos: string;
}

/** "1. e4 c5 2. Nf3" as ["e4", "c5", "Nf3"]. */
const sans = (moves: string) => moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);

/** "1. e4 c5 2. Nf3" as "e4 c5 nf3", for matching typed moves. */
const plainMoves = (s: string) => fold(sans(s).join(' '));

function buildFamilies(lines: Line[]): Family[] {
  const byName = new Map<string, Line[]>();
  for (const line of lines) {
    const fam = openingFamily(line[1]);
    const list = byName.get(fam);
    if (list) list.push(line);
    else byName.set(fam, [line]);
  }
  return [...byName.entries()]
    .map(([name, list]) => {
      const ecos = [...new Set(list.map((l) => l[0]))].sort();
      const first = list.reduce((a, b) => (sans(b[2]).length < sans(a[2]).length ? b : a));
      return {
        name,
        lines: list,
        folded: fold(name),
        keys: list.map((l) => ({ name: fold(l[1]), moves: plainMoves(l[2]) })),
        first,
        ecos: ecos.length > 1 ? `${ecos[0]}–${ecos[ecos.length - 1]}` : ecos[0],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The variation part of a line's name, without the family it belongs to. */
function variation(line: Line, family: string): string {
  const name = line[1];
  if (name === family) return 'Main line';
  if (name.startsWith(`${family}: `)) return name.slice(family.length + 2);
  return name;
}

const MAX_RESULTS = 250;

/** Below this width the board viewer sits above the list instead of beside it. */
const narrow = () => window.matchMedia('(max-width: 959px)').matches;

/** Every name the reviews use, explained: move labels, words, and every named opening. */
export function Dictionary({ kind, id }: { kind?: string; id?: string }) {
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Line | null>(null);
  const viewer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    import('../data/opening-lines.json')
      .then((mod) => live && setLines(mod.default as Line[]))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const families = useMemo(() => (lines ? buildFamilies(lines) : []), [lines]);

  // A link to one entry opens it and brings it into view once it has rendered.
  const pendingScroll = useRef<{ target: string; block: ScrollLogicalPosition } | null>(null);
  useEffect(() => {
    if (!kind || !id) return;
    let target = '';
    if (kind === 'mark' || kind === 'term' || kind === 'ending') target = `${kind}-${id}`;
    else if (kind === 'opening' || kind === 'family') {
      if (!lines) return;
      const fam = openingFamily(id);
      setOpen((s) => new Set(s).add(fam));
      const line = kind === 'opening' ? lines.find((l) => l[1] === id) : undefined;
      if (line) setSelected(line);
      // On a phone the board sits above the list, so the board is what to show.
      target = line ? (narrow() ? 'dict-viewer' : `line-${line[1]}`) : `family-${fam}`;
    }
    pendingScroll.current = { target, block: kind === 'opening' && !narrow() ? 'center' : 'start' };
  }, [kind, id, lines]);
  useEffect(() => {
    const pending = pendingScroll.current;
    const el = pending && document.getElementById(pending.target);
    if (!pending || !el) return;
    pendingScroll.current = null;
    // After the app's own scroll to the top of a new page.
    requestAnimationFrame(() => el.scrollIntoView({ block: pending.block }));
  });

  // Searching thousands of lines can lag a keystroke behind; typing itself never waits for it.
  const search = useDeferredValue(query);
  const q = fold(search.trim());
  const qMoves = plainMoves(search);
  const marks = MARK_ORDER.filter((m) => !q || fold(MARK_LABEL[m]).includes(q) || fold(MARK_MEANING[m]).includes(q));
  const terms = TERMS.filter((t) => !q || fold(t.name).includes(q) || fold(t.text).includes(q));
  const endings = ENDINGS.filter((t) => !q || fold(t.name).includes(q) || fold(t.text).includes(q));

  const found = useMemo(() => {
    if (!q) return null;
    const hits: { family: Family; lines: Line[] }[] = [];
    let total = 0;
    for (const family of families) {
      const familyHit = family.folded.includes(q);
      const matched = family.lines.filter(
        (l, k) => familyHit || family.keys[k].name.includes(q) || l[0].toLowerCase() === q || family.keys[k].moves.startsWith(qMoves),
      );
      if (matched.length) {
        hits.push({ family, lines: matched });
        total += matched.length;
      }
    }
    return { hits, total };
  }, [q, qMoves, families]);

  const select = (line: Line) => {
    setSelected(line);
    if (narrow()) viewer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const shown = found ? found.hits : families.map((family) => ({ family, lines: family.lines }));
  let budget = MAX_RESULTS;

  return (
    <article className="dict">
      <header className="dict-head">
        <h1>Dictionary</h1>
        <p className="lede">
          Every name the reviews use, in plain words: what each move label means, the chess terms in the notes, and all{' '}
          {lines ? lines.length.toLocaleString() : '3,800'} named openings, with their moves and where the names come from.
        </p>
        <input
          className="input dict-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, for example Najdorf, fork, B90 or e4 c5"
          aria-label="Search the dictionary"
        />
        <nav className="dict-jump" aria-label="Sections">
          <a href="#dict-marks" onClick={jump('dict-marks')}>
            Move labels <span className="num">{marks.length}</span>
          </a>
          <a href="#dict-terms" onClick={jump('dict-terms')}>
            Words <span className="num">{terms.length}</span>
          </a>
          <a href="#dict-endings" onClick={jump('dict-endings')}>
            How games end <span className="num">{endings.length}</span>
          </a>
          <a href="#dict-openings" onClick={jump('dict-openings')}>
            Openings <span className="num">{found ? found.total.toLocaleString() : lines ? lines.length.toLocaleString() : '…'}</span>
          </a>
        </nav>
      </header>

      {marks.length > 0 && (
        <section id="dict-marks" className="dict-section">
          <h2>Move labels</h2>
          <p className="hint">
            Each move in a review gets one of these. The points are winning chances out of 100; see{' '}
            <a href={href('dictionary', 'term', 'winning-chances')}>winning chances</a>.
          </p>
          <dl className="dict-entries">
            {marks.map((m) => (
              <div key={m} id={`mark-${m}`} className={`dict-entry${kind === 'mark' && id === m ? ' is-target' : ''}`}>
                <dt>
                  <MarkTag mark={m} labelled />
                  {MARK_LABEL[m]}
                  {MARK_SUFFIX[m] && <span className="muted"> {MARK_SUFFIX[m]}</span>}
                </dt>
                <dd>{MARK_MEANING[m]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {terms.length > 0 && (
        <section id="dict-terms" className="dict-section">
          <h2>Words</h2>
          <dl className="dict-entries">
            {terms.map((t) => (
              <div key={t.id} id={`term-${t.id}`} className={`dict-entry${kind === 'term' && id === t.id ? ' is-target' : ''}`}>
                <dt>{t.name}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {endings.length > 0 && (
        <section id="dict-endings" className="dict-section">
          <h2>How games end</h2>
          <p className="hint">The games list and each game say which of these ended the game.</p>
          <dl className="dict-entries">
            {endings.map((t) => (
              <div key={t.id} id={`ending-${t.id}`} className={`dict-entry${kind === 'ending' && id === t.id ? ' is-target' : ''}`}>
                <dt>{t.name}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section id="dict-openings" className="dict-section">
        <h2>Openings</h2>
        <p className="hint">
          Grouped by family, A to Z. Open a family to see its lines, and pick one to see it on the board. The list is the{' '}
          <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">
            Lichess openings list
          </a>
          , which the reviews use to name your openings.
        </p>

        {failed ? (
          <p className="notice error">The openings could not be loaded. Check the connection and open this page again.</p>
        ) : !lines ? (
          <p className="muted">Loading the openings…</p>
        ) : (
          <div className="dict-openings">
            <div className="dict-viewer" id="dict-viewer" ref={viewer}>
              <LineViewer line={selected} />
            </div>
            <div className="dict-families">
              {shown.length === 0 && <p className="muted">No opening matches “{query}”.</p>}
              {shown.map(({ family, lines: list }) => {
                // Search results are capped; a family opened by hand shows every line.
                if (found && budget <= 0) return null;
                const isOpen = !!found || open.has(family.name);
                const visible = !isOpen ? [] : found ? list.slice(0, budget) : list;
                if (found) budget -= visible.length;
                return (
                  <details
                    key={family.name}
                    id={`family-${family.name}`}
                    className="dict-family"
                    open={isOpen}
                    onToggle={(e) => {
                      if (found) return;
                      const nowOpen = e.currentTarget.open;
                      setOpen((s) => {
                        if (s.has(family.name) === nowOpen) return s;
                        const next = new Set(s);
                        if (nowOpen) next.add(family.name);
                        else next.delete(family.name);
                        return next;
                      });
                    }}
                  >
                    <summary>
                      <span className="dict-family-name">{family.name}</span>
                      <span className="dict-family-meta">
                        <span className="num">{family.ecos}</span>
                        <span>
                          {list.length} {list.length === 1 ? 'line' : 'lines'}
                        </span>
                      </span>
                    </summary>
                    {isOpen && (
                      <div className="dict-family-body">
                        <p className="dict-origin">
                          {ORIGINS[family.name] ?? 'No history for this name is recorded here.'}{' '}
                          <span className="muted">Starts with {family.first[2]}.</span>
                        </p>
                        <ul className="dict-lines">
                          {visible.map((line) => (
                            <li key={line[1] + line[2]} id={`line-${line[1]}`}>
                              <button type="button" className={selected === line ? 'is-selected' : undefined} aria-pressed={selected === line} onClick={() => select(line)}>
                                <span className="num eco">{line[0]}</span>
                                <span className="name">{variation(line, family.name)}</span>
                                <span className="moves">{line[2]}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </details>
                );
              })}
              {found && found.total > MAX_RESULTS && (
                <p className="muted">
                  Showing the first {MAX_RESULTS} of {found.total.toLocaleString()} lines. Type more to narrow it down.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </article>
  );
}

/** Same-page section links, kept out of the address bar because the router owns it. */
function jump(target: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

interface Step {
  fen: string;
  from: string;
  to: string;
  san: string;
  /** The move in plain words. */
  text: string;
}

/** Seconds each move stays up while a line plays itself. */
const PLAY_EVERY = 1.1;

/** One opening line on a board: step or play through it, with each move in plain words. */
function LineViewer({ line }: { line: Line | null }) {
  const steps = useMemo(() => {
    const chess = new Chess();
    const out: Step[] = [{ fen: chess.fen(), from: '', to: '', san: '', text: '' }];
    if (!line) return out;
    for (const san of sans(line[2])) {
      try {
        const m = chess.move(san);
        out.push({ fen: chess.fen(), from: m.from, to: m.to, san: m.san, text: describeMove(m) });
      } catch {
        break;
      }
    }
    return out;
  }, [line]);
  const last = steps.length - 1;
  const [ply, setPlyRaw] = useState(last);
  const [animate, setAnimate] = useState(false);
  const [playing, setPlaying] = useState(false);
  const plyRef = useRef(ply);
  plyRef.current = ply;
  const list = useRef<HTMLOListElement>(null);

  // A new line opens on its final position, so its shape shows at once.
  useEffect(() => {
    setPlyRaw(last);
    setAnimate(false);
    setPlaying(false);
  }, [steps, last]);

  /** Moving one move forward slides the piece; any other jump shows the position at once. */
  const go = (next: number) => {
    const target = Math.max(0, Math.min(last, next));
    setAnimate(target === plyRef.current + 1);
    setPlyRaw(target);
  };
  const goRef = useRef(go);
  goRef.current = go;

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    // Playing from the end starts the line over.
    if (plyRef.current >= last) {
      setAnimate(false);
      setPlyRaw(0);
    }
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    if (ply >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => goRef.current(ply + 1), PLAY_EVERY * 1000);
    return () => clearTimeout(timer);
  }, [playing, ply, last]);

  // The arrow keys step through the line, unless the search box has the keys.
  useEffect(() => {
    if (!line) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const current = plyRef.current;
      if (e.key === 'ArrowLeft') goRef.current(current - 1);
      else if (e.key === 'ArrowRight') goRef.current(current + 1);
      else if (e.key === 'Home') goRef.current(0);
      else if (e.key === 'End') goRef.current(Infinity);
      else return;
      e.preventDefault();
      setPlaying(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [line]);

  // Keeps the current move in view inside the list, without moving the page.
  useEffect(() => {
    const box = list.current;
    const row = box?.children[ply - 1] as HTMLElement | undefined;
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = row.offsetTop - box.clientHeight / 3;
    }
  }, [ply]);

  const games = useStore((s) => s.games);
  const family = line ? openingFamily(line[1]) : '';
  const reached = useMemo(() => {
    if (!line) return { line: 0, family: 0 };
    let exact = 0;
    let inFamily = 0;
    for (const g of games) {
      const name = g.review?.opening?.name;
      if (!name) continue;
      if (name === line[1]) exact++;
      if (openingFamily(name) === family) inFamily++;
    }
    return { line: exact, family: inFamily };
  }, [games, line, family]);

  const at = steps[Math.min(ply, last)];
  const moveNo = (i: number) => (i % 2 === 1 ? `${(i + 1) / 2}.` : `${i / 2}…`);

  return (
    <>
      {line && (
        <header className="dict-viewer-head">
          <p className="dict-family-tag">
            <a href={href('dictionary', 'family', family)}>{family}</a>
            <a className="num" href={href('dictionary', 'term', 'eco')} title="What the ECO code means">
              ECO {line[0]}
            </a>
          </p>
          <h3>{line[1] === family ? `${family}, main line` : variation(line, family)}</h3>
          <p className="muted">
            {Math.ceil(last / 2)} {last <= 2 ? 'move' : 'moves'}, then {last % 2 === 0 ? 'White' : 'Black'} to move.
            {reached.line > 0
              ? ` You reached this line in ${reached.line} ${reached.line === 1 ? 'game' : 'games'}.`
              : reached.family > 0
                ? ` ${reached.family} of your games ${reached.family === 1 ? 'was a' : 'were'} ${family}.`
                : ''}
          </p>
        </header>
      )}
      <Board
        fen={at.fen}
        orientation="w"
        move={at.from ? { from: at.from, to: at.to } : undefined}
        animate={animate}
        label={line ? `${line[1]}, after ${ply === 0 ? 'no moves' : at.san}.` : 'The starting position.'}
      />
      {line ? (
        <div className="dict-viewer-text">
          <div className="dict-controls">
            <button className="icon-btn" type="button" onClick={() => go(0)} disabled={ply === 0} aria-label="Starting position" title="Start (Home)">
              <IconFirst />
            </button>
            <button className="icon-btn" type="button" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label="Previous move" title="Previous (left arrow)">
              <IconPrev />
            </button>
            <button
              className="icon-btn play"
              type="button"
              onClick={togglePlay}
              aria-pressed={playing}
              aria-label={playing ? 'Pause' : 'Play the moves'}
              title={playing ? 'Pause' : 'Play the moves'}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button className="icon-btn" type="button" onClick={() => go(ply + 1)} disabled={ply === last} aria-label="Next move" title="Next (right arrow)">
              <IconNext />
            </button>
            <button className="icon-btn" type="button" onClick={() => go(last)} disabled={ply === last} aria-label="Final position" title="End (End)">
              <IconLast />
            </button>
          </div>
          <p className="dict-now" aria-live="polite">
            {ply === 0 ? (
              'The starting position. Play the moves, or step through them one at a time.'
            ) : (
              <>
                <b className="num">
                  {moveNo(ply)} {at.san}
                </b>{' '}
                {at.text}
              </>
            )}
          </p>

          <ol className="dict-steps" ref={list} aria-label="The moves in words, pick one to see the position">
            {steps.slice(1).map((p, i) => (
              <li key={i}>
                <button type="button" aria-pressed={ply === i + 1} onClick={() => go(i + 1)}>
                  <span className="num step-no">{moveNo(i + 1)}</span>
                  <span className="step-san">{p.san}</span>
                  <span className="step-text">{p.text}</span>
                </button>
              </li>
            ))}
          </ol>
          {ORIGINS[family] && <p className="dict-viewer-origin">{ORIGINS[family]}</p>}
        </div>
      ) : (
        <p className="muted dict-viewer-text">Pick a line to see it on the board, play through its moves, and read each one in plain words.</p>
      )}
    </>
  );
}
