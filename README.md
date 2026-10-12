# ChessDebrief

Free review of chess games, in the browser. It gets a player's recent games from
chess.com or Lichess (or takes a pasted PGN), runs Stockfish over every position,
marks each move, and then looks for patterns across all the reviewed games.

There is no server-side engine. Stockfish runs as WebAssembly in a Web Worker and
games are stored in the browser's IndexedDB. Accounts are optional: signed in, games
and reviews are also kept on the server (a Laravel app in `backend/`), so they are on
every device, and the server fetches new games from linked chess.com and Lichess
accounts every 2 hours.

The name lives in one place, `src/config.ts`.

## What it does

- **Import**: username lookup on chess.com or Lichess (a pasted profile link works
  too), PGN paste of one or many games, and a built-in sample game.
- **Review**: every move gets a mark (brilliant, great, best, excellent, good, book,
  forced, inaccuracy, missed chance, mistake, blunder), an accuracy score per side,
  a winning-chances graph, the engine's better line, and a short note on *why*
  (piece left to be taken, missed capture, fork, missed or allowed mate, time pressure).
- **Batch review**: queue any number of games; reviews are cached, so nothing is
  analysed twice.
- **Insights**: accuracy by phase and by game, error rate against the clock, the most
  common error patterns with links to the positions, and results by opening.
- **Accounts (optional)**: sign up with an email and password. Games and reviews sync
  between browsers. Accounts you get games for by username are checked for new games
  every 2 hours by a scheduled job, while the app is open, and on "Check for new games".
- **Bug reports**: a form that emails the developer through the backend (`POST /api/report`).

## How a move is judged

1. Stockfish scores every position (two best lines, fixed depth). Positions are
   analysed from the last to the first so later findings help earlier positions.
2. Scores are made consistent along the game: the position after a move was searched
   one move deeper, so that score replaces the shallower estimate (`reconcile` in
   `src/lib/analyze.ts`).
3. Each score becomes winning chances (0 to 100). A move is judged by the winning
   chances it gave away. Thresholds are listed on the site's "How it works" page and
   in `buildReview`.
4. Brilliant and great moves, and the notes, come from rules on top of that: static
   exchange evaluation for sacrifices and hanging pieces, a fork detector, and the
   engine's mate scores (`src/lib/see.ts`).

The accuracy formula is the one Lichess publishes. Numbers will differ a little from
chess.com, which uses its own formula.

## Develop

```bash
npm install
cd backend && composer install && cp .env.example .env && php artisan key:generate && cd ..
# Create a MySQL database "chessdebrief", set DB_* in backend/.env, then:
php backend/artisan migrate

npm run dev:api    # Laravel on http://127.0.0.1:8000
npm run dev        # the app on http://localhost:5173; /api and /sanctum are proxied to Laravel
npm test           # unit tests, plus reviews with the real engine in Node
php backend/artisan test   # backend tests (SQLite in memory)
npm run analyze -- tests/games/opera.pgn 12   # review a PGN in the terminal
```

