<?php

namespace App\Http\Controllers;

use App\Support\AdminSecrets;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;

/**
 * Web cron, for hosts whose cron jobs cannot run PHP: /cron?token=<token>, every 15 minutes.
 * Does what the scheduler would: checks the chess accounts that are due, and once a day
 * clears old password reset links.
 */
class CronController extends Controller
{
    public function __invoke(Request $request): Response
    {
        if (! AdminSecrets::checkCronToken((string) $request->query('token'))) {
            return $this->text("Not allowed.\n", 403);
        }
        $lock = Cache::lock('web-cron', 900);
        if (! $lock->get()) {
            return $this->text("Already running.\n");
        }

        try {
            ignore_user_abort(true);
            set_time_limit(600);
            Artisan::call('games:fetch');
            $output = Artisan::output();
            $cleared = AdminSecrets::get('resets_cleared_at');
            if (! $cleared || strtotime($cleared) < time() - 86400) {
                Artisan::call('auth:clear-resets');
                $output .= Artisan::output();
                AdminSecrets::put('resets_cleared_at', now()->toDateTimeString());
            }
            AdminSecrets::put('cron_last_run', now()->toDateTimeString());
        } finally {
            $lock->release();
        }

        return $this->text($output);
    }

    private function text(string $body, int $status = 200): Response
    {
        return response($body, $status, ['Content-Type' => 'text/plain; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex']);
    }
}
