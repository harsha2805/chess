<?php

namespace App\Console\Commands;

use App\Exceptions\ChessSiteLimited;
use App\Models\ChessAccount;
use App\Services\GameFetcher;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Checks the chess accounts that are due for new games. The scheduler runs it every 15
 * minutes; each account is checked once its last check is `fetch_every_hours` old, so the
 * work spreads out instead of arriving all at once.
 */
#[Signature('games:fetch {--limit=100 : Most accounts to check in one run} {--all : Check every account of an active person, due or not}')]
#[Description('Fetch new chess.com and Lichess games for linked accounts that are due')]
class FetchGames extends Command
{
    public function handle(GameFetcher $fetcher): int
    {
        $every = (int) round(config('chessdebrief.fetch_every_hours') * 3600);
        $activeSince = now()->subDays(config('chessdebrief.active_days'));

        $accounts = ChessAccount::query()
            ->when(! $this->option('all'), fn ($q) => $q->stale($every))
            ->whereHas('user', fn ($q) => $q->where('last_seen_at', '>=', $activeSince))
            ->orderByRaw('last_fetched_at IS NOT NULL, last_fetched_at')
            ->limit((int) $this->option('limit'))
            ->get();

        $added = 0;
        $limited = [];
        foreach ($accounts as $i => $account) {
            if (in_array($account->platform, $limited, true)) {
                continue;
            }
            // Both sites ask for one request at a time.
            if ($i > 0) {
                usleep(300_000);
            }
            try {
                $new = $fetcher->fetch($account);
                $added += $new;
                $this->line(sprintf('%s: %s', $account->key(), $account->last_error ?? "{$new} new"));
            } catch (ChessSiteLimited $e) {
                $limited[] = $account->platform;
                $this->warn("{$account->key()}: {$e->getMessage()}");
            }
        }

        $this->info("Checked {$accounts->count()} accounts, {$added} new games.");

        return self::SUCCESS;
    }
}
