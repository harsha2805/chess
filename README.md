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
- **Accounts (optional)**: sign up with an email and password, or with Google. Games and reviews sync
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

## Sign-in with Google

Off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `backend/.env`.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. **APIs & Services > OAuth consent screen**: choose "External", give the app name,
   a support email and the site's home page. The scopes needed are the basic ones
   (`openid`, `email`, `profile`), which need no review from Google.
   Publish the app ("In production"); while it is "Testing", only listed test users can sign in.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**, type
   "Web application". Under **Authorized redirect URIs** add
   `https://your.domain/auth/google/callback` (and `http://localhost:5173/auth/google/callback`
   for development). No JavaScript origins are needed.
4. Put the client ID and secret in `.env`, then press **Clear caches** on the admin page (`#/admin`).

A Google address that already has an account is linked to it only when Google says the
address is verified. People who sign in only with Google have no password; they confirm
account deletion by typing their address, and can set a password with "Forgot your password?".

## Donations

Set `CHESSDEBRIEF_DONATE_URL` in `backend/.env` to a donation page (https), and a
"Support ChessDebrief" link appears in the footer and on the About page. It is hidden
while empty. Any provider works, since the site only links to it.

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
   `index.php` finds it there. (With a document root you can point
   anywhere, the usual Laravel layout works too: the app with `public/` inside it.)
3. Edit `chessdebrief/.env`: `APP_URL`, the MySQL details, `MAIL_PASSWORD`, and your
   address in `CHESSDEBRIEF_ADMIN_EMAILS`.
4. First deploy only: set `CHESSDEBRIEF_SETUP_PASSWORD` (16+ characters), open
   `https://your.domain/setup` and create the tables. The page then switches itself off.
5. Sign in to the site with Google using that address (or verify it once with
   "Forgot your password?"), then open **Account > Open the admin page** (`#/admin`).
   After every later upload: **Update > Run migrations**, then **Clear caches**, then
   **Cache config and routes**. After editing `.env`, press **Clear caches**.
6. Scheduled fetch, either one:
   - a cron job that can run PHP: `* * * * * cd ~/domains/<site>/chessdebrief && php artisan schedule:run >> /dev/null 2>&1`
   - or a cron job opening the web cron address every 15 minutes (minutes `0,15,30,45`).
     Make the address under **Admin > Cron**, which also gives the full
     `wget -q -O /dev/null "https://your.domain/cron?token=…"` command.
7. `storage/` and `bootstrap/cache/` must be writable by PHP (the admin page checks).

The admin page runs only a fixed list of commands (migrations, caches, the game fetch, a
test email, the error log). It is open to accounts listed in `CHESSDEBRIEF_ADMIN_EMAILS`
whose address is verified: sign-up does not check addresses, so an unverified account with
your address never counts. The cron token is stored hashed and shown only once.

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
