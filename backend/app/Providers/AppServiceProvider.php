<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Sign-in attempts: per address and per visitor, so guessing passwords is slow.
        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(20)->by('ip|'.$request->ip()),
            Limit::perMinute(6)->by('email|'.Str::lower((string) $request->input('email')).'|'.$request->ip()),
        ]);
        // Checking chess sites on demand. The schedule covers the rest.
        RateLimiter::for('refresh', fn (Request $request) => Limit::perMinute(4)->by('refresh|'.($request->user()?->id ?? $request->ip())));
        // Bug reports: a few per visitor an hour, and a ceiling a day for everyone together.
        RateLimiter::for('report', fn (Request $request) => [
            Limit::perHour(config('chessdebrief.report.per_hour'))->by('report|'.$request->ip())
                ->response(fn () => response()->json(['ok' => false, 'error' => 'That is a lot of reports in a short time. Try again in an hour.'], 429)),
            Limit::perDay(config('chessdebrief.report.per_day'))->by('report')
                ->response(fn () => response()->json(['ok' => false, 'error' => 'The report inbox is full for today. Try again tomorrow.'], 429)),
        ]);

        // The app uses hash routes, so the reset link opens its own page with the token and address.
        ResetPassword::createUrlUsing(
            fn (User $user, string $token) => rtrim(config('app.url'), '/').'/#/reset/'.$token.'/'.rawurlencode($user->email),
        );
    }
}
