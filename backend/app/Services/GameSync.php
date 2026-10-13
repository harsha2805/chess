<?php

namespace App\Services;

use App\Models\Game;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Keeps a person's games on the server in step with their browsers.
 *
 * The browser stays the working copy: it pushes games it added, reviews it finished and
 * games it removed, and pulls whatever changed since it last asked, including games the
 * scheduled fetch brought in. Changes are read in (updated_ms, id) order.
 */
class GameSync
{
    public const PAGE = 50;

    /** How long a claim on a game lasts unless renewed. Hidden tabs renew about once a minute. */
    public const CLAIM_MS = 180_000;

    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /**
     * How strong a review is, compared element by element as the app does (reviewRank in
     * src/lib/types.ts): the review format, the depth asked for, the depth reached, how deep its
     * critical moves were checked, then the time it was made. Reviews that predate a field count it as 0.
     *
     * @return array{int, int, float, int, int}
     */
    public static function rank(?string $review, ?int $ms): array
    {
        $r = $review === null ? null : json_decode($review, true);
        if (! is_array($r)) {
            return [0, 0, 0.0, 0, $ms ?? 0];
        }
        $depth = (int) ($r['depth'] ?? 0);

        return [(int) ($r['version'] ?? 0), $depth, (float) ($r['reached'] ?? $depth), (int) ($r['verifyDepth'] ?? 0), $ms ?? (int) ($r['analyzedAt'] ?? 0)];
    }

    /**
     * Stores games sent by a browser. The record is replaced; the review only when the one sent
     * is stronger (see rank), so a lighter review made later never replaces a deeper one.
     *
     * @param  list<array{id: string, source: string, account?: ?string, playedAt: int, addedAt: int, record: string, review?: ?string, reviewAt?: ?int}>  $items
     */
    public function upsert(User $user, array $items, ?string $device): int
    {
        if ($items === []) {
            return 0;
        }

        return DB::transaction(function () use ($user, $items, $device) {
            $now = self::nowMs();
            $existing = $user->games()->whereIn('game_id', array_column($items, 'id'))->lockForUpdate()->get()->keyBy('game_id');
            foreach ($items as $item) {
                /** @var Game $game */
                $game = $existing->get($item['id']) ?? $user->games()->make(['game_id' => $item['id']]);
                $game->fill([
                    'source' => $item['source'],
                    'account' => $item['account'] ?? $game->account,
                    'played_ms' => $item['playedAt'],
                    // The first time the game reached the server counts, so a re-import does not move it.
                    'added_ms' => $game->exists && $game->added_ms ? $game->added_ms : $item['addedAt'],
                    'record' => $item['record'],
                    'deleted' => false,
                    'updated_ms' => $now,
                    'origin' => $device,
                ]);
                $reviewAt = $item['reviewAt'] ?? null;
                if (! empty($item['review']) && $reviewAt !== null) {
                    if ($game->review === null || self::rank($item['review'], $reviewAt) > self::rank($game->review, $game->review_ms)) {
                        $game->review = $item['review'];
                        $game->review_ms = $reviewAt;
                        // The browser that claimed the game has sent its new review: the claim is done.
                        if ($device !== null && $game->claim_device === $device) {
                            $game->claim_device = null;
                            $game->claim_until_ms = null;
                            $game->claim_progress = null;
                        }
                    } elseif ($item['review'] !== $game->review) {
                        // The stored review is stronger and stays. The browser that sent the
                        // weaker one must pull the game in full, so it is not told "same".
                        $game->origin = null;
                    }
                }
                $game->save();
                $existing->put($item['id'], $game);
            }

            return count($items);
        });
    }

