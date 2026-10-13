<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * First migrations on a brand-new server without a command line. Nobody can sign in before the
 * tables exist, so this page asks for CHESSDEBRIEF_SETUP_PASSWORD instead. It answers only while
 * the database has no migrations table; after the first run it is gone for good, and the admin
 * page in the app takes over.
 */
class SetupController extends Controller
{
    private const MIN_LENGTH = 16;

    public function show(): Response
    {
        abort_unless($this->open(), 404);

        return $this->page();
    }

    public function run(Request $request): Response
    {
        abort_unless($this->open(), 404);
        $password = (string) config('chessdebrief.setup_password');
        if (strlen($password) < self::MIN_LENGTH || ! hash_equals($password, (string) $request->input('password'))) {
            // Slows guessing; the page lives only until the first migration anyway.
            sleep(1);

            return $this->page('That is not the setup password.', null, 403);
        }
        set_time_limit(600);
        try {
            Artisan::call('migrate', ['--force' => true]);
            $output = Artisan::output();
        } catch (Throwable $e) {
            return $this->page('The migrations failed: '.$e->getMessage(), null, 500);
        }

        return $this->page(null, $output);
    }

    private function open(): bool
    {
        if (strlen((string) config('chessdebrief.setup_password')) < self::MIN_LENGTH) {
            return false;
        }
        try {
            return ! Schema::hasTable('migrations');
        } catch (Throwable) {
            return true; // No database connection yet: show the page, which says so when run.
        }
    }

    private function page(?string $error = null, ?string $output = null, int $status = 200): Response
    {
        $e = fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $body = $output !== null
            ? '<h1>Done</h1><pre>'.$e($output).'</pre><p>The tables are ready and this page has switched itself off. Next: list your address in CHESSDEBRIEF_ADMIN_EMAILS, sign in to the site with Google (or verify your address with a password reset), and open #/admin.</p><p><a href="'.$e(url('/')).'">Open the site</a></p>'
            : '<h1>Set up ChessDebrief</h1><p>The database has no tables yet. Enter CHESSDEBRIEF_SETUP_PASSWORD from .env to create them.</p>'
                .($error ? '<p class="error">'.$e($error).'</p>' : '')
                .'<form method="post"><input type="password" name="password" aria-label="Setup password" required autofocus><button>Create the tables</button></form>';

        return response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Setup | ChessDebrief</title>'
            .'<style>body{margin:0;background:#0d1830;color:#f3efe6;font:16px/1.5 system-ui,sans-serif}main{max-width:560px;margin:10vh auto;padding:0 16px}p{color:#ccd2e2}'
            .'input{font:inherit;width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a3f73;background:#13224a;color:inherit;margin:8px 0 12px}'
            .'button{font:inherit;font-weight:800;padding:9px 18px;border-radius:999px;border:0;background:#f3efe6;color:#0d1830;cursor:pointer}'
            .'pre{white-space:pre-wrap;background:#070e1f;border:1px solid #2a3f73;border-radius:10px;padding:12px}.error{color:#ff7a66;font-weight:700}a{color:inherit}</style></head>'
            .'<body><main>'.$body.'</main></body></html>', $status, ['Cache-Control' => 'no-store', 'X-Frame-Options' => 'DENY']);
    }
}
