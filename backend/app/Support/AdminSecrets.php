<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * The web cron token, and other small values kept in the settings table.
 *
 * A token made on the admin page lives hashed in the settings table. Until one is made, the
 * plain CHESSDEBRIEF_CRON_TOKEN from .env is used instead.
 */
class AdminSecrets
{
    public const MIN_LENGTH = 16;

    private const CRON = 'cron_token_hash';

    /** Where the cron token comes from: "database", "env", or "none" (web cron off). */
    public static function cronSource(): string
    {
        if (self::get(self::CRON) !== null) {
            return 'database';
        }

        return strlen(self::envCronToken()) >= self::MIN_LENGTH ? 'env' : 'none';
    }

    public static function checkCronToken(string $input): bool
    {
        // The token is long and random, so a fast hash is enough; it is checked every 15 minutes.
        $hash = self::get(self::CRON);
        if ($hash !== null) {
            return hash_equals($hash, hash('sha256', $input));
        }
        $env = self::envCronToken();

        return strlen($env) >= self::MIN_LENGTH && hash_equals($env, $input);
    }

    /**
     * Makes a new cron token and stores only its hash, so it can be shown once and never again.
     * The previous token, and the one in .env, stop working.
     */
    public static function newCronToken(): string
    {
        $token = Str::random(40);
        self::put(self::CRON, hash('sha256', $token));

        return $token;
    }

    public static function envCronToken(): string
    {
        return (string) config('chessdebrief.cron_token');
    }

    /** A value from the settings table, or null when unset or the table is not there yet. */
    public static function get(string $key): ?string
    {
        try {
            $value = DB::table('settings')->where('key', $key)->value('value');
        } catch (Throwable) {
            return null;
        }

        return is_string($value) && $value !== '' ? $value : null;
    }

    public static function put(string $key, string $value): void
    {
        DB::table('settings')->updateOrInsert(['key' => $key], ['value' => $value, 'updated_at' => now(), 'created_at' => now()]);
    }
}
