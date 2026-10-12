---
name: ChessDebrief
description: Free chess game review drawn as one transit line, night by default.
colors:
  porcelain: "#f3efe6"
  midnight-enamel: "#0d1830"
  enamel-panel: "#13224a"
  enamel-raised: "#1b2e5e"
  seam: "#2a3f73"
  seam-strong: "#3e5694"
  ink-2: "#ccd2e2"
  ink-3: "#a3aecb"
  sign-2: "#e5e0d4"
  sign-line: "#cdd2de"
  sign-ink-2: "#3f4d74"
  band: "#44527a"
  focus: "#f4ad1f"
  danger: "#ff7a66"
  danger-ground: "#3a1a24"
  brilliant: "#22b8d6"
  great: "#3a78f2"
  best: "#2fae62"
  excellent: "#86c766"
  good: "#a7b0c4"
  book: "#c9a46a"
  forced: "#7d88a3"
  inaccuracy: "#f4ad1f"
  miss: "#d65aa8"
  mistake: "#f07a28"
  blunder: "#e8432f"
  sq-light: "#dfe4f0"
  sq-dark: "#5b6f9a"
  sq-hl-light: "#f3d58a"
  sq-hl-dark: "#c9a24a"
  day-panel: "#fbf9f4"
  day-raised: "#e6e0d3"
  day-seam: "#d6cfbf"
  day-seam-strong: "#aea591"
  day-ink-2: "#2f3d63"
  day-ink-3: "#4c5a80"
  day-sign-2: "#1b2e5e"
  day-sign-line: "#33467a"
  day-sign-ink-2: "#b9c3dc"
  day-band: "#9c937f"
  day-focus: "#c47a00"
  day-danger: "#b8281a"
  day-danger-ground: "#fbe3df"
typography:
  display:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2rem, 4.6vw, 3.5rem)"
    fontWeight: 900
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2.25rem)"
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  station:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sign:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 800
    lineHeight: 1.5
  label:
    fontFamily: "Overpass, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "0.06em"
rounded:
  clock: "5px"
  tip: "6px"
  stop: "7px"
  field: "8px"
  sign: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  gutter: "16px"
  lg: "22px"
  xl: "32px"
components:
  button-platform:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.midnight-enamel}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "9px 18px 7px"
    height: "42px"
  button-platform-hover:
    backgroundColor: "{colors.sign-2}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.pill}"
    padding: "9px 18px 7px"
    height: "42px"
  button-step:
    backgroundColor: "{colors.enamel-panel}"
    rounded: "{rounded.pill}"
    width: "52px"
    height: "44px"
  nav-pill:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "8px 14px 6px"
  nav-pill-current:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.midnight-enamel}"
  input:
    backgroundColor: "{colors.enamel-panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.field}"
    padding: "9px 14px 7px"
    height: "44px"
  station-sign:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.midnight-enamel}"
    rounded: "{rounded.sign}"
    padding: "20px 22px 24px"
  panel:
    backgroundColor: "{colors.enamel-panel}"
    rounded: "{rounded.sign}"
    padding: "18px 18px 20px"
  mark-bullet:
    rounded: "{rounded.pill}"
    size: "20px"
  station-stop-current:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.midnight-enamel}"
    rounded: "{rounded.stop}"
    padding: "5px 10px 3px"
  eval-tile:
    backgroundColor: "{colors.midnight-enamel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.stop}"
    padding: "7px 11px 5px"
---

# Design System: ChessDebrief

## Overview

**Creative North Star: "The Night Line"**

A game is a journey on one transit line. Phases are fare zones, marked moves are interchanges, and the move you are on is a station sign. The whole app is drawn in that grammar: a midnight enamel ground, porcelain enamel signs that carry the content, a single porcelain route that threads through the review, the games list and Insights, and round route bullets as the only place colour speaks.

Density is that of a good transit map: few materials, heavy confident labels, everything else quiet. The ground recedes, the sign in front of you is the brightest object on screen, and the route ties the parts together. Night is the default. Day is the same line in daylight: the ground turns porcelain and the signs turn to midnight enamel, by swapping roles rather than inventing a second palette.

