// Writes plain HTML pages that search engines can read, next to the app in dist/: one per
// opening family, the guides (how games end, the move labels, chess words), an index of the
// openings, and the sitemap that lists them all. Runs after `vite build` (see package.json).
//
// The app itself lives behind "#" routes, which search engines treat as one page. These pages
// carry the same knowledge as the app's dictionary at real addresses, and link into the app.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { describeMove } from '../src/lib/describe';
import { ENDINGS, MARK_MEANING, ORIGINS, TERMS, openingFamily } from '../src/lib/dictionary';
import { MARK_LABEL, MARK_ORDER } from '../src/lib/explain';

type Line = [eco: string, name: string, moves: string];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ has no build. Run `vite build` first.');
  process.exit(1);
}

// The live address, from the app's canonical link, so it is set in one place.
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(join(root, 'index.html'), 'utf8'));
if (!canonical) throw new Error('index.html has no canonical link');
const SITE = canonical[1].replace(/\/$/, '');
const TODAY = new Date().toISOString().slice(0, 10);
const NAME = 'ChessDebrief';

const lines = JSON.parse(readFileSync(join(root, 'src/data/opening-lines.json'), 'utf8')) as Line[];

// ---- Helpers ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "King's Indian Defense" as "kings-indian-defense", "Réti Opening" as "reti-opening". */
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const sans = (moves: string) => moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);

/** The app at a "#" route. */
const appLink = (...segments: string[]) => `/#/${segments.map(encodeURIComponent).join('/')}`;

const CSS = `
:root{--ground:#0d1830;--ground-2:#15244a;--ink:#f3efe6;--ink-2:#cfd6e6;--ink-3:#93a0c2;--cta:#f3efe6;--cta-ink:#0d1830;--line:#2a3c6b}
@media (prefers-color-scheme: light){:root{--ground:#f3efe6;--ground-2:#e7e1d4;--ink:#0d1830;--ink-2:#2b3a63;--ink-3:#56638a;--cta:#0d1830;--cta-ink:#f3efe6;--line:#cdd2de}}
*{box-sizing:border-box}html{background:var(--ground);color:var(--ink)}
body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-underline-offset:3px}
.bar{border-bottom:1px solid var(--line)}.bar-inner,main,footer{max-width:960px;margin:0 auto;padding:0 16px}
.bar-inner{display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center;min-height:60px}
.brand{font-weight:900;text-decoration:none;margin-right:auto}.bar nav{display:flex;gap:16px;font-weight:700;font-size:15px}
.bar nav a{text-decoration:none}.bar nav a:hover{text-decoration:underline}
main{padding-top:28px;padding-bottom:48px}
.crumbs{font-size:14px;color:var(--ink-3)}.crumbs a{color:var(--ink-2)}
h1{font-size:clamp(1.7rem,4vw,2.4rem);line-height:1.15;margin:.3em 0 .4em;font-weight:900}
h2{font-size:1.3rem;margin:1.8em 0 .5em;font-weight:900}h3{font-size:1.05rem;margin:1.4em 0 .3em}
.lede{font-size:1.1rem;color:var(--ink-2);max-width:68ch}
.cta{display:inline-block;margin:10px 12px 0 0;padding:10px 18px;border-radius:999px;background:var(--cta);color:var(--cta-ink);font-weight:800;text-decoration:none}
.cta.quiet{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 2px var(--line)}
.moves{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.moves li{display:grid;grid-template-columns:3em 4.5em 1fr;gap:8px;padding:9px 4px;border-bottom:1px solid var(--line)}
.moves .no{color:var(--ink-3)}.moves .san{font-weight:900}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink-3);font-weight:700}td.eco{white-space:nowrap;color:var(--ink-3)}td.line{color:var(--ink-2)}
.cols{columns:2 280px;column-gap:32px;padding:0;list-style:none}.cols li{break-inside:avoid;padding:3px 0}
.cols .meta{color:var(--ink-3);font-size:14px}
dl{margin:0}dt{font-weight:800;margin-top:1.2em}dd{margin:.3em 0 0;color:var(--ink-2);max-width:72ch}
footer{border-top:1px solid var(--line);padding-top:18px;padding-bottom:32px;font-size:14px;color:var(--ink-3)}
footer a{margin-right:16px}
`;

