import type { ReactNode } from 'react';
import { MARK_LABEL } from '../lib/explain';
import type { Mark } from '../lib/types';
import { GlyphBook, GlyphCheck, GlyphCross, GlyphDot, GlyphSquare, GlyphStar } from './icons';

const CONTENT: Record<Mark, ReactNode> = {
  brilliant: '!!',
  great: '!',
  best: <GlyphStar />,
  excellent: <GlyphCheck />,
  good: <GlyphDot />,
  book: <GlyphBook />,
  forced: <GlyphSquare />,
  inaccuracy: '?!',
  miss: <GlyphCross />,
  mistake: '?',
  blunder: '??',
};

/** Fills light enough that the glyph needs dark ink to stay readable. */
const DARK_INK: Mark[] = ['excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake'];

/** The small typographic tag that marks a move's quality. */
export function MarkTag({ mark, labelled = false }: { mark: Mark; labelled?: boolean }) {
  return (
    <span
      className={`tag ${mark}${DARK_INK.includes(mark) ? ' light-ink' : ''}`}
      role={labelled ? undefined : 'img'}
      aria-label={labelled ? undefined : MARK_LABEL[mark]}
      aria-hidden={labelled || undefined}
    >
      {CONTENT[mark]}
    </span>
  );
}
