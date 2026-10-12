<?php

/**
 * ChessDebrief maintenance page, for hosts without a command line.
 *
 * - In the browser: sign in with CHESSDEBRIEF_ADMIN_PASSWORD and run a fixed set of artisan
 *   commands (migrations, caches, the game fetch, a test email). There is no free-form
 *   command box on purpose: a stolen password should not mean running anything at all.
 * - As a web cron: maintenance.php?cron=<CHESSDEBRIEF_CRON_TOKEN> checks the chess accounts
 *   that are due, like the scheduler does. Call it every 15 minutes.
 *
 * Both are off until their secret is set in .env (16 characters or more). The page keeps its
 * own PHP session rather than Laravel's, so it works before the database tables exist.
 */

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");

const MIN_SECRET = 16;
const IDLE_SECONDS = 1800;
const MAX_FAILURES = 5;
const FAILURE_WINDOW = 900;

// The app one level up (the usual layout), or in "chessdebrief" beside public_html.
$base = is_file(__DIR__.'/../artisan') ? dirname(__DIR__) : dirname(__DIR__).'/chessdebrief';

// ---- Start Laravel (console kernel: commands run in this request) ----

$bootError = null;
$kernel = null;
try {
    if (! is_file($base.'/vendor/autoload.php')) {
        throw new RuntimeException("The app was not found at {$base}. Extract the zip so that the chessdebrief folder sits beside public_html.");
    }
    define('LARAVEL_START', microtime(true));
    require $base.'/vendor/autoload.php';
    $app = require $base.'/bootstrap/app.php';
    $app->usePublicPath(__DIR__);
    $kernel = $app->make(Kernel::class);
    $kernel->bootstrap();
} catch (Throwable $e) {
    $bootError = $e->getMessage();
}

$adminPassword = $kernel ? (string) config('chessdebrief.admin_password') : '';
$cronToken = $kernel ? (string) config('chessdebrief.cron_token') : '';

// ---- Web cron ----

if (isset($_GET['cron'])) {
    header('Content-Type: text/plain; charset=utf-8');
    if (! $kernel || strlen($cronToken) < MIN_SECRET || ! hash_equals($cronToken, (string) $_GET['cron'])) {
        http_response_code(403);
        exit("Not allowed.\n");
    }
    $lock = fopen($base.'/storage/framework/web-cron.lock', 'c');
    if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
        exit("Already running.\n");
    }
    ignore_user_abort(true);
    set_time_limit(600);
    $kernel->call('games:fetch');
    echo $kernel->output();
    // Once a day: password reset links past their date.
    $daily = $base.'/storage/framework/web-cron-daily';
    if (! is_file($daily) || filemtime($daily) < time() - 86400) {
        $kernel->call('auth:clear-resets');
        echo $kernel->output();
        touch($daily);
    }
    flock($lock, LOCK_UN);
    exit;
}

// ---- Admin session ----

function is_https(): bool
{
    return (! empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

session_name('cd_maintenance');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => strtok((string) ($_SERVER['REQUEST_URI'] ?? '/'), '?') ?: '/',
    'secure' => is_https(),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));

$signedIn = isset($_SESSION['admin_at']) && $_SESSION['admin_at'] > time() - IDLE_SECONDS;
if ($signedIn) {
    $_SESSION['admin_at'] = time();
} else {
    unset($_SESSION['admin_at']);
}

/** Failed sign-ins per visitor, kept in a file so they count before the database exists. */
function failures(string $base, ?bool $failed = null): int
{
    $file = $base.'/storage/framework/maintenance-guard.json';
    $key = hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    $handle = @fopen($file, 'c+');
    if (! $handle) {
        return 0;
    }
    flock($handle, LOCK_EX);
    $all = json_decode((string) stream_get_contents($handle), true) ?: [];
    $now = time();
    foreach ($all as $k => $times) {
        $all[$k] = array_values(array_filter($times, fn ($t) => $t > $now - FAILURE_WINDOW));
        if (! $all[$k]) {
            unset($all[$k]);
        }
    }
    if ($failed === true) {
        $all[$key][] = $now;
    } elseif ($failed === false) {
        unset($all[$key]);
    }
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($all));
    flock($handle, LOCK_UN);
    fclose($handle);

    return count($all[$key] ?? []);
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$enabled = strlen($adminPassword) >= MIN_SECRET;
$message = null;
$output = null;
$ran = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (! hash_equals($_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        $message = ['error', 'The form had expired. Try again.'];
    } elseif (isset($_POST['password'])) {
        if (! $enabled) {
            $message = ['error', 'The maintenance page is switched off.'];
        } elseif (failures($base) >= MAX_FAILURES) {
            $message = ['error', 'Too many wrong passwords. Wait 15 minutes.'];
        } elseif (hash_equals($adminPassword, (string) $_POST['password'])) {
            failures($base, false);
            session_regenerate_id(true);
            $_SESSION['admin_at'] = time();
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            $signedIn = true;
        } else {
            failures($base, true);
            usleep(500_000);
            $message = ['error', 'That is not the password.'];
        }
    } elseif (isset($_POST['logout'])) {
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        $signedIn = false;
    } elseif ($signedIn && $kernel && isset($_POST['action'])) {
        set_time_limit(600);
        $ran = (string) $_POST['action'];
        $output = run_action($ran, $kernel, $base);
    }
}