interface Page {
  path: string;
  title: string;
  description: string;
  h1: string;
  body: string;
  crumbs: { name: string; path: string }[];
  /** Extra structured data, besides the breadcrumb. */
  schema?: object;
}

function render(p: Page): string {
  const url = `${SITE}${p.path}`;
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: NAME, path: '/' }, ...p.crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${SITE}${c.path}` })),
  };
  const schemas = [breadcrumb, ...(p.schema ? [p.schema] : [])];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0d1830">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
${schemas.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
<style>${CSS}</style>
</head>
<body>
<header class="bar"><div class="bar-inner">
<a class="brand" href="/">${NAME}</a>
<nav aria-label="Site"><a href="/">Review your games</a><a href="/openings/">Openings</a><a href="/guide/">Guides</a></nav>
</div></header>
<main>
<p class="crumbs">${[{ name: NAME, path: '/' }, ...p.crumbs.slice(0, -1)].map((c) => `<a href="${c.path}">${esc(c.name)}</a>`).join(' / ')}</p>
<h1>${esc(p.h1)}</h1>
${p.body}
</main>
<footer>
<p><a href="/">Free chess game review</a><a href="/openings/">All chess openings</a><a href="/guide/game-endings/">How games end</a><a href="/guide/move-labels/">Move labels</a><a href="/guide/chess-terms/">Chess terms</a></p>
<p>${NAME} reviews your chess.com and Lichess games with Stockfish, free and with no daily limit. Opening names from the Lichess openings list.</p>
</footer>
</body>
</html>
`;
}

const pages: Page[] = [];

// ---- Openings ----