The system rejects the category default it replaced (a dark slate panel with an eval bar and a move table), the sterile dashboard, flash, and clutter. It must not resemble Chess.com or Lichess.

**Key Characteristics:**
- Two materials only: midnight enamel ground and porcelain enamel signs, swapped in day.
- One porcelain route line connects the move list, the line map, the games list and the Insights figures.
- Mark colours appear only on round route bullets, always with a glyph.
- One face, Overpass, set heavy (800 to 900) for signs and regular for prose.
- Controls are rounded platform buttons and pills; containers are 12px enamel plates.
- Flat: depth comes from tone and 1px seams, not shadow.

## Colors

A two-material palette of midnight enamel and porcelain, with a quarantined set of bright transit-bullet colours for move marks.

### Primary
- **Porcelain Enamel** (porcelain): the sign plate, the route line, the current nav stop and the platform button in night; the ground in day. It is the one bright surface, so it always marks what you are on.
- **Midnight Enamel** (midnight-enamel): the night ground and the ink on every porcelain sign; the sign plate and route in day. Also the clock tile and eval tile on a sign.

### Tertiary (mark bullets)
- **Brilliant Cyan** (brilliant), **Great Cobalt** (great), **Best Green** (best), **Excellent Leaf** (excellent), **Good Slate** (good), **Book Brass** (book), **Forced Steel** (forced), **Inaccuracy Amber** (inaccuracy), **Miss Magenta** (miss), **Mistake Orange** (mistake), **Blunder Scarlet** (blunder): the fills of the round move-mark bullets and the interchange stops on the line map. Glyphs sit in white on the darker fills and in midnight on the lighter ones (excellent, good, book, forced, inaccuracy, mistake). The same fills hold in both themes.

### Neutral
- **Enamel Panel** (enamel-panel): panels, inputs, the line-map plate, hover ground. Day: day-panel.
- **Enamel Raised** (enamel-raised): hover on list stops and motif rows, quiet table rules, progress tracks. Day: day-raised.
- **Seam** (seam) and **Strong Seam** (seam-strong): 1px hairlines between panels, topbar and footer rules, field borders, zone dividers, and the under-stroke of the route. Day: day-seam, day-seam-strong.
- **Ink Two** (ink-2) and **Ink Three** (ink-3): secondary and tertiary text on the ground (labels, metadata, axis text). Day: day-ink-2, day-ink-3.
- **Sign Two** (sign-2), **Sign Line** (sign-line), **Sign Ink Two** (sign-ink-2): hover plate, dashed rule and secondary ink inside a porcelain sign. Day: day-sign-2, day-sign-line, day-sign-ink-2.
- **Band** (band): the dotted 50% line on the line map. Day: day-band.
- **Signal Amber** (focus): focus rings, text selection, hover on the line map and pulse plot. Day: day-focus.
- **Alarm** (danger on danger-ground): error notices only. Day: day-danger on day-danger-ground.
- **Board squares** (sq-light, sq-dark, with sq-hl-light / sq-hl-dark for the last move): a cool porcelain-and-steel board with a neutral straw last-move highlight that is not a mark colour.

### Named Rules
**The Bullet Quarantine Rule.** Mark colours live only on round route bullets, and every bullet carries its glyph (!!, !, star, check, dot, book, square, ?!, cross, ?, ??). Never as text colour, never as a band, bar, border or fill behind text. The one exemption is the brand roundel (scarlet ring, cobalt bar) and its echo on the current nav stop.

**The Two Materials Rule.** Every surface is either ground or sign. Day swaps them; it does not add a third.

**The Porcelain Route Rule.** The route is one porcelain line (midnight in day), never coloured by result or mark. Emphasis on a route is porcelain over a seam under-stroke; de-emphasis is seam-strong.

## Typography