// ---- The commands this page can run ----

/** @return array<string, array{label: string, hint: string, group: string}> */
function actions(): array
{
    return [
        'migrate' => ['label' => 'Run migrations', 'hint' => 'Creates or updates the database tables. Run after every upload.', 'group' => 'Set up and update'],
        'key' => ['label' => 'Generate the app key', 'hint' => 'Only when APP_KEY in .env is empty. A new key signs everyone out.', 'group' => 'Set up and update'],
        'optimize' => ['label' => 'Cache config and routes', 'hint' => 'Faster pages. After this, edits to .env need "Clear caches" to take effect.', 'group' => 'Set up and update'],
        'clear' => ['label' => 'Clear caches', 'hint' => 'Run after editing .env, or when something looks stale.', 'group' => 'Set up and update'],
        'status' => ['label' => 'Migration status', 'hint' => 'Which migrations have run.', 'group' => 'Check'],
        'mail' => ['label' => 'Send a test email', 'hint' => 'To CHESSDEBRIEF_REPORT_TO, with the MAIL_* settings.', 'group' => 'Check'],
        'log' => ['label' => 'Show recent errors', 'hint' => 'The end of storage/logs/laravel.log.', 'group' => 'Check'],
        'fetch' => ['label' => 'Fetch due games now', 'hint' => 'What the scheduler does every 15 minutes.', 'group' => 'Games'],
        'fetch_all' => ['label' => 'Fetch all accounts now', 'hint' => 'Every linked account of an active person, due or not.', 'group' => 'Games'],
    ];
}

function run_action(string $action, Kernel $kernel, string $base): string
{
    $call = function (string $command, array $params = []) use ($kernel): string {
        try {
            $code = $kernel->call($command, $params);

            return "$ php artisan {$command}".($params ? ' '.implode(' ', array_map(fn ($k, $v) => $v === true ? $k : "{$k}={$v}", array_keys($params), $params)) : '')."\n"
                .trim($kernel->output())."\n".($code === 0 ? '' : "(exit code {$code})\n");
        } catch (Throwable $e) {
            return "$ php artisan {$command}\nFailed: ".$e->getMessage()."\n";
        }
    };

    switch ($action) {
        case 'migrate':
            return $call('migrate', ['--force' => true]);
        case 'key':
            if (config('app.key')) {
                return "APP_KEY is already set. Generating a new one would sign everyone out, so it was left alone.\n"
                    ."To replace it on purpose, empty APP_KEY in .env, press \"Clear caches\", then try again.\n";
            }

            return $call('key:generate', ['--force' => true]);
        case 'optimize':
            return $call('optimize');
        case 'clear':
            return $call('optimize:clear');
        case 'status':
            return $call('migrate:status');
        case 'fetch':
            return $call('games:fetch');
        case 'fetch_all':
            return $call('games:fetch', ['--all' => true]);
        case 'mail':
            $to = (string) config('chessdebrief.report.to');
            if (! filter_var($to, FILTER_VALIDATE_EMAIL)) {
                return "Set CHESSDEBRIEF_REPORT_TO in .env first (then Clear caches if config is cached).\n";
            }
            try {
                Mail::raw("This is a test from the ChessDebrief maintenance page.\nIf it arrived, password reset emails and bug reports will too.", function ($mail) use ($to) {
                    $from = config('chessdebrief.report.from');
                    if ($from) {
                        $mail->from($from, config('app.name'));
                    }
                    $mail->to($to)->subject('['.config('app.name').'] Test email');
                });

                return "Sent to {$to} through ".config('mail.default').' ('.config('mail.mailers.smtp.host').':'.config('mail.mailers.smtp.port').").\nCheck the inbox, and the spam folder.\n";
            } catch (Throwable $e) {
                return 'The email could not be sent: '.$e->getMessage()."\n";
            }
        case 'log':
            $file = $base.'/storage/logs/laravel.log';
            if (! is_file($file)) {
                return "No errors logged yet.\n";
            }
            $size = filesize($file);
            $handle = fopen($file, 'r');
            fseek($handle, max(0, $size - 20000));
            $tail = (string) stream_get_contents($handle);
            fclose($handle);

            return ($size > 20000 ? "(last 20 KB of ".number_format($size)." bytes)\n" : '').$tail;
        default:
            return "Unknown action.\n";
    }
}

