<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A stored game. `record`, `raw` and `review` are JSON text, kept byte for byte as the app or the
 * chess site sent them: decoding and encoding again in PHP would turn empty objects into arrays.
 */
#[Fillable(['game_id', 'source', 'account', 'played_ms', 'added_ms', 'record', 'raw', 'review', 'review_ms', 'deleted', 'updated_ms', 'origin'])]
class Game extends Model
{
    public $timestamps = false;

    public const SOURCES = ['chesscom', 'lichess', 'pgn', 'sample'];

    protected function casts(): array
    {
        return [
            'played_ms' => 'integer',
            'added_ms' => 'integer',
            'review_ms' => 'integer',
            'updated_ms' => 'integer',
            'deleted' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** What the app receives when it pulls changes. With `bodies` false, only that the game changed. */
    public function toSync(bool $bodies = true): array
    {
        $row = [
            'id' => $this->game_id,
            'source' => $this->source,
            'account' => $this->account,
            'playedAt' => $this->played_ms,
            'addedAt' => $this->added_ms,
            'deleted' => $this->deleted,
            'updatedAt' => $this->updated_ms,
        ];
        if ($this->deleted) {
            return $row;
        }
        if (! $bodies) {
            return $row + ['same' => true];
        }

        return $row + ['record' => $this->record, 'raw' => $this->raw, 'review' => $this->review];
    }
}
