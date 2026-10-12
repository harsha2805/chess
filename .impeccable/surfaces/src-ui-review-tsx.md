---
version: 1
slug: "src-ui-review-tsx"
primary_target: "src/ui/Review.tsx"
related_targets: ["src/App.tsx","src/ui/Home.tsx","src/ui/Insights.tsx","src/styles.css"]
---

# Surface brief: Postmortem app (review screen leads; games list, home, insights, about, report inherit)

Scope: whole app redesign, led by the game review screen. Visitor mode: Operate.
Audience: improving club players (800 to 2000) reviewing chess.com and Lichess games on laptop and phone equally.
Job: step through a game, see where it turned and why, then see what repeats across games (Insights).
Constraints: static site, no new features or claims; every route, control, keyboard shortcut and state is kept. User asked to avoid: sterile dashboard, too flashy, cluttered.
Chosen: Night Line (dealt challenger "midnight transit diagram", bolder register), with Catalog's one-line-per-game pulse plot moved to Insights and redrawn in Night Line's palette.

## Direction contract

THESIS: A game is a journey on one transit line. Phases are fare zones, marked moves are interchanges, and the move you are on is a station sign. This replaces the category default of a dark slate panel with an eval bar and a move table.

OWN-WORLD: Midnight enamel ground (#0d1830), porcelain enamel signs (#f3efe6) carry content, and hairline seams separate panels. The route line is porcelain. Mark colours are quarantined to round route bullets (brilliant cyan, great cobalt, best green, inaccuracy amber, mistake orange, blunder scarlet), always with a glyph. Overpass is the single humanist sign face, set heavy for signs and regular for prose. Controls are rounded platform buttons and pills. A day variant uses porcelain ground with enamel signs.

STORY: The player sees the move, its mark and the plain-language why at once, and can jump to any station on the line. Across games, Insights shows which error lines they keep riding.

FIRST VIEWPORT: Review, desktop. The board takes the left column (up to 600px), framed by porcelain name plates carrying player and accuracy. The right column holds the station sign: bullet, move at about 2rem/900, mark and phase, eval tile, the why, and "Better was". Below it sits the line map, an octilinear route over fare zones with interchange bullets, then the station list of moves. Controls are pill buttons under the board.

FORM: Midnight transit diagram, fused (dealt challenger 1 of the bolder hand; seed key 038a3e9e).

SIGNATURE INTERACTION: Stepping moves the "you are here" ring along the route, and the station sign changes with it. Every station on the line map is clickable. Motion is one short slide of the ring between stations, using ease-out, and it respects reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
