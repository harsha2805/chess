<?php
/**
 * Bug report endpoint: receives a report as JSON and emails it.
 *
 * Setup: copy report-config.example.php to report-config.php in this folder and
 * put your address in it. The address stays on the server; the site never sees it.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

/** Removes anything that could break out of a mail header. */
function header_safe(string $value): string
{
    return trim(preg_replace('/[\r\n\t\0]+/', ' ', $value) ?? '');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Reports are sent with POST.']);
}

$config = is_file(__DIR__ . '/report-config.php') ? require __DIR__ . '/report-config.php' : null;
if (!is_array($config) || empty($config['to']) || !filter_var($config['to'], FILTER_VALIDATE_EMAIL)) {
    respond(503, ['ok' => false, 'error' => 'Bug reports are not set up on this server yet.']);
}

// Only accept reports from pages on this same site.
$host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && strtolower((string) parse_url($origin, PHP_URL_HOST)) !== preg_replace('/:\d+$/', '', $host)) {
    respond(403, ['ok' => false, 'error' => 'Reports must be sent from the site itself.']);
}

$raw = file_get_contents('php://input', false, null, 0, 300000);
$data = json_decode((string) $raw, true);
if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'The report could not be read.']);
}

// A hidden field people never see. Bots fill it in; they get a polite success and nothing is sent.
if (!empty($data['website'])) {
    respond(200, ['ok' => true]);
}

$message = trim((string) ($data['message'] ?? ''));
$details = trim((string) ($data['details'] ?? ''));
$game = trim((string) ($data['game'] ?? ''));
$email = trim((string) ($data['email'] ?? ''));

$length = function_exists('mb_strlen') ? mb_strlen($message) : strlen($message);
if ($length < 10) {
    respond(422, ['ok' => false, 'error' => 'Describe what happened in a sentence or two.']);
}
if ($length > 5000 || strlen($details) > 6000 || strlen($game) > 200000) {
    respond(413, ['ok' => false, 'error' => 'The report is too long.']);
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, ['ok' => false, 'error' => 'That email address does not look right. Fix it or leave it empty.']);
}

// Rate limit: a few reports per address per hour, and a ceiling per day for everyone together.
$perHour = (int) ($config['per_hour'] ?? 5);
$perDay = (int) ($config['per_day'] ?? 200);
$dir = rtrim(sys_get_temp_dir(), '/\\') . '/postmortem-reports-' . substr(sha1(__DIR__), 0, 12);
if (!is_dir($dir)) {
    @mkdir($dir, 0700, true);
}
$now = time();
$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');

function allow(string $file, int $limit, int $window, int $now): bool
{
    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return true; // Cannot count here; do not block real reports because of it.
    }
    flock($handle, LOCK_EX);
    $times = array_filter(
        array_map('intval', explode("\n", (string) stream_get_contents($handle))),
        static fn (int $t): bool => $t > $now - $window
    );
    $ok = count($times) < $limit;
    if ($ok) {
        $times[] = $now;
    }
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, implode("\n", $times));
    flock($handle, LOCK_UN);
    fclose($handle);
    return $ok;
}

if (!allow($dir . '/ip-' . sha1($ip), $perHour, 3600, $now)) {
    respond(429, ['ok' => false, 'error' => 'That is a lot of reports in a short time. Try again in an hour.']);
}
if (!allow($dir . '/all', $perDay, 86400, $now)) {
    respond(429, ['ok' => false, 'error' => 'The report inbox is full for today. Try again tomorrow.']);
}

$siteHost = preg_replace('/[^a-z0-9.\-]/', '', preg_replace('/:\d+$/', '', $host) ?? '') ?: 'localhost';
$from = !empty($config['from']) && filter_var($config['from'], FILTER_VALIDATE_EMAIL) ? $config['from'] : 'no-reply@' . $siteHost;
$firstLine = function_exists('mb_substr') ? mb_substr($message, 0, 70) : substr($message, 0, 70);
$subject = header_safe('[Postmortem] ' . $firstLine);

$body = $message . "\n\n"
    . "----------------------------------------\n"
    . ($email !== '' ? "Reply to: {$email}\n" : "No reply address given.\n")
    . 'Sent: ' . gmdate('Y-m-d H:i') . " UTC from {$siteHost}\n\n"
    . $details . "\n"
    . ($game !== '' ? "\n----------------------------------------\n" . $game . "\n" : '');

$headers = [
    'From: Postmortem <' . header_safe($from) . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: Postmortem bug report',
];
if ($email !== '') {
    $headers[] = 'Reply-To: ' . header_safe($email);
}

$encodedSubject = function_exists('mb_encode_mimeheader') ? mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n") : $subject;
$sent = function_exists('mail') && @mail($config['to'], $encodedSubject, str_replace("\r\n", "\n", $body), implode("\r\n", $headers));

if (!$sent) {
    respond(502, ['ok' => false, 'error' => 'The server could not send the email.']);
}
respond(200, ['ok' => true]);
