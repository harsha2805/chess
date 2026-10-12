<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A chess.com or Lichess account whose new games are fetched for a person. */
#[Fillable(['platform', 'username', 'watermark_ms', 'last_fetched_at', 'last_error'])]
class ChessAccount extends Model
{
    public const PLATFORMS = ['chesscom', 'lichess'];

    protected function casts(): array
    {
        return [
            'watermark_ms' => 'integer',
            'last_fetched_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Accounts not checked in the last `$seconds`. */
    public function scopeStale(Builder $query, int $seconds): void
    {
        $query->where(fn (Builder $q) => $q->whereNull('last_fetched_at')->orWhere('last_fetched_at', '<=', now()->subSeconds($seconds)));
    }

    /** The id games from this account carry in the app, e.g. "lichess:name". */
    public function key(): string
    {
        return "{$this->platform}:{$this->username}";
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'platform' => $this->platform,
            'username' => $this->username,
            'lastFetchedAt' => $this->last_fetched_at?->getTimestampMs(),
            'lastError' => $this->last_error,
        ];
    }
}