/** @return list<array{string, bool, string}> label, ok, detail */
function checks(?Kernel $kernel, string $base, ?string $bootError): array
{
    $list = [];
    $list[] = ['PHP 8.3 or newer', PHP_VERSION_ID >= 80300, PHP_VERSION];
    $missing = array_values(array_filter(['ctype', 'curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_mysql', 'tokenizer', 'xml'], fn ($ext) => ! extension_loaded($ext)));
    $list[] = ['PHP extensions', ! $missing, $missing ? 'Missing: '.implode(', ', $missing) : 'All present'];
    $list[] = ['.env file', is_file($base.'/.env'), is_file($base.'/.env') ? 'Found' : 'Create it from .env.example'];
    $list[] = ['storage/ writable', is_writable($base.'/storage') && is_writable($base.'/storage/framework'), ''];
    $list[] = ['bootstrap/cache/ writable', is_writable($base.'/bootstrap/cache'), ''];
    $list[] = ['Laravel starts', $kernel !== null, $bootError ?? ''];
    if (! $kernel) {
        return $list;
    }
    $list[] = ['APP_KEY set', (bool) config('app.key'), config('app.key') ? '' : 'Press "Generate the app key"'];
    $list[] = ['Production mode', config('app.env') === 'production' && ! config('app.debug'), 'APP_ENV='.config('app.env').', APP_DEBUG='.(config('app.debug') ? 'true' : 'false')];
    $list[] = ['APP_URL', (bool) config('app.url'), (string) config('app.url')];
    try {
        DB::connection()->getPdo();
        $list[] = ['Database connection', true, config('database.connections.mysql.database')];
        $migrated = DB::getSchemaBuilder()->hasTable('migrations') && DB::getSchemaBuilder()->hasTable('games');
        $list[] = ['Tables created', $migrated, $migrated ? '' : 'Press "Run migrations"'];
        if ($migrated) {
            $users = DB::table('users')->count();
            $accounts = DB::table('chess_accounts')->count();
            $last = DB::table('chess_accounts')->max('last_fetched_at');
            $list[] = ['Accounts', true, "{$users} people, {$accounts} chess accounts, last check: ".($last ? $last.' UTC' : 'never')];
        }
    } catch (Throwable $e) {
        $list[] = ['Database connection', false, $e->getMessage()];
    }
    $list[] = ['Config cached', true, is_file($base.'/bootstrap/cache/config.php') ? 'Yes: edits to .env need "Clear caches"' : 'No'];
    $list[] = ['Mail', (bool) config('chessdebrief.report.to'), config('mail.default').' via '.config('mail.mailers.smtp.host').':'.config('mail.mailers.smtp.port').', reports to '.(config('chessdebrief.report.to') ?: '(not set)')];
    $list[] = ['Web cron token', strlen((string) config('chessdebrief.cron_token')) >= MIN_SECRET, strlen((string) config('chessdebrief.cron_token')) >= MIN_SECRET ? 'Set' : 'Not set (fine if a cron job runs artisan schedule:run)'];

    return $list;
}

$self = h(strtok((string) ($_SERVER['REQUEST_URI'] ?? ''), '?') ?: 'maintenance.php');
$csrf = h($_SESSION['csrf']);
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Maintenance | ChessDebrief</title>
<style>
  :root { color-scheme: dark; --ground: #0d1830; --ground-2: #13224a; --seam: #2a3f73; --ink: #f3efe6; --ink-2: #ccd2e2; --ink-3: #a3aecb; --ok: #2fae62; --bad: #ff7a66; --warn: #f4ad1f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.9rem; margin: 0 0 6px; }
  h2 { font-size: 1.15rem; margin: 32px 0 10px; }
  p { color: var(--ink-2); margin: 0 0 12px; }
  .notice { padding: 10px 14px; border-radius: 10px; background: var(--ground-2); border: 1px solid var(--seam); margin: 14px 0; }
  .notice.error { border-color: var(--bad); }
  .notice.warn { border-color: var(--warn); }
  table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--seam); vertical-align: top; }
  td:first-child { width: 34%; font-weight: 700; }
  td.detail { color: var(--ink-3); overflow-wrap: anywhere; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .action { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--seam); border-radius: 12px; background: var(--ground-2); }
  .action small { color: var(--ink-3); }
  button { font: inherit; font-weight: 800; padding: 9px 16px 8px; border-radius: 999px; border: 0; background: var(--ink); color: var(--ground); cursor: pointer; }
  button.quiet { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 2px var(--seam); }
  input { font: inherit; width: 100%; max-width: 360px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--seam); background: var(--ground-2); color: var(--ink); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #070e1f; border: 1px solid var(--seam); border-radius: 10px; padding: 12px 14px; font-size: 0.85rem; max-height: 480px; overflow: auto; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
  code { background: var(--ground-2); padding: 1px 6px; border-radius: 6px; }
