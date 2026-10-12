# ChessDebrief backend

The Laravel 13 API behind ChessDebrief's optional accounts. The app itself is the React
build in the repository root, copied into `public/` by `npm run build:server`.

- `routes/api.php`: sign-in (Sanctum cookie sessions), game sync, chess accounts, refresh, bug reports
- `app/Services/GameSync.php`: storing and pulling games; the newer review wins; removed games stay as empty rows
- `app/Services/GameFetcher.php`: new games from chess.com and Lichess, stored as the sites send them
- `app/Console/Commands/FetchGames.php` and `routes/console.php`: `games:fetch`, scheduled every 15 minutes
- `config/chessdebrief.php`: fetch interval, contact for the chess sites, bug report mail options

Setup, development and deployment are in the main [README](../README.md).

```bash
php artisan test
php artisan games:fetch          # check the accounts that are due now
php artisan games:fetch --all    # check every account of an active person
```
