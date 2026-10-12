import { APP_NAME, APP_VERSION, REPO_URL } from '../config';
import { MARK_LABEL, MARK_ORDER } from '../lib/explain';
import { MARK_MEANING } from '../lib/dictionary';
import { DEPTHS, type DepthPreset } from '../lib/store';
import { MarkTag } from './MarkTag';
import { href } from './router';

export function About() {
  return (
    <article className="prose">
      <h1>How {APP_NAME} works</h1>
      <p>
        {APP_NAME} is a free review tool for chess games. It gets your games from chess.com or Lichess, or from a PGN you paste, and goes
        through them with the Stockfish engine. The engine runs inside your browser, so there is no server to pay for and no daily limit.
      </p>

      <h2>How a move is judged</h2>
      <p>
        Stockfish scores the position before and after every move. Each score is turned into winning chances from 0 to 100, using a curve
        fitted on real games: being a pawn up is worth far more in an equal position than when you are already a rook ahead. A move is then
        judged by how many points of winning chances it gave away.
      </p>
      <table className="table">
        <tbody>
          {MARK_ORDER.map((mark) => (
            <tr key={mark}>
              <td>
                <span>
                  <MarkTag mark={mark} labelled />
                  {MARK_LABEL[mark]}
                </span>
              </td>
              <td>{MARK_MEANING[mark]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 14 }}>
        Accuracy is the average quality of a side’s moves, from 0 to 100. Moves played while the position was swinging count for more, and
        a few very bad moves cost more than many small slips.
      </p>

      <h2>Quick, Standard and Deep</h2>
      <p>
        The setting next to your games decides how far ahead Stockfish looks at each position. Looking further finds more, and takes longer.
        All three use the same rules to judge moves, so a blunder is a blunder at every setting; what changes is how sure the engine is.
      </p>
      <table className="table">
        <tbody>
          {(Object.keys(DEPTHS) as DepthPreset[]).map((d) => (
            <tr key={d}>
              <td>
                <b>{DEPTHS[d].label}</b>
              </td>
              <td>
                {DEPTHS[d].hint} {DEPTHS[d].summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 14 }}>
        A saved review keeps the setting it was made with. If you choose a deeper setting later, the games list and each game offer to
        review the lighter ones again. The new review replaces the old one when it finishes.
      </p>
      <p>
        On a computer with processor cores to spare, up to three games are reviewed at once, each by its own copy of Stockfish, so a batch
        finishes sooner. Each game is still judged exactly as it would be alone. Phones and tablets review one game at a time, to save the
        battery.
      </p>

      <h2>What it cannot tell you</h2>
      <p>
        The engine looks a fixed number of moves ahead, so a very deep idea can be judged wrongly; the Deep setting looks further and takes
        longer. The notes on each move come from simple rules about captures, forks and mates. They explain many errors, not all of them.
        The numbers will also differ a little from other sites, because each site uses its own engine settings and its own formula.
      </p>

      <h2>Your games stay with you</h2>
      <p>
        Your browser asks chess.com or Lichess for the games directly, using their public interfaces. Games and reviews are saved in this
        browser only. Nothing is uploaded, and there is no account. The one exception is a <a href={href('report')}>bug report</a>, which
        sends exactly what the form shows you.
      </p>

      <h2>Built with</h2>
      <ul>
        <li>
          <a href="https://stockfishchess.org/" target="_blank" rel="noreferrer">
            Stockfish
          </a>{' '}
          19, in the WebAssembly build by Nathan Rugg (GPL 3).
        </li>
        <li>chess.js for the rules of the game (BSD).</li>
        <li>Chess pieces by Colin M. L. Burnett (GPL 2 or later).</li>
        <li>Opening names from the Lichess openings list (public domain).</li>
        <li>The Overpass typeface (Open Font License).</li>
      </ul>
      <p>
        {APP_NAME} is free software under the GPL, version 3 or later. The{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          source code
        </a>{' '}
        is public. It is not affiliated with Chess.com or Lichess.
      </p>
      <p className="muted" style={{ fontFamily: 'var(--sans)', fontSize: '0.875rem', marginTop: 20 }}>
        Version {APP_VERSION}
      </p>
    </article>
  );
}