Requires Node 20 or newer, PHP 8.3 or newer and Composer. `npm run dev` and
`npm run build` first copy the engine from `node_modules/stockfish` into `public/engine`.
With Laragon, mail goes to Mailpit (http://localhost:8025), as set in `backend/.env`.

Without the backend running, the app still works and the account features stay hidden.

## How accounts sync

- The browser keeps working from IndexedDB. Signed in, every game added, reviewed or
  removed goes into an outbox (in localStorage) and is sent to `POST /api/games/sync`.
  Changes made elsewhere are pulled from `GET /api/games` in `(updated_ms, id)` order.
- Of two reviews of a game, the newer one is kept, on both sides.
- Games the server fetches are stored as chess.com or Lichess sent them. The browser
  turns them into records with the same importer code it uses itself
  (`recordFromRaw` in `src/lib/importers.ts`).
- A removed game keeps an empty row on the server, so the scheduled fetch never
  brings it back.
- Sign-in is Laravel Sanctum's cookie session for single-page apps, so there are no
  tokens in the browser. Signing out removes the games from that browser.

## Deploy on shared hosting (DirectAdmin, cPanel)

No command line is needed on the server.

1. Build the zip: `npm run deploy:zip`. It builds the app, copies it into
   `backend/public/`, installs production packages in a separate copy (your working
   `backend/vendor` is untouched) and writes `deploy/chessdebrief-<version>-<time>.zip`.
   For the first deploy, pass a production `.env` to include:
   `npm run build:server && node scripts/make-deploy.mjs --env path/to/production.env`.
   Update zips leave `.env` out, so the server keeps its own.
2. The zip holds two folders: `chessdebrief/` (the Laravel app) and `public_html/` (its
   public files). Upload it to the folder that contains the site's `public_html`
   (DirectAdmin: `domains/<site>/`), empty `public_html` first, and extract there. The
   app then sits beside the web root, where nothing in it can be opened from the web;
   `index.php` and `maintenance.php` find it there. (With a document root you can point
   anywhere, the usual Laravel layout works too: the app with `public/` inside it.)
3. Edit `chessdebrief/.env`: `APP_URL`, the MySQL details and `MAIL_PASSWORD`.
4. Open `https://your.domain/maintenance.php`, sign in with `CHESSDEBRIEF_ADMIN_PASSWORD`,
   then press **Run migrations** and **Cache config and routes**. After later uploads, run
   migrations again; after editing `.env`, press **Clear caches**.
5. Scheduled fetch, either one:
   - a cron job that can run PHP: `* * * * * cd ~/domains/<site>/chessdebrief && php artisan schedule:run >> /dev/null 2>&1`
   - or, every 15 minutes, open the web cron address shown on the maintenance page
     (`maintenance.php?cron=<CHESSDEBRIEF_CRON_TOKEN>`), with a cron job running
     `wget -q -O /dev/null "<address>"` or a service such as cron-job.org.
6. `storage/` and `bootstrap/cache/` must be writable by PHP (the maintenance page checks).

The maintenance page runs only a fixed list of commands (migrations, caches, the game
fetch, a test email, the error log) and is off while `CHESSDEBRIEF_ADMIN_PASSWORD` is
empty. Five wrong passwords lock it for 15 minutes.

`backend/public/.htaccess` sets the WebAssembly MIME type, compression and caching, and
serves `index.html` for `/`. The single-threaded engine is used on purpose: it needs no
special headers.

Username import calls `api.chess.com` and `lichess.org` straight from the visitor's
browser. Both allow that from any site. The scheduled fetch calls them from the server,
with `CHESSDEBRIEF_CONTACT` in the User-Agent, as both sites ask.

## Preview build

`npm run build:preview -- <folder>` makes a variant for sandboxed preview pages that
cannot reach other sites: username import, accounts and report sending are off, routes
are kept in memory, and a plain JavaScript engine is included as a backup for frames that
refuse WebAssembly.

## Layout

```
src/lib/        engine client, PGN parsing, review logic, importers, storage, insights
src/ui/         React components (board, review, games list, insights, forms)
src/data/       openings book, generated by scripts/build-openings.mjs
backend/        Laravel API: accounts, game sync, scheduled fetch, bug reports
scripts/        engine copy, openings build, terminal reviewer, preview build, copy to backend
tests/          Vitest suites and sample games
```

`tests/games/fixtures.pgn` holds synthetic games (engine self-play with injected
errors and clocks) used only for testing.

## Credits and licences

- [Stockfish](https://stockfishchess.org/) 19, WebAssembly build by Nathan Rugg
  ([stockfish.js](https://github.com/nmrugg/stockfish.js)), GPL 3.
- [chess.js](https://github.com/jhlywa/chess.js), BSD 2-Clause.
- Chess pieces by Colin M. L. Burnett, GPL 2 or later.
- Opening names from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0.
- Literata and Hanken Grotesk typefaces, SIL Open Font License.

ChessDebrief is free software under the GNU General Public License, version 3 or
later (see `LICENSE`). Because the site ships Stockfish and the piece set, anyone
who hosts it must also make the source available.

Not affiliated with Chess.com or Lichess.
