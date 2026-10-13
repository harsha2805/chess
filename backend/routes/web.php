<?php

use App\Http\Controllers\Auth\GoogleController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// The app itself is the static build copied into public/ (see scripts/copy-to-backend.mjs);
// public/.htaccess serves index.html for "/". This covers servers that send "/" to Laravel instead.
// It is only a file, so it skips the session (whose table may not exist before the first migration).
Route::get('/', function () {
    $app = public_path('index.html');
    abort_unless(is_file($app), 404, 'The app has not been built into public/ yet.');

    return response()->file($app, ['Cache-Control' => 'no-cache']);
})->withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, EncryptCookies::class, AddQueuedCookiesToResponse::class]);

// Sign-in with Google (off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set).
Route::get('/auth/google/redirect', [GoogleController::class, 'redirect'])->middleware('throttle:auth');
Route::get('/auth/google/callback', [GoogleController::class, 'callback'])->middleware('throttle:auth');
