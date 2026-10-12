/* Shared live-sample engine: state, keyboard stepping, board, graph and notation helpers.
   Each template supplies its own markup and calls PM.mount(render). Data comes from data.js,
   a real Stockfish 19 review (depth 12) of the Opera Game exported by the app's own analyzer. */
(function () {
  const G = window.GAME;
  const N = G.moves.length;
  const PIECES = '../../../src/assets/pieces/';
  const S = { ply: 31, flip: false, showBest: false };
  let renderFn = () => {};

  const clamp = (p) => Math.max(0, Math.min(N, p));
  function set(p) {
    S.ply = clamp(p);
    S.showBest = false;
    renderFn(S);
  }
  function toggleBest() {
    S.showBest = !S.showBest;
    renderFn(S);
  }
  function flip() {
    S.flip = !S.flip;
    renderFn(S);
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') set(S.ply - 1);
    else if (e.key === 'ArrowRight') set(S.ply + 1);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(N);
    else if (e.key === 'f' || e.key === 'F') flip();
    else return;
    e.preventDefault();
  });

  const move = (ply) => (ply > 0 ? G.moves[ply - 1] : null);
  const moveNo = (m) => (m.color === 'w' ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}…`);
  const label = (m) => (m ? `${moveNo(m)}${m.san}` : 'Start');

  /** White's winning chances (0–100) after each ply; index 0 is the start. */
  const series = [50].concat(G.moves.map((m) => (m.wc == null ? 50 : m.color === 'w' ? m.wc : 100 - m.wc)));

  const GLYPH = {
    brilliant: '!!',
    great: '!',
    inaccuracy: '?!',
    mistake: '?',
    blunder: '??',
    best: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6-5.5-3-5.5 3 1.2-6-4.5-4.2 6.1-.8z"/></svg>',
    excellent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    good: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5zM12 6.5v13"/></svg>',
    forced: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/></svg>',
    miss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  };
  const LABEL = {
    brilliant: 'Brilliant', great: 'Great move', best: 'Best move', excellent: 'Excellent', good: 'Good', book: 'Book move',
    forced: 'Forced', inaccuracy: 'Inaccuracy', miss: 'Missed chance', mistake: 'Mistake', blunder: 'Blunder',
  };
  const ERRORS = ['inaccuracy', 'miss', 'mistake', 'blunder'];

  function parseFen(fen) {
    const rows = fen.split(' ')[0].split('/');
    const out = [];
    for (const row of rows) for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(null);
      else out.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
    }
    return out; // a8 … h1
  }
  const sqName = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));

  /**
   * Board markup. opts: { fen, flip, from, to, mark, arrow:{from,to}, coords:true, markClass }.
   * Squares carry .sq.l / .sq.d, .hl on the last move, and the mark badge sits on the destination.
   */
  function board(opts) {
    const cells = parseFen(opts.fen);
    const order = [...Array(64).keys()];
    if (opts.flip) order.reverse();
    let html = '<div class="pm-board" style="grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr)" role="img" aria-label="' + (opts.label || 'Chess board') + '">';
    order.forEach((i, k) => {
      const name = sqName(i);
      const file = i % 8, rank = Math.floor(i / 8);
      const light = (file + rank) % 2 === 0;
      const hl = name === opts.from || name === opts.to;
      let inner = '';
      if (cells[i]) inner += `<img src="${PIECES}${cells[i]}.svg" alt="" draggable="false">`;
      if (opts.coords !== false) {
        const col = k % 8, row = Math.floor(k / 8);
        if (col === 0) inner += `<span class="co r">${name[1]}</span>`;
        if (row === 7) inner += `<span class="co f">${name[0]}</span>`;
      }
      if (opts.mark && name === opts.to) inner += `<span class="pm-badge m-${opts.mark}">${GLYPH[opts.mark]}</span>`;
      html += `<div class="sq ${light ? 'l' : 'd'}${hl ? ' hl' : ''}" data-sq="${name}">${inner}</div>`;
    });
    if (opts.arrow) html += arrowSvg(opts.arrow, opts.flip);
    return html + '</div>';
  }
  function center(sq, flip) {
    let f = sq.charCodeAt(0) - 97, r = 8 - +sq[1];
    if (flip) { f = 7 - f; r = 7 - r; }
    return [f * 12.5 + 6.25, r * 12.5 + 6.25];
  }
  function arrowSvg(a, flip) {
    const [x1, y1] = center(a.from, flip), [x2, y2] = center(a.to, flip);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1) - 3.2;
    const ex = x1 + Math.cos(ang) * len, ey = y1 + Math.sin(ang) * len;
    return `<svg class="pm-arrow" viewBox="0 0 100 100" aria-hidden="true"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="1.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="currentColor"/></marker></defs><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" marker-end="url(#ah)"/></svg>`;
  }

  /** The position, highlight and badge to show for the current state. */
  function view(s) {
    const m = move(s.ply);
    const best = m && m.best;
    if (s.showBest && best) return { fen: m.fenBefore, arrow: { from: best.from, to: best.to }, flip: s.flip, label: `Before ${label(m)}, engine choice ${best.san}` };
    return { fen: m ? m.fen : G.startFen, from: m && m.from, to: m && m.to, mark: m && m.mark, flip: s.flip, label: m ? `Position after ${label(m)}` : 'Starting position' };
  }

  /** Points for the winning-chances curve in a w×h box, top = White winning. */
  function points(w, h, pad = 0) {
    return series.map((v, i) => [pad + (i / N) * (w - pad * 2), h - (v / 100) * h]);
  }

  function lineText(firstPly, sans) {
    return sans.map((san, k) => {
      const ply = firstPly + k;
      if (ply % 2 === 1) return `${Math.ceil(ply / 2)}.${san}`;
      return k === 0 ? `${Math.ceil(ply / 2)}…${san}` : san;
    }).join(' ');
  }

  function counts(color) {
    const c = {};
    for (const m of G.moves) if (m.color === color) c[m.mark] = (c[m.mark] || 0) + 1;
    return c;
  }

  /** Clicks on anything with data-ply step there; data-act="best|flip|prev|next|first|last". */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ply],[data-act]');
    if (!t) return;
    if (t.dataset.ply !== undefined) return set(+t.dataset.ply);
    const a = t.dataset.act;
    if (a === 'best') toggleBest();
    else if (a === 'flip') flip();
    else if (a === 'prev') set(S.ply - 1);
    else if (a === 'next') set(S.ply + 1);
    else if (a === 'first') set(0);
    else if (a === 'last') set(N);
  });

  window.PM = {
    G, N, S, GLYPH, LABEL, ERRORS, series, move, moveNo, label, board, view, points, lineText, counts, set,
    acc: (c) => G.accuracy[c].toFixed(1),
    mount(fn) {
      renderFn = fn;
      fn(S);
    },
  };
})();
