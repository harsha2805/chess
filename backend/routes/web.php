<?php

use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\CronController;
use App\Http\Controllers\SetupController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// Routes that need no session: they work before the first migration (whose sessions table the
// session needs), and set no cookies.
$stateless = [StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, EncryptCookies::class, AddQueuedCookiesToResponse::class];

// The app itself is the static build copied into public/ (see scripts/copy-to-backend.mjs);
// public/.htaccess serves index.html for "/". This covers servers that send "/" to Laravel instead.
Route::get('/', function () {
    $app = public_path('index.html');
    abort_unless(is_file($app), 404, 'The app has not been built into public/ yet.');

    return response()->file($app, ['Cache-Control' => 'no-cache']);
})->withoutMiddleware($stateless);

// Sign-in with Google (off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set).
Route::get('/auth/google/redirect', [GoogleController::class, 'redirect'])->middleware('throttle:auth');
Route::get('/auth/google/callback', [GoogleController::class, 'callback'])->middleware('throttle:auth');

// Web cron for hosts whose cron jobs cannot run PHP: /cron?token=<token> every 15 minutes.
Route::get('/cron', CronController::class)->withoutMiddleware($stateless)->middleware('throttle:cron');

// First migrations on a brand-new server; answers only until the tables exist.
Route::get('/setup', [SetupController::class, 'show'])->withoutMiddleware($stateless);
Route::post('/setup', [SetupController::class, 'run'])->withoutMiddleware($stateless);
