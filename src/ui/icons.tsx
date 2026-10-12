import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const IconFirst = () => (
  <svg {...base}>
    <path d="M7 6v12M17 6l-6 6 6 6" />
  </svg>
);
export const IconPrev = () => (
  <svg {...base}>
    <path d="M14.5 6l-6 6 6 6" />
  </svg>
);
export const IconNext = () => (
  <svg {...base}>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);
export const IconLast = () => (
  <svg {...base}>
    <path d="M17 6v12M7 6l6 6-6 6" />
  </svg>
);
export const IconPlay = () => (
  <svg {...base}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
  </svg>
);
export const IconPause = () => (
  <svg {...base}>
    <path d="M9 6v12M15 6v12" />
  </svg>
);
export const IconFlip = () => (
  <svg {...base}>
    <path d="M8 4v15M8 4L4.5 7.5M8 4l3.5 3.5M16 20V5M16 20l-3.5-3.5M16 20l3.5-3.5" />
  </svg>
);
export const IconExternal = () => (
  <svg {...base}>
    <path d="M14 5h5v5M19 5l-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5" />
  </svg>
);
export const IconChevron = () => (
  <svg {...base}>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

export const IconSun = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
);
export const IconMoon = () => (
  <svg {...base}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

/* Glyphs used inside mark tags. Drawn heavier because they sit at 13px. */
const glyph: SVGProps<SVGSVGElement> = { ...base, strokeWidth: 3.2 };

export const GlyphStar = () => (
  <svg {...glyph} fill="currentColor" strokeWidth={1.5}>
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6-5.5-3-5.5 3 1.2-6-4.5-4.2 6.1-.8z" />
  </svg>
);
export const GlyphCheck = () => (
  <svg {...glyph}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const GlyphDot = () => (
  <svg {...glyph} fill="currentColor" stroke="none">
    <circle cx="12" cy="12" r="5" />
  </svg>
);
export const GlyphBook = () => (
  <svg {...glyph} strokeWidth={2.4}>
    <path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5zM12 6.5v13" />
  </svg>
);
export const GlyphSquare = () => (
  <svg {...glyph} strokeWidth={2.8}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
  </svg>
);
export const GlyphCross = () => (
  <svg {...glyph}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
);
