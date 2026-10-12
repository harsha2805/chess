<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// The app lives one level up (the usual Laravel layout), or, on hosts whose web root is
// public_html, in a "chessdebrief" folder beside it, out of reach of the web.
$base = is_file(__DIR__.'/../artisan') ? dirname(__DIR__) : dirname(__DIR__).'/chessdebrief';

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = $base.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require $base.'/vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once $base.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);

$app->handleRequest(Request::capture());
