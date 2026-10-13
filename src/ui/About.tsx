import { APP_NAME, APP_VERSION, FETCH_EVERY_HOURS, REPO_URL } from '../config';
import { MARK_LABEL, MARK_ORDER } from '../lib/explain';
import { MARK_MEANING } from '../lib/dictionary';
import { DEPTHS, type DepthPreset } from '../lib/store';
import { MarkTag } from './MarkTag';
import { useAccount } from '../lib/account';
import { href } from './router';

export function About() {
  const donateUrl = useAccount((s) => s.donateUrl);
  return (
    <article className="prose">
      <h1>How {APP_NAME} works</h1>
      <p>
        {APP_NAME} is a free review tool for chess games. It gets your games from chess.com or Lichess, or from a PGN you paste, and goes
        through them with the Stockfish engine. The engine runs inside your browser, so reviews cost nothing to run and there is no daily limit.
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
        A saved review keeps the setting it was made with. A deeper review always replaces a
        lighter one, and a lighter one never replaces a deeper one, whichever was made later and on whichever of your devices. Quick and
        Standard give each position a time limit, so a slow or busy device still finishes; when the limit stops the engine before it has
        looked as far as the setting asks, the game says so. Deep has no time limit: it always looks its full distance ahead, however long
        that takes on your device.
      </p>
      <p>
        A Deep review then checks the moves its verdict rests on, every mistake, blunder, miss, brilliant and great move, by searching
        the positions around them again, 24 moves ahead. A sharp combination can stay hidden at 16 moves ahead: in one real game a rook
        sacrifice that looked level there was worth almost eight pawns. The check usually adds 20 to 60 seconds to a game. On the
        practice board, Stockfish keeps looking deeper for as long as you stay on a position, up to 30 moves ahead on a computer and 22
        on a phone, where you can ask it to look deeper.
      </p>
      <p>
        On a computer with processor cores to spare, up to three copies of Stockfish run at once and share the work: each takes its own
        stretch of the game, so a single game finishes sooner, and so does a batch. The game you open always comes first. Phones and tablets
        use one copy, to save the battery.
      </p>

      <h2>Deep reviews in the background</h2>
      <p>
        For the most accurate verdict on one game, open it and choose <b>Deep review this game now</b>. For the rest, leave the tab open: while
        you are not asking for anything, one copy of Stockfish gives your games a Deep review, newest first, one at a time. It is the same Deep
        review as one you ask for, position by position; only when it runs differs. It stops the moment you ask for a review and carries on
        afterwards, waits while a laptop runs on its battery, and works in one tab at a time. Signed in, two of your devices never work on the
        same game. Each finished review is saved, and synced to your account, so no game is reviewed twice.
      </p>
      <p>
        It is on by default on computers with four or more processor cores, and off on phones and tablets. The switch is under the review
        setting on your games list.
      </p>

      <h2>Practice from any move</h2>
      <p>
        From any move of a game you can play on. <b>Explore</b> lets you move for both sides while Stockfish, at full strength, shows how the
        position stands and its best lines; <b>Try it</b> next to a better move plays that move for you to start. <b>Play against
        Stockfish</b> lets you take your side on against the bot, which starts at your rating in that game and can be made 10 points
        stronger or weaker at a time. Above 1320 Stockfish limits its own strength; below that it looks fewer moves ahead and sometimes
        picks a lesser move, as players at that level do. Either way the rating is an estimate.
      </p>
      <p>
        Practice never changes the game, its review or your insights. When you leave, you choose: keep an explored line with the game, or
        save a game against the bot as a game of its own, which you can review like any other. Games against the bot stay out of your games
        list and insights unless you tick <b>Include my games against the bot</b>. While you practise, the Deep reviews in the background
        wait, so your practice gets the engine first.
      </p>

      <h2>What it cannot tell you</h2>
      <p>
        The engine looks a fixed number of moves ahead, so a very deep idea can be judged wrongly; the Deep setting looks further and takes
        longer. The notes on each move come from simple rules about captures, forks and mates. They explain many errors, not all of them.
        The numbers will also differ a little from other sites, because each site uses its own engine settings and its own formula.
      </p>

      <h2>Your games stay with you</h2>
      <p>
        Without an account, your browser asks chess.com or Lichess for the games directly, using their public interfaces, and games and
        reviews are saved in this browser only. Nothing is uploaded. The one exception is a <a href={href('report')}>bug report</a>, which
        sends exactly what the form shows you.
      </p>
      <p>
        An <a href={href('signup')}>account</a> is optional. With one, your games and reviews are also saved on this site's server, so they
        are there on every device, and the server checks your chess.com or Lichess account for new games every {FETCH_EVERY_HOURS} hours.
        The engine still runs in your browser. Signing out removes the games from that browser, and deleting the account deletes everything
        saved with it.
      </p>

      {donateUrl && (
        <>
          <h2>Support {APP_NAME}</h2>
          <p>
            {APP_NAME} is free, with no ads and no paid tier. The reviews run in your browser, but the site, the accounts and the
            fetching of new games run on a server that costs money every month. If the reviews help you, you can{' '}
            <a href={donateUrl} target="_blank" rel="noreferrer">
              support it
            </a>
            . Everything stays free either way.
          </p>
        </>
      )}

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
