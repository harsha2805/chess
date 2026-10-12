<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

/** Bug reports from the site's form, emailed as set in config/chessdebrief.php ("report"). */
class ReportController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $to = config('chessdebrief.report.to');
        $from = config('chessdebrief.report.from');
        if (! $to || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['ok' => false, 'error' => 'Bug reports are not set up on this server yet.'], 503);
        }
        // A hidden field people never see. Bots fill it in; they get a polite success and nothing is sent.
        if ($request->filled('website')) {
            return response()->json(['ok' => true]);
        }

        $data = $request->validate([
            'message' => ['required', 'string', 'min:10', 'max:5000'],
            'details' => ['nullable', 'string', 'max:6000'],
            'game' => ['nullable', 'string', 'max:200000'],
            'email' => ['nullable', 'string', 'email', 'max:254'],
        ], [
            'message.min' => 'Describe what happened in a sentence or two.',
            'email.email' => 'That email address does not look right. Fix it or leave it empty.',
        ]);

        $email = $data['email'] ?? '';
        $body = $data['message']."\n\n"
            ."----------------------------------------\n"
            .($email !== '' ? "Reply to: {$email}\n" : "No reply address given.\n")
            .($request->user() ? "Signed in as: {$request->user()->email}\n" : '')
            .'Sent: '.gmdate('Y-m-d H:i').' UTC from '.$request->getHost()."\n\n"
            .($data['details'] ?? '')."\n"
            .(! empty($data['game']) ? "\n----------------------------------------\n{$data['game']}\n" : '');

        try {
            Mail::raw($body, function (Message $mail) use ($to, $from, $email, $data) {
                if ($from) {
                    $mail->from($from, config('app.name'));
                }
                $mail->to($to)->subject('['.config('app.name').'] '.Str::limit(preg_replace('/\s+/', ' ', $data['message']), 70));
                if ($email !== '') {
                    $mail->replyTo($email);
                }
            });
        } catch (Throwable $e) {
            Log::warning('Bug report could not be sent', ['error' => $e->getMessage()]);

            return response()->json(['ok' => false, 'error' => 'The server could not send the email.'], 502);
        }

        return response()->json(['ok' => true]);
    }
}
