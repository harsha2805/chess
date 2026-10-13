<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

/**
 * Sign-in with Google, by the usual OAuth redirect. Google sends the person back to
 * /auth/google/callback, where they are signed in with the same session cookie the app's
 * API uses, then returned to the app.
 */
class GoogleController extends Controller
{
    public static function enabled(): bool
    {
        return (bool) config('services.google.client_id') && (bool) config('services.google.client_secret');
    }

    public function redirect(): RedirectResponse
    {
        abort_unless(self::enabled(), 404);

        return Socialite::driver('google')->scopes(['openid', 'email', 'profile'])->redirect();
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);
        // Pressed "Cancel" on Google's page.
        if ($request->filled('error')) {
            return $this->back('cancelled');
        }

        try {
            $google = Socialite::driver('google')->user();
        } catch (Throwable $e) {
            report($e);

            return $this->back('failed');
        }

        $email = Str::lower(trim((string) $google->getEmail()));
        $verified = (bool) ($google->user['email_verified'] ?? $google->user['verified_email'] ?? false);
        if ($email === '' || ! $google->getId()) {
            return $this->back('failed');
        }

        $user = User::where('google_id', $google->getId())->first();
        if (! $user) {
            $existing = User::where('email', $email)->first();
            if ($existing) {
                // An account with this address already exists. It is linked only when Google has
                // checked the address belongs to this person; otherwise anyone could take it over.
                if (! $verified) {
                    return $this->back('unverified');
                }
                $existing->forceFill(['google_id' => $google->getId()])->save();
                $user = $existing;
            } else {
                $user = User::forceCreate([
                    'email' => $email,
                    'name' => $google->getName(),
                    'google_id' => $google->getId(),
                    'password' => null,
                    'email_verified_at' => $verified ? now() : null,
                ]);
            }
        }

        $user->markSeen();
        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return redirect()->to(self::app('/'));
    }

    /** An address in the app, which uses hash routes. */
    public static function app(string $route): string
    {
        return rtrim(url('/'), '/').'/#'.$route;
    }

    /** Back to the app's sign-in page, which explains what went wrong. */
    private function back(string $reason): RedirectResponse
    {
        return redirect()->to(self::app('/signin/google-'.$reason));
    }
}
