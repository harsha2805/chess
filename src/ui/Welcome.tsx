import { useMemo, useState } from 'react';
import { SAMPLE_PGN } from '../config';
import sampleLine from '../data/sample-line.json';
import { MARK_LABEL, MARK_SUFFIX, moveLabel } from '../lib/explain';
import { parsePgn } from '../lib/pgn';
import { formatScore } from '../lib/score';
import { Board } from './Board';
import { EvalGraph, type LineData } from './EvalGraph';
import { ImportForm, openSample } from './ImportForm';
import { href } from './router';

/** The sample game's line, from a Standard review made ahead of time with the same engine. */
const LINE = sampleLine as LineData;
/** 16.Qb8+, the most famous queen sacrifice there is. */
const FEATURED = 31;

/** The first page, before any game is added: the import form, and a review of the sample game to try. */
export function Welcome() {
  const game = useMemo(() => parsePgn(SAMPLE_PGN), []);
  const [ply, setPly] = useState(FEATURED);
  const move = ply > 0 ? game.moves[ply - 1] : null;
  const marked = ply > 0 ? LINE.moves[ply - 1] : null;

  return (
    <>
      <div className="intro">
        <div className="intro-text">
          <h1>See where each game was won and lost.</h1>
          <p className="lede">
            Stockfish goes through your chess.com or Lichess games move by move, and shows what keeps going wrong from one game to the next.
            Free, with no daily limit.
          </p>
          <ImportForm />
        </div>

        <figure className="demo">
          <Board
            fen={move ? move.fenAfter : game.startFen}
            orientation="w"
            move={move ? { from: move.from, to: move.to } : undefined}
            mark={marked?.mark}
            label={
              move
                ? `Morphy against Duke Karl and Count Isouard, Paris 1858, after ${moveLabel(move)}.`
                : 'Morphy against Duke Karl and Count Isouard, Paris 1858: the starting position.'
            }
          />
          <figcaption className="caption" aria-live="polite">
            {ply === FEATURED ? (
              <>
                <b>16.Qb8+!!</b>
                White offers the queen, and it works: after 16…Nxb8 comes 17.Rd8 mate. Morphy, Paris 1858.{' '}
              </>
            ) : (
              <>
                <b>
                  {marked ? `${moveLabel(marked)}${MARK_SUFFIX[marked.mark] ?? ''}` : 'Starting position'}
                </b>
                {marked ? `${MARK_LABEL[marked.mark]}. Evaluation ${formatScore(marked.evalAfter)}.` : 'Morphy, Paris 1858.'}{' '}
                <button className="linklike" type="button" onClick={() => setPly(FEATURED)}>
                  Back to 16.Qb8+
                </button>
                {' · '}
              </>
            )}
            <button className="linklike" type="button" onClick={() => void openSample(ply)}>
              Review this game
            </button>
          </figcaption>
        </figure>

        <section className="intro-map" aria-label="The sample game's line">
          <EvalGraph review={LINE} ply={ply} onSelect={setPly} />
          <p className="intro-map-note">The Opera Game, drawn as a review draws every game. Drag along the line to step through it.</p>
        </section>
      </div>

      <ol className="stops">
        <li>
          <h2>Bring your games</h2>
          <p>Type your chess.com or Lichess username, or paste a PGN. Your last 10, 20 or 50 games come in at once.</p>
        </li>
        <li>
          <h2>Stockfish marks every move</h2>
          <p>It runs here in your browser, so there is no daily limit. Each error comes with its reason in plain words.</p>
        </li>
        <li>
          <h2>See what keeps going wrong</h2>
          <p>
            Once a few games are reviewed, Insights shows where you lose accuracy, which errors repeat, and how the clock affects you.{' '}
            <a href={href('about')}>How it works</a>
          </p>
        </li>
      </ol>
    </>
  );
}
