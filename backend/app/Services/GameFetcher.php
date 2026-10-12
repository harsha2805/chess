<?php

namespace App\Services;

use App\Exceptions\ChessSiteLimited;
use App\Models\ChessAccount;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Brings in the games a chess account finished since it was last checked.
 *
 * Games are stored as the chess site sent them; the app turns them into records with the
 * same code it uses for its own imports. A game already stored, or removed by the person,
 * is left alone.
 */
class GameFetcher
{
    /** Games ending this close before the watermark are looked at again, in case one was missed. */
    private const OVERLAP_MS = 3_600_000;

    /** At most this many games come in from one check. */
    private const MAX_GAMES = 200;

    private const NAMES = ['chesscom' => 'chess.com', 'lichess' => 'Lichess'];

    /**
     * Checks one account. Problems are recorded on the account rather than thrown, except a
     * chess site limiting requests, which is thrown after it is recorded so a batch can stop asking.
     *
     * @return int How many games were new.
     *
     * @throws ChessSiteLimited
     */
    public function fetch(ChessAccount $account): int
    {
        $startedMs = GameSync::nowMs();
        $since = $account->watermark_ms - self::OVERLAP_MS;
        try {
            $rows = $account->platform === 'chesscom' ? $this->chessCom($account, $since) : $this->lichess($account, $since);
        } catch (ChessSiteLimited $e) {
            $account->forceFill(['last_fetched_at' => now(), 'last_error' => $e->getMessage()])->save();
            throw $e;
        } catch (RuntimeException $e) {
            $account->forceFill(['last_fetched_at' => now(), 'last_error' => mb_substr($e->getMessage(), 0, 250)])->save();

            return 0;
        }

        usort($rows, fn ($a, $b) => $b['played_ms'] <=> $a['played_ms']);
        $rows = array_slice($rows, 0, self::MAX_GAMES);
        $added = 0;
        foreach (array_chunk($rows, 50) as $chunk) {
            $added += DB::table('games')->insertOrIgnore(array_map(fn (array $row) => $row + [
                'user_id' => $account->user_id,
                'source' => $account->platform,
                'account' => $account->key(),
                'added_ms' => $startedMs,
                'updated_ms' => GameSync::nowMs(),
                'deleted' => false,
            ], $chunk));
        }

        $account->forceFill(['watermark_ms' => $startedMs, 'last_fetched_at' => now(), 'last_error' => null])->save();

        return $added;
    }

    private function http(): PendingRequest
    {
        $contact = config('chessdebrief.contact');

        return Http::withUserAgent(trim(config('app.name').' (game review; '.($contact ?: config('app.url')).')'))
            ->timeout(20)
            ->connectTimeout(8);
    }

    private function get(ChessAccount $account, string $url, array $headers = []): Response
    {
        $site = self::NAMES[$account->platform];
        try {
            $response = $this->http()->withHeaders($headers)->get($url);
        } catch (ConnectionException) {
            throw new RuntimeException("Could not reach {$site}.");
        }
        if ($response->status() === 404) {
            throw new RuntimeException("No {$site} player is called \"{$account->username}\".");
        }
        if ($response->status() === 429) {
            throw new ChessSiteLimited("{$site} is limiting requests. Trying again later.");
        }
        if (! $response->successful()) {
            throw new RuntimeException("{$site} answered with an error ({$response->status()}).");
        }

        return $response;
    }

    /**
     * chess.com keeps games in monthly archives. The months from the watermark on are read,
     * at most the last three.
     *
     * @return list<array{game_id: string, played_ms: int, raw: string}>
     */
    private function chessCom(ChessAccount $account, int $since): array
    {
        $base = 'https://api.chess.com/pub/player/'.rawurlencode($account->username);
        $archives = $this->get($account, "{$base}/games/archives")->object()->archives ?? [];
        $fromMonth = gmdate('Y/m', intdiv(max(0, $since), 1000));
        $months = array_slice(array_values(array_filter($archives, fn ($url) => is_string($url) && substr($url, -7) >= $fromMonth)), -3);

        $rows = [];
        foreach ($months as $url) {
            // Decoded as objects so an empty object stays one when the game is stored again as JSON.
            $games = json_decode($this->get($account, $url)->body())->games ?? [];
            foreach ($games as $game) {
                if (empty($game->pgn) || empty($game->uuid) || ($game->rules ?? 'chess') !== 'chess') {
                    continue;
                }
                $endedMs = (int) ($game->end_time ?? 0) * 1000;
                if ($endedMs < $since) {
                    continue;
                }
                $rows[] = ['game_id' => "chesscom:{$game->uuid}", 'played_ms' => $endedMs, 'raw' => json_encode($game, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)];
            }
        }

        return $rows;
    }

    /**
     * Lichess filters by when a game started, so the request reaches a week further back
     * (for long games) and the games are then filtered by their last move.
     *
     * @return list<array{game_id: string, played_ms: int, raw: string}>
     */
    private function lichess(ChessAccount $account, int $since): array
    {
        $query = http_build_query([
            'since' => max(0, $since - 7 * 86_400_000),
            'max' => 300,
            'clocks' => 'true',
            'pgnInJson' => 'true',
            'perfType' => 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
        ]);
        $url = 'https://lichess.org/api/games/user/'.rawurlencode($account->username).'?'.$query;
        $body = $this->get($account, $url, ['Accept' => 'application/x-ndjson'])->body();

        $rows = [];
        foreach (explode("\n", $body) as $line) {
            $game = trim($line) === '' ? null : json_decode($line);
            if (! is_object($game) || empty($game->id) || empty($game->pgn) || ($game->variant ?? 'standard') !== 'standard') {
                continue;
            }
            $endedMs = (int) ($game->lastMoveAt ?? $game->createdAt ?? 0);
            if ($endedMs < $since) {
                continue;
            }
            $rows[] = ['game_id' => "lichess:{$game->id}", 'played_ms' => (int) ($game->createdAt ?? $endedMs), 'raw' => json_encode($game, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)];
        }

        return $rows;
    }
}