    /**
     * Marks games as removed. The row stays, emptied, so the scheduled fetch does not bring the game back.
     *
     * @param  list<string>  $ids
     */
    public function delete(User $user, array $ids, ?string $device): int
    {
        if ($ids === []) {
            return 0;
        }

        return DB::transaction(function () use ($user, $ids, $device) {
            $now = self::nowMs();
            $empty = [
                'record' => null, 'raw' => null, 'review' => null, 'review_ms' => null, 'deleted' => true, 'updated_ms' => $now, 'origin' => $device,
                'claim_device' => null, 'claim_until_ms' => null, 'claim_progress' => null,
            ];
            $found = $user->games()->whereIn('game_id', $ids)->pluck('game_id')->all();
            $user->games()->whereIn('game_id', $found)->update($empty);
            foreach (array_diff($ids, $found) as $id) {
                $source = strstr($id, ':', true);
                $user->games()->create($empty + [
                    'game_id' => $id,
                    'source' => in_array($source, Game::SOURCES, true) ? $source : 'pgn',
                ]);
            }

            return count($ids);
        });
    }

    /**
     * Games changed after the cursor, oldest change first. A browser passing its own `device`
     * gets only the ids of games it changed last, without their contents.
     *
     * @return array{games: list<array>, more: bool, cursor: array{ms: int, id: int}}
     */
    public function changes(User $user, int $sinceMs, int $afterId, ?string $device): array
    {
        $rows = $user->games()
            ->where(fn ($q) => $q->where('updated_ms', '>', $sinceMs)->orWhere(fn ($q) => $q->where('updated_ms', $sinceMs)->where('id', '>', $afterId)))
            ->orderBy('updated_ms')
            ->orderBy('id')
            ->limit(self::PAGE + 1)
            ->get();
        $more = $rows->count() > self::PAGE;
        $rows = $rows->take(self::PAGE);
        $last = $rows->last();

        return [
            'games' => $rows->map(fn (Game $g) => $g->toSync(! $device || $g->origin !== $device))->values()->all(),
            'more' => $more,
            'cursor' => $last ? ['ms' => $last->updated_ms, 'id' => $last->id] : ['ms' => $sinceMs, 'id' => $afterId],
        ];
    }

    /**
     * Lets one browser at a time give a game a Deep review in the background. A claim lasts
     * CLAIM_MS unless renewed, so a laptop closed halfway frees the game for the others. Claims
     * never change `updated_ms`, so renewing one does not send the game to every device again.
     *
     * `claim` and `renew` take the game when it is free, expired or already this browser's;
     * otherwise they report how far the browser holding it has got. `release` gives it up.
     * Null when the person has no such game.
     *
     * @return array{granted: bool, progress: ?int}|null
     */
    public function claim(User $user, string $gameId, string $device, string $action, int $progress): ?array
    {
        return DB::transaction(function () use ($user, $gameId, $device, $action, $progress) {
            /** @var Game|null $game */
            $game = $user->games()->where('game_id', $gameId)->where('deleted', false)->lockForUpdate()->first();
            if ($game === null) {
                return null;
            }
            $now = self::nowMs();
            $mine = $game->claim_device === $device;
            if ($action === 'release') {
                if ($mine) {
                    $game->update(['claim_device' => null, 'claim_until_ms' => null, 'claim_progress' => null]);
                }

                return ['granted' => true, 'progress' => null];
            }
            $free = $game->claim_device === null || ($game->claim_until_ms ?? 0) <= $now;
            if (! $mine && ! $free) {
                return ['granted' => false, 'progress' => $game->claim_progress];
            }
            $game->update(['claim_device' => $device, 'claim_until_ms' => $now + self::CLAIM_MS, 'claim_progress' => $progress]);

            return ['granted' => true, 'progress' => $progress];
        });
    }

    /**
     * Named games in full, for a browser that was told a game was unchanged but no longer has it.
     *
     * @param  list<string>  $ids
     * @return list<array>
     */
    public function find(User $user, array $ids): array
    {
        return $user->games()->whereIn('game_id', $ids)->get()->map(fn (Game $g) => $g->toSync())->values()->all();
    }
}