</style>
</head>
<body>
<main>
<?php if (! $enabled): ?>
  <h1>Maintenance is switched off</h1>
  <p>To use this page, set <code>CHESSDEBRIEF_ADMIN_PASSWORD</code> in <code>.env</code> to a password of at least <?= MIN_SECRET ?> characters.
     If the config is cached, also delete <code>bootstrap/cache/config.php</code> with your host's file manager.</p>
  <?php if ($bootError): ?><div class="notice error">Laravel could not start: <?= h($bootError) ?></div><?php endif; ?>
<?php elseif (! $signedIn): ?>
  <h1>Maintenance</h1>
  <p>Sign in with the admin password from <code>.env</code>.</p>
  <?php if (! is_https()): ?><div class="notice warn">This page is not on HTTPS, so the password travels unencrypted. Turn on HTTPS for the site before using it on the live server.</div><?php endif; ?>
  <?php if ($message): ?><div class="notice <?= h($message[0]) ?>" role="alert"><?= h($message[1]) ?></div><?php endif; ?>
  <form method="post" action="<?= $self ?>">
    <input type="hidden" name="csrf" value="<?= $csrf ?>">
    <p><input type="password" name="password" autocomplete="current-password" aria-label="Admin password" required autofocus></p>
    <button type="submit">Sign in</button>
  </form>
<?php else: ?>
  <div class="row">
    <h1>Maintenance</h1>
    <form method="post" action="<?= $self ?>"><input type="hidden" name="csrf" value="<?= $csrf ?>"><button class="quiet" name="logout" value="1">Sign out</button></form>
  </div>
  <p>Signs out by itself after 30 minutes without use.</p>
  <?php if ($message): ?><div class="notice <?= h($message[0]) ?>" role="alert"><?= h($message[1]) ?></div><?php endif; ?>

  <?php if ($output !== null): ?>
    <h2><?= h(actions()[$ran]['label'] ?? $ran) ?></h2>
    <pre><?= h($output) ?></pre>
  <?php endif; ?>

  <h2>Status</h2>
  <table>
    <?php foreach (checks($kernel, $base, $bootError) as [$label, $ok, $detail]): ?>
      <tr><td><span class="<?= $ok ? 'ok' : 'bad' ?>" aria-hidden="true"><?= $ok ? '✓' : '✗' ?></span> <?= h($label) ?><span style="position:absolute;left:-9999px"><?= $ok ? ' (fine)' : ' (needs attention)' ?></span></td><td class="detail"><?= h($detail) ?></td></tr>
    <?php endforeach; ?>
  </table>

  <?php if ($kernel): ?>
    <?php $groups = []; foreach (actions() as $key => $a) { $groups[$a['group']][$key] = $a; } ?>
    <?php foreach ($groups as $group => $items): ?>
      <h2><?= h($group) ?></h2>
      <div class="grid">
        <?php foreach ($items as $key => $a): ?>
          <form class="action" method="post" action="<?= $self ?>">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <button name="action" value="<?= h($key) ?>"><?= h($a['label']) ?></button>
            <small><?= h($a['hint']) ?></small>
          </form>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>

    <h2>Scheduled fetch</h2>
    <p>New games are fetched by calling, every 15 minutes, either the command <code>php <?= h($base) ?>/artisan schedule:run</code>
       (if your host's cron jobs can run PHP), or this address:</p>
    <?php if (strlen($cronToken) >= MIN_SECRET): ?>
      <pre><?= h((is_https() ? 'https' : 'http').'://'.($_SERVER['HTTP_HOST'] ?? 'your.domain').$self.'?cron='.$cronToken) ?></pre>
      <p>For a cron job: <code>wget -q -O /dev/null "&lt;that address&gt;"</code>, or add it at a free service such as cron-job.org. Keep the address private.</p>
    <?php else: ?>
      <p>Set <code>CHESSDEBRIEF_CRON_TOKEN</code> in <code>.env</code> (<?= MIN_SECRET ?>+ characters) to get the address.</p>
    <?php endif; ?>
  <?php endif; ?>
<?php endif; ?>
</main>
</body>
</html>