**Display Font:** Overpass, variable 100 to 900, self-hosted (with system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Overpass (same face)

**Character:** One humanist sign face, the kind that reads at speed on a platform. Hierarchy comes from weight and size, not from a second family: 900 for station names and figures, 800 for titles and controls, 700 for labels, 400 for prose.

### Hierarchy
- **Display** (900, clamp(2rem, 4.6vw, 3.5rem), 1.02, -0.03em): the welcome headline on Home only, held to 14ch.
- **Headline** (900, clamp(1.6rem, 3vw, 2.25rem)): page titles on Games and Insights; About uses clamp(1.8rem, 3.6vw, 2.75rem); the review header uses 800 at clamp(1.3rem, 2.4vw, 1.875rem).
- **Station** (900, 2rem, 1, -0.02em): the move on the station sign; 1.625rem under 480px.
- **Title** (800, 1.125rem): panel headings; prose h2 at 1.375rem.
- **Body** (400, 1rem, 1.5): general text. On signs, 1.0625rem at 1.5 held to 62ch; prose 1.0625rem at 1.65 held to 68ch.
- **Control** (800, 0.9375rem): buttons, nav pills, move stops (700).
- **Label** (800, 0.8125rem, 0.06em, uppercase): column headings such as "Moves" and "Summary". Line-map zone names (OPENING, MIDDLEGAME, ENDGAME) are 10px 800 at 0.08em, the way a fare zone is lettered.

### Named Rules
**The Heavy Sign Rule.** Anything you read at a glance (move, eval, accuracy, figure value) is 900 with tabular numerals. Prose stays at 400.

**The One Face Rule.** Overpass only. No second display face, no monospace for notation.

## Layout

A 1240px max container with a 16px gutter and a sticky 60px topbar. Review is the anchor: at 960px and wider it is two columns, the board stage at min(52vw, 100dvh minus 250px, 620px) and sticky under the topbar, the side column at least 360px, with a 32px gap. Below 960px (and at least 560px tall) the board stays pinned at the top, capped at 55dvh plus 40px, the notes scroll under it, and the step controls become a fixed bottom bar under the thumb.

Lines run through layouts. The station list has a 6px porcelain route as its left edge with a short tick to each move number. The games list runs a 6px seam route down the left with each game's result bullet sitting on it. The Insights figures sit on a horizontal 4px route with a ring stop above each figure; under 640px the strip turns to run down the left. Panels go two-up at 720px and wider.

Rhythm is 4, 8, 14, 16, 22 and 32px: 22px between review blocks, 14 to 16px inside panels, 8px between controls. Optical padding on pills and fields is 2px heavier on top than bottom (for example 9px 18px 7px) to centre Overpass's tall caps.

## Elevation & Depth

The system is flat. Depth is tonal: the porcelain sign sits in front of the midnight ground by brightness alone, and enamel panels are separated from the ground by a 1px inset seam (inset 0 0 0 1px seam). Quiet buttons and segmented controls draw their outline as a 2px inset rather than a border.

### Shadow Vocabulary
- **Floating tip** (`box-shadow: 0 4px 12px rgb(0 0 0 / 0.3)`): hover tooltips on the line map and charts only, because they float over a drawing.
- **Board bullet** (`box-shadow: 0 0 0 3px #f3efe6, 0 2px 6px rgb(0 0 0 / 0.35)`): the mark bullet pinned to a board square, ringed in porcelain so it reads over any piece.

### Named Rules
**The Seam Not Shadow Rule.** Panels, signs, cards and buttons cast no shadow. Separation is a 1px seam or a change of enamel.

## Shapes

Round where the transit world is round, gently cornered where it is a plate. Signs, panels and the board frame are 12px plates; fields and list rows are 8px; move stops and eval tiles 7px; tips 6px; the clock 5px. Every control that moves you is a full pill or a circle: buttons, nav, segmented options, step controls, the theme toggle. Every stop on a line is a circle: mark bullets, result bullets, figure stops, takeaway rings, the "you are here" ring. The line-map route is octilinear: it only runs flat, upright or at 45 degrees between stations, with round joins and caps.

## Components

### Buttons
Rounded platform buttons, confident and plain.
- **Shape:** full pill (999px), at least 42px tall (34px small, 50px in the importer).
- **Platform (primary):** porcelain plate, midnight ink, 800 weight; hover to sign-2; press nudges down 1px.
- **Quiet:** transparent with a 2px strong-seam inset ring; hover fills enamel-panel and the ring brightens to ink-3.
- **Step controls:** 52 by 44px pill, enamel-panel with a 2px seam border; 60 by 46px in the mobile bottom bar.
- **Focus:** 3px signal-amber outline, 2px offset, everywhere.
- **Disabled:** 0.45 opacity (0.35 for step controls).

### Chips (pills)
- **Line pill:** midnight on porcelain inside a sign ("Show line" style actions), 0.8125rem 800.
- **Segmented:** two route pills in an enamel-panel track with a 2px seam inset; the checked option becomes a porcelain plate.

### Cards / Containers
- **Station sign:** porcelain plate, 12px, padding 20px 22px 24px, no base band, no stripe. Mark bullet at 46px, move in Station type, mark and phase in sign-ink-2, eval tile (midnight on porcelain, 7px) at the right, the why at 1.0625rem, and "Better was" lines under a 2px dashed sign-line rule.
- **Panel:** enamel-panel, 12px, 1px inset seam, padding 18px 18px 20px. Used for Insights charts, the line map and the add-games bar.
- **Takeaways sign:** a porcelain sign listing service announcements, each led by a 14px midnight ring stop.

### Inputs / Fields
- **Style:** enamel-panel fill, 2px seam border, 8px corners, 44px tall; selects carry a drawn chevron.
- **Hover:** border to strong seam. **Focus:** the global amber outline.
- **Error:** an alarm notice (danger-ground with a 1px danger inset and danger strong text).

### Navigation
Topbar on the ground with a seam rule below. Brand is the roundel (32px scarlet ring crossed by a cobalt bar, "!!" in porcelain) plus the name in 900. Nav items are pills in ink-2 with a small round stop; hover fills enamel-panel; the current page is a porcelain plate with a scarlet stop. The theme toggle is a 40px circle with a seam border. Under 480px the wordmark hides and the roundel stands alone.

### Mark Bullet (signature)
A round bullet, 20px in lists (18px in the station list, 46px on the sign, up to 32px on the board), filled with its mark colour and always carrying its glyph in 900. It is the only carrier of mark colour.

### Line Map (signature)
White's winning chances drawn as one octilinear route on an enamel panel: a 6px porcelain line over an 11px seam under-stroke, phases as fare zones split by dashed seam dividers with lettered zone names, a dotted band at 50%, interchange stops for brilliant, great and error moves, and a "you are here" ring (porcelain, 4px midnight stroke) with a porcelain name plate. The ring slides between stations in 0.28s on cubic-bezier(0.16, 1, 0.3, 1) and respects reduced motion. Every point is clickable and draggable.

### Station List (signature)
The moves as stops on a 6px porcelain route forming the list's left edge, a short route tick to each move number, and the current move as a porcelain plate.

### Station Strip (signature)
Insights headline figures as stops on one 4px route: a ring stop above each figure, label in ink-3, value in 900 tabular. Never stat cards. Under 640px the route runs vertically down the left.

### Pulse Plot
"Every game, one line": each reviewed game as a 1.4px porcelain route with an enamel-panel fill, a result chip at its head (porcelain for a win, ringed otherwise), amber on hover or focus.

## Do's and Don'ts

### Do:
- **Do** put the thing you are on in porcelain: the current move, page, stop and segmented option.
- **Do** carry every move mark as a round bullet with its glyph, so quality never rests on colour alone.
- **Do** run lists and figure groups along a route line rather than boxing them.
- **Do** separate panels with a 1px inset seam and shift enamel tone for hover.
- **Do** set glanceable numbers in 900 with tabular numerals.
- **Do** build day by swapping ground and sign, keeping mark fills unchanged.

### Don't:
- **Don't** use a mark colour as text colour, a band, a bar, a border or a background behind text.
- **Don't** put a coloured base band, stripe or edge on a sign.
- **Don't** colour the route by result or mark; it is porcelain (midnight in day).
- **Don't** render Insights figures as stat cards.
- **Don't** add drop shadows to signs, panels or buttons.
- **Don't** introduce a second typeface.
- **Don't** borrow Chess.com or Lichess colours, layouts or board themes.
