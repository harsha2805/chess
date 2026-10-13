<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /** @return HasMany<Game, $this> */
    public function games(): HasMany
    {
        return $this->hasMany(Game::class);
    }

    /** @return HasMany<ChessAccount, $this> */
    public function chessAccounts(): HasMany
    {
        return $this->hasMany(ChessAccount::class);
    }

    /** Notes that the person is using the site, at most once an hour. */
    public function markSeen(): void
    {
        if (! $this->last_seen_at || $this->last_seen_at->lt(now()->subHour())) {
            $this->forceFill(['last_seen_at' => now()])->saveQuietly();
        }
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            // A person who signs in only with Google has no password to confirm things with.
            'hasPassword' => $this->password !== null,
            'google' => $this->google_id !== null,
        ];
    }
}
