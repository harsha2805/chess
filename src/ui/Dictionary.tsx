import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { MARK_MEANING, ORIGINS, TERMS, openingFamily } from '../lib/dictionary';
import { MARK_LABEL, MARK_ORDER, MARK_SUFFIX } from '../lib/explain';
import { Board } from './Board';
import { fold } from './format';
import { MarkTag } from './MarkTag';
import { href } from './router';

type Line = [eco: string, name: string, moves: string];

interface Family {
  name: string;
  lines: Line[];
  /** The shortest line, which shows how the family starts. */
  first: Line;
  ecos: string;
}

/** "1. e4 c5 2. Nf3" as "e4 c5 nf3", for matching typed moves. */
const plainMoves = (s: string) => fold(s.replace(/\d+\.(\.\.)?/g, ' ').replace(/\s+/g, ' ').trim());

const sans = (moves: string) => moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);

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
      return { name, lines: list, first, ecos: ecos.length > 1 ? `${ecos[0]}–${ecos[ecos.length - 1]}` : ecos[0] };
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
    if (kind === 'mark' || kind === 'term') target = `${kind}-${id}`;
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

  const q = fold(query.trim());
  const qMoves = plainMoves(query);
  const marks = MARK_ORDER.filter((m) => !q || fold(MARK_LABEL[m]).includes(q) || fold(MARK_MEANING[m]).includes(q));
  const terms = TERMS.filter((t) => !q || fold(t.name).includes(q) || fold(t.text).includes(q));

  const found = useMemo(() => {
    if (!q) return null;
    const hits: { family: Family; lines: Line[] }[] = [];
    let total = 0;
    for (const family of families) {
      const familyHit = fold(family.name).includes(q);
      const matched = family.lines.filter((l) => familyHit || fold(l[1]).includes(q) || l[0].toLowerCase() === q || plainMoves(l[2]).startsWith(qMoves));
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

function LineViewer({ line }: { line: Line | null }) {
  const positions = useMemo(() => {
    const chess = new Chess();
    const out = [{ fen: chess.fen(), from: '', to: '', san: '' }];
    if (!line) return out;
    for (const san of sans(line[2])) {
      try {
        const m = chess.move(san);
        out.push({ fen: chess.fen(), from: m.from, to: m.to, san: m.san });
      } catch {
        break;
      }
    }
    return out;
  }, [line]);
  const [ply, setPly] = useState(positions.length - 1);
  useEffect(() => setPly(positions.length - 1), [positions]);
  const at = positions[Math.min(ply, positions.length - 1)];

  return (
    <>
      <Board
        fen={at.fen}
        orientation="w"
        move={at.from ? { from: at.from, to: at.to } : undefined}
        label={line ? `${line[1]}, after ${ply === 0 ? 'no moves' : at.san}.` : 'The starting position.'}
      />
      {line ? (
        <div className="dict-viewer-text">
          <h3>{line[1]}</h3>
          <p className="muted">
            {`ECO ${line[0]}, ${Math.ceil((positions.length - 1) / 2)} ${positions.length <= 3 ? 'move' : 'moves'}`}
          </p>
          <ol className="dict-moves" aria-label="Moves, pick one to see the position">
            {positions.slice(1).map((p, i) => (
              <li key={i}>
                {i % 2 === 0 && <span className="muted num">{i / 2 + 1}.</span>}
                <button type="button" aria-pressed={ply === i + 1} onClick={() => setPly(i + 1)}>
                  {p.san}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="muted dict-viewer-text">Pick a line to see it on the board.</p>
      )}
    </>
  );
}
