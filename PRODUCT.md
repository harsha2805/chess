# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Improving club players, roughly 800 to 2000, who play many online games on chess.com or Lichess. They have just lost (or won) a game, or a run of games, and want to know where each one turned and what keeps going wrong. They usually arrive with a username, not a PGN file, and often review a batch at once.

## Product Purpose

ChessDebrief gives a full engine review of a player's games for free and without limits, and then shows what their games have in common. Success is a player leaving with one or two concrete, recurring habits to fix, not just a list of red marks on a single game.

## Positioning

- **Free and unlimited.** Full move-by-move reviews with no paywall and no daily cap. That's possible because Stockfish runs in the visitor's own browser, so there's no server cost per review.
- **Patterns across games.** The Insights page sets it apart. It shows accuracy by phase and by game, error rate against the clock, the most common error patterns with links to the positions, and results by opening.
- **Explains why.** Each error comes with a short plain-language reason: a piece left to be taken, a missed capture, a fork, a missed or allowed mate, time pressure.

## Operating Context

- A player finishes a session on chess.com or Lichess, opens ChessDebrief, enters a username (or pastes a profile link or PGN), and queues recent games for review.
- Reviews run in the background with a progress indicator, and results are cached, so nothing is analysed twice.
- Reviewing a game means stepping through moves on a board, reading the marks, the winning-chances graph, the engine's better line and the note on why.
- Once three or more games are reviewed, the Insights page summarises them.

## Capabilities and Constraints

- Static site with no backend. It's built with Vite, React 19 and TypeScript, deployed by uploading `dist/` to shared hosting (DirectAdmin or cPanel). The only server code is `public/api/report.php`, which emails bug reports.
- Stockfish 19 runs as single-threaded WebAssembly in a Web Worker, by design, because that needs no special headers. Games and reviews live in IndexedDB.
- Routes: Games (home or library), Review (`#/game/:id/:ply`), Insights, How it works (About), Report a bug. Hash routing is used, and the preview build keeps routes in memory.
- Move marks: brilliant, great, best, excellent, good, book, forced, inaccuracy, miss (missed chance), mistake, blunder. Their thresholds are product facts, documented on the About page.
- Accuracy uses the formula Lichess publishes, so numbers differ a little from chess.com.
- Review depth presets can be chosen. Username import calls the public chess.com and Lichess APIs straight from the browser.
- A preview build (`npm run build:preview`) turns off username import and report sending.
- The name is kept in one place: `src/config.ts`.

## Brand Commitments

- Name: ChessDebrief. The brand mark is "!!", the brilliant-move annotation.
- Voice: plain, direct, and unhyped. It uses short factual sentences and avoids chess jargon where everyday words work ("gives up winning chances", "piece left to be taken").
- Not affiliated with Chess.com or Lichess, and must not look like either.

## Evidence on Hand

- The built-in sample is Morphy against Duke Karl and Count Isouard, Paris 1858 (the Opera Game), in `src/config.ts`.
- Test games are in `tests/games/`. `fixtures.pgn` is synthetic and only for testing.
- Piece SVGs by Colin M. L. Burnett (GPL 2 or later) are in `src/assets/pieces/`.
- There are no testimonials, user counts, ratings or press. Don't invent any.

## Product Principles

1. **The pattern beats the single game.** Design should lead players from one game's review to what repeats across their games.
2. **Say why, in plain words.** A mark without a reason is noise. Explanations come before decoration.
3. **Free and honest.** No dark patterns, no upsells, no fake scarcity. Be clear about what the engine can't tell you.
4. **Your games stay with you.** Everything runs locally. Never imply uploads, accounts, or servers that don't exist.

## Accessibility & Inclusion

Move quality must never be conveyed by colour alone. Marks carry symbols or labels, because players with colour-vision differences need to tell a mistake from an inaccuracy. Board and move list should be usable by keyboard.
