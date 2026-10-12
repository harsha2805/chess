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

    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /**
     * Stores games sent by a browser. The record is replaced; the review is kept unless the
     * one sent is at least as new, so a slow browser cannot overwrite a newer review.
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
                if (! empty($item['review']) && $reviewAt !== null && ($game->review_ms === null || $reviewAt >= $game->review_ms)) {
                    $game->review = $item['review'];
                    $game->review_ms = $reviewAt;
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
            $empty = ['record' => null, 'raw' => null, 'review' => null, 'review_ms' => null, 'deleted' => true, 'updated_ms' => $now, 'origin' => $device];
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