const families = new Map<string, Line[]>();
for (const line of lines) {
  const fam = openingFamily(line[1]);
  const list = families.get(fam);
  if (list) list.push(line);
  else families.set(fam, [line]);
}
const famList = [...families.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const famSlug = new Map<string, string>();
const used = new Set<string>();
for (const [name] of famList) {
  let s = slug(name) || 'opening';
  while (used.has(s)) s += '-2';
  used.add(s);
  famSlug.set(name, s);
}

const ecoRange = (list: Line[]) => {
  const ecos = [...new Set(list.map((l) => l[0]))].sort();
  return ecos.length > 1 ? `${ecos[0]}–${ecos[ecos.length - 1]}` : ecos[0];
};

for (const [name, list] of famList) {
  const first = list.reduce((a, b) => (sans(b[2]).length < sans(a[2]).length ? b : a));
  // The line to explain move by move: the longest one that many of the family's lines pass
  // through (for the Sicilian, the Open Sicilian), so the page covers the moves players meet.
  const plain = list.map((l) => sans(l[2]).join(' '));
  const need = Math.max(2, Math.ceil(list.length * 0.1));
  let main = list.find((l) => l[1] === name) ?? first;
  list.forEach((l, k) => {
    const through = plain.filter((p) => p === plain[k] || p.startsWith(`${plain[k]} `)).length;
    if (through >= need && sans(l[2]).length > sans(main[2]).length) main = l;
  });
  const chess = new Chess();
  const steps: { no: string; san: string; text: string }[] = [];
  sans(main[2]).forEach((san, i) => {
    try {
      const m = chess.move(san);
      steps.push({ no: i % 2 === 0 ? `${i / 2 + 1}.` : `${(i + 1) / 2}…`, san: m.san, text: describeMove(m) });
    } catch {
      // A line the board cannot follow ends there.
    }
  });
  const range = ecoRange(list);
  const origin = ORIGINS[name];
  const path = `/openings/${famSlug.get(name)}/`;
  const others = list.filter((l) => l !== main);
  const description = `${name} (ECO ${range}) starts ${first[2]}. ${list.length} named ${list.length === 1 ? 'line' : 'lines'} with every move explained${origin ? ', and where the name comes from' : ''}. Review your own ${name} games free with Stockfish.`;
  const body = `
<p class="lede">${origin ? esc(origin) : `${esc(name)} is a chess opening that starts <strong>${esc(first[2])}</strong>. Its ECO code${range.includes('–') ? 's run' : ' is'} ${range}.`}</p>
<p><a class="cta" href="${appLink('dictionary', 'family', name)}">Play through it on the board</a><a class="cta quiet" href="/">Review your own games</a></p>
<h2>${esc(main[1] === name ? name : main[1])}, move by move</h2>
<p>${esc(main[2])} <span style="color:var(--ink-3)">(ECO ${esc(main[0])})</span></p>
<ol class="moves">${steps.map((s) => `<li><span class="no">${s.no}</span><span class="san">${esc(s.san)}</span><span>${esc(s.text)}</span></li>`).join('')}</ol>
${
  others.length
    ? `<h2>All ${list.length} ${esc(name)} lines</h2>
<table><thead><tr><th>ECO</th><th>Line</th><th>Moves</th></tr></thead><tbody>
${list.map((l) => `<tr><td class="eco">${esc(l[0])}</td><td><a href="${appLink('dictionary', 'opening', l[1])}">${esc(l[1] === name ? 'Main line' : l[1].replace(`${name}: `, ''))}</a></td><td class="line">${esc(l[2])}</td></tr>`).join('\n')}
</tbody></table>`
    : ''
}
<h2>How to get better at the ${esc(name)}</h2>
<p>Knowing the moves is the start; the errors in your own games are what cost points. ${NAME} gets your recent games from chess.com or Lichess, has Stockfish mark every move from brilliant to blunder, and shows where your ${esc(name)} games go wrong, free and with no daily limit. From any move you can play on against Stockfish at your own rating.</p>
<p><a class="cta" href="/">Review my games</a></p>
`;
  pages.push({
    path,
    title: `${name}: moves, variations and history | ${NAME}`,
    description,
    h1: `${name}: moves, variations and history`,
    body,
    crumbs: [
      { name: 'Openings', path: '/openings/' },
      { name, path },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: `${name}: moves, variations and history`,
      description,
      dateModified: TODAY,
      author: { '@type': 'Organization', name: NAME },
      publisher: { '@type': 'Organization', name: NAME },
      mainEntityOfPage: `${SITE}${path}`,
    },
  });
}

// The index of every family, A to Z.
const byLetter = new Map<string, [string, Line[]][]>();
for (const entry of famList) {
  const letter = entry[0][0].toUpperCase();
  (byLetter.get(letter) ?? byLetter.set(letter, []).get(letter)!).push(entry);
}
pages.push({
  path: '/openings/',
  title: `All ${lines.length.toLocaleString('en')} chess openings, A to Z, with moves | ${NAME}`,
  description: `Every named chess opening: ${famList.length} families and ${lines.length.toLocaleString('en')} lines, from the Alekhine to the Zukertort, with their ECO codes, moves explained, and where the names come from.`,
  h1: 'Chess openings, A to Z',
  crumbs: [{ name: 'Openings', path: '/openings/' }],
  body: `
<p class="lede">All ${famList.length} opening families and their ${lines.length.toLocaleString('en')} named lines, as in the Lichess openings list. Each page explains the moves one by one, lists every variation with its ECO code, and tells where the name comes from.</p>
<p><a class="cta" href="${appLink('dictionary')}">Search the openings in the app</a><a class="cta quiet" href="/guide/chess-terms/">What ECO codes mean</a></p>
${[...byLetter.entries()]
  .map(
    ([letter, entries]) => `<h2>${esc(letter)}</h2>
<ul class="cols">${entries.map(([name, list]) => `<li><a href="/openings/${famSlug.get(name)}/">${esc(name)}</a> <span class="meta">${ecoRange(list)}, ${list.length} ${list.length === 1 ? 'line' : 'lines'}</span></li>`).join('')}</ul>`,
  )
  .join('\n')}
`,
});

// ---- Guides ----

const guides: Page[] = [
  {
    path: '/guide/game-endings/',
    title: `How a chess game ends: resignation, timeout, stalemate and more | ${NAME}`,
    description:
      'Every way a chess game can end, explained: checkmate, resignation, losing on time, abandoning (AFK), timeout vs insufficient material, stalemate, repetition, insufficient material, the 50-move rule and agreed draws.',
    h1: 'How a chess game ends',
    crumbs: [
      { name: 'Guides', path: '/guide/' },
      { name: 'How games end', path: '/guide/game-endings/' },
    ],
    body: `<p class="lede">Online games on chess.com and Lichess end in one of these ways. ${NAME} says which one ended each of your games.</p>
<dl>${ENDINGS.map((e) => `<dt id="${e.id}">${esc(e.name)}</dt><dd>${esc(e.text)}</dd>`).join('')}</dl>
<p><a class="cta" href="/">See how your games ended</a></p>`,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: ENDINGS.map((e) => ({ '@type': 'Question', name: `What does ${e.name.toLowerCase()} mean in chess?`, acceptedAnswer: { '@type': 'Answer', text: e.text } })),
    },
  },
  {
    path: '/guide/move-labels/',
    title: `Brilliant, great, mistake, blunder: chess move labels explained | ${NAME}`,
    description:
      'What brilliant, great, best, excellent, good, book, inaccuracy, miss, mistake and blunder mean in a chess game review, and the winning-chance thresholds behind each label.',
    h1: 'Chess move labels explained',
    crumbs: [
      { name: 'Guides', path: '/guide/' },
      { name: 'Move labels', path: '/guide/move-labels/' },
    ],
    body: `<p class="lede">A game review gives every move one of these labels. The points are winning chances out of 100, worked out from Stockfish's evaluation before and after the move.</p>
<dl>${MARK_ORDER.map((m) => `<dt id="${m}">${esc(MARK_LABEL[m])}</dt><dd>${esc(MARK_MEANING[m])}</dd>`).join('')}</dl>
<p><a class="cta" href="/">Get your moves labelled</a></p>`,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: MARK_ORDER.map((m) => ({ '@type': 'Question', name: `What is a ${MARK_LABEL[m].toLowerCase()} move in chess?`, acceptedAnswer: { '@type': 'Answer', text: MARK_MEANING[m] } })),
    },
  },
  {
    path: '/guide/chess-terms/',
    title: `Chess terms explained: evaluation, accuracy, ECO codes and more | ${NAME}`,
    description: 'Plain explanations of the words in a chess game review: move notation, evaluation, winning chances, accuracy, opening theory, ECO codes, gambits, forks, sacrifices and engine depth.',
    h1: 'Chess terms explained',
    crumbs: [
      { name: 'Guides', path: '/guide/' },
      { name: 'Chess terms', path: '/guide/chess-terms/' },
    ],
    body: `<p class="lede">The words a game review uses, in plain language.</p>
<dl>${TERMS.map((t) => `<dt id="${t.id}">${esc(t.name)}</dt><dd>${esc(t.text)}</dd>`).join('')}</dl>
<p><a class="cta" href="/">Review your games</a></p>`,
  },
];
pages.push(...guides);
pages.push({
  path: '/guide/',
  title: `Chess guides: game endings, move labels and terms | ${NAME}`,
  description: 'Guides to reading a chess game review: how games end, what each move label means, and the chess terms a review uses.',
  h1: 'Chess guides',
  crumbs: [{ name: 'Guides', path: '/guide/' }],
  body: `<ul class="cols">${guides.map((g) => `<li><a href="${g.path}">${esc(g.h1)}</a><br><span class="meta">${esc(g.description)}</span></li>`).join('')}<li><a href="/openings/">Chess openings, A to Z</a><br><span class="meta">Every named opening with its moves explained.</span></li></ul>`,
});

// ---- Write ----

for (const dir of ['openings', 'guide']) rmSync(join(dist, dir), { recursive: true, force: true });
for (const p of pages) {
  const dir = join(dist, p.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), render(p));
}

const urls = [{ path: '/', priority: '1.0' }, ...pages.map((p) => ({ path: p.path, priority: p.path.split('/').length > 4 ? '0.6' : '0.8' }))];
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u.path}</loc><lastmod>${TODAY}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`,
);
console.log(`Wrote ${pages.length} pages (${famList.length} opening families) and a sitemap of ${urls.length} addresses for ${SITE}.`);
