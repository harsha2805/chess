<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\Controller;
use App\Models\ChessAccount;
use App\Models\Game;
use App\Models\User;
use App\Support\AdminSecrets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * The admin page (#/admin in the app), for hosts without a command line: status, a fixed set
 * of artisan commands, a test email, the error log and the web cron token. Only for admins
 * (see User::isAdmin); there is no free-form command, so a stolen session cannot run anything.
 */
class AdminController extends Controller
{
    /** The commands the page can run, by name. */
    private const COMMANDS = [
        'migrate' => ['migrate', ['--force' => true]],
        'migrate_status' => ['migrate:status', []],
        'optimize' => ['optimize', []],
        'clear' => ['optimize:clear', []],
        'fetch' => ['games:fetch', []],
        'fetch_all' => ['games:fetch', ['--all' => true]],
    ];

    public function status(): JsonResponse
    {
        return response()->json(['checks' => $this->checks(), 'stats' => $this->stats()]);
    }

    public function run(Request $request): JsonResponse
    {
        $action = $request->validate([
            'action' => ['required', Rule::in([...array_keys(self::COMMANDS), 'mail', 'log'])],
        ])['action'];
        set_time_limit(600);

        $output = match ($action) {
            'mail' => $this->testMail(),
            'log' => $this->logTail(),
            default => $this->artisan(...self::COMMANDS[$action]),
        };

        return response()->json(['output' => $output]);
    }

    /** A new web cron token, shown once. The previous one stops working. */
    public function cronToken(): JsonResponse
    {
        $token = AdminSecrets::newCronToken();

        return response()->json(['token' => $token, 'url' => url('/cron').'?token='.$token]);
    }

    private function artisan(string $command, array $params): string
    {
        $shown = trim('php artisan '.$command.' '.implode(' ', array_map(fn ($k, $v) => $v === true ? $k : "{$k}={$v}", array_keys($params), $params)));
        try {
            $code = Artisan::call($command, $params);

            return "$ {$shown}\n".trim(Artisan::output())."\n".($code === 0 ? '' : "(exit code {$code})\n");
        } catch (Throwable $e) {
            return "$ {$shown}\nFailed: {$e->getMessage()}\n";
        }
    }

    private function testMail(): string
    {
        $to = (string) config('chessdebrief.report.to');
        if (! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return "Set CHESSDEBRIEF_REPORT_TO in .env first, then press \"Clear caches\".\n";
        }
        try {
            Mail::raw("This is a test from the ChessDebrief admin page.\nIf it arrived, password reset emails and bug reports will too.", function (Message $mail) use ($to) {
                if ($from = config('chessdebrief.report.from')) {
                    $mail->from($from, config('app.name'));
                }
                $mail->to($to)->subject('['.config('app.name').'] Test email');
            });

            return "Sent to {$to} through ".config('mail.default').' ('.config('mail.mailers.smtp.host').':'.config('mail.mailers.smtp.port').").\nCheck the inbox, and the spam folder.\n";
        } catch (Throwable $e) {
            return "The email could not be sent: {$e->getMessage()}\n";
        }
    }

    private function logTail(): string
    {
        $file = storage_path('logs/laravel.log');
        if (! is_file($file)) {
            return "No errors logged yet.\n";
        }
        $size = filesize($file);
        $handle = fopen($file, 'r');
        fseek($handle, max(0, $size - 20000));
        $tail = (string) stream_get_contents($handle);
        fclose($handle);

        return ($size > 20000 ? '(last 20 KB of '.number_format($size)." bytes)\n" : '').$tail;
    }

    /** @return list<array{label: string, ok: bool, detail: string}> */
    private function checks(): array
    {
        $check = fn (string $label, bool $ok, string $detail = '') => compact('label', 'ok', 'detail');
        $list = [];
        $list[] = $check('PHP 8.3 or newer', PHP_VERSION_ID >= 80300, PHP_VERSION);
        $missing = array_values(array_filter(['ctype', 'curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_mysql', 'tokenizer', 'xml'], fn ($ext) => ! extension_loaded($ext)));
        $list[] = $check('PHP extensions', ! $missing, $missing ? 'Missing: '.implode(', ', $missing) : 'All present');
        $list[] = $check('storage/ writable', is_writable(storage_path()) && is_writable(storage_path('framework')));
        $list[] = $check('bootstrap/cache/ writable', is_writable(base_path('bootstrap/cache')));
        $list[] = $check('Production mode', config('app.env') === 'production' && ! config('app.debug'), 'APP_ENV='.config('app.env').', APP_DEBUG='.(config('app.debug') ? 'true' : 'false'));
        $list[] = $check('APP_URL', (bool) config('app.url'), (string) config('app.url'));
        try {
            $migrator = app('migrator');
            $files = array_keys($migrator->getMigrationFiles([database_path('migrations')]));
            $pending = array_values(array_diff($files, $migrator->getRepository()->getRan()));
            $list[] = $check('Migrations', ! $pending, $pending ? count($pending).' waiting: press "Run migrations"' : 'All run');
        } catch (Throwable $e) {
            $list[] = $check('Migrations', false, $e->getMessage());
        }
        $list[] = $check('Config cached', true, is_file(base_path('bootstrap/cache/config.php')) ? 'Yes: after editing .env, press "Clear caches"' : 'No');
        $list[] = $check('Mail', (bool) config('chessdebrief.report.to'), config('mail.default').' via '.config('mail.mailers.smtp.host').':'.config('mail.mailers.smtp.port').', reports to '.(config('chessdebrief.report.to') ?: '(not set)'));
        $list[] = $check('Google sign-in', GoogleController::enabled(), GoogleController::enabled() ? 'On' : 'Off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
        $cron = AdminSecrets::cronSource();
        $lastCron = AdminSecrets::get('cron_last_run');
        $list[] = $check('Web cron', $cron !== 'none', match ($cron) {
            'database' => 'Token stored hashed',
            'env' => 'Token from .env (make a new one to store it hashed)',
            default => 'No token (fine if a cron job runs artisan schedule:run)',
        }.($lastCron ? '; last run '.$lastCron.' UTC' : '; no run seen yet'));

        return $list;
    }

    private function stats(): array
    {
        return [
            'people' => User::count(),
            'google' => User::whereNotNull('google_id')->count(),
            'admins' => User::whereIn(DB::raw('LOWER(email)'), config('chessdebrief.admin_emails', []))->whereNotNull('email_verified_at')->count(),
            'chessAccounts' => ChessAccount::count(),
            'games' => Game::where('deleted', false)->count(),
            'reviewed' => Game::where('deleted', false)->whereNotNull('review')->count(),
            'lastFetch' => ChessAccount::max('last_fetched_at'),
        ];
    }
}
