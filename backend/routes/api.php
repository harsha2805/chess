<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChessAccountController;
use App\Http\Controllers\Api\GameController;
use App\Http\Controllers\Api\ReportController;
use Illuminate\Support\Facades\Route;

// Every route here is under /api. The app sends the XSRF token Laravel sets (see /sanctum/csrf-cookie).

Route::get('/session', [AuthController::class, 'session']);

Route::middleware('throttle:auth')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/forgot-password', [AuthController::class, 'forgot']);
    Route::post('/reset-password', [AuthController::class, 'reset']);
});

Route::post('/report', [ReportController::class, 'store'])->middleware('throttle:report');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::delete('/user', [AuthController::class, 'destroy'])->middleware('throttle:auth');
    Route::delete('/user/google', [AuthController::class, 'disconnectGoogle']);

    Route::get('/games', [GameController::class, 'index']);
    Route::post('/games/sync', [GameController::class, 'sync']);

    Route::get('/accounts', [ChessAccountController::class, 'index']);
    Route::post('/accounts', [ChessAccountController::class, 'store']);
    Route::delete('/accounts/{id}', [ChessAccountController::class, 'destroy'])->whereNumber('id');
    Route::post('/refresh', [ChessAccountController::class, 'refresh'])->middleware('throttle:refresh');

    // The admin page: only for admins (User::isAdmin).
    Route::middleware('can:admin')->prefix('admin')->group(function () {
        Route::get('/status', [AdminController::class, 'status']);
        Route::post('/run', [AdminController::class, 'run'])->middleware('throttle:admin');
        Route::post('/cron-token', [AdminController::class, 'cronToken'])->middleware('throttle:admin');
    });
});
