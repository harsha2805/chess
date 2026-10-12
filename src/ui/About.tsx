import { APP_NAME, APP_VERSION, REPO_URL } from '../config';
import { MARK_LABEL } from '../lib/explain';
import type { Mark } from '../lib/types';
import { MarkTag } from './MarkTag';
import { href } from './router';

const RULES: [Mark, string][] = [
  ['brilliant', 'A sound sacrifice: the move offers a piece, is among the best available, and the game was not already won without it.'],
  ['great', 'The only good move. It is the engine’s choice, and every other move gives up at least 12 points of winning chances.'],
  ['best', 'The engine’s first choice.'],
  ['excellent', 'Gives up 2 points of winning chances or fewer.'],
  ['good', 'Gives up between 2 and 5 points.'],
  ['book', 'A known opening move, while the game follows theory from the first move.'],
  ['forced', 'The only legal move.'],
  ['inaccuracy', 'Gives up between 5 and 10 points.'],
  ['miss', 'Gives up 10 points or more, but only by failing to punish an error the opponent just made.'],
  ['mistake', 'Gives up between 10 and 20 points.'],
  ['blunder', 'Gives up more than 20 points.'],
];

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
          {RULES.map(([mark, rule]) => (
            <tr key={mark}>
              <td>
                <span>
                  <MarkTag mark={mark} labelled />
                  {MARK_LABEL[mark]}
                </span>
              </td>
              <td>{rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 14 }}>
        Accuracy is the average quality of a side’s moves, from 0 to 100. Moves played while the position was swinging count for more, and
        a few very bad moves cost more than many small slips.
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
