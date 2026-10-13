<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as SocialiteUser;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

/**
 * Sign-in with Google, by the usual OAuth redirect. Google sends the person back to
 * /auth/google/callback, where they are signed in with the same session cookie the app's
 * API uses, then returned to the app.
 *
 * The same redirect, started by someone already signed in, connects Google to their account
 * instead (the "Connect Google" button). That is the only way a Google account is joined to an
 * existing one: signing up here does not check email addresses, so anyone could have made an
 * account with another person's address, and joining Google to it automatically would hand
 * that person an account the impostor can still open with their password.
 */
class GoogleController extends Controller
{
    private const LINKING = 'google_link_user';

    public static function enabled(): bool
    {
        return (bool) config('services.google.client_id') && (bool) config('services.google.client_secret');
    }

    public function redirect(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);
        // Signed in already: this is "Connect Google", for this account only.
        if (Auth::guard('web')->check()) {
            $request->session()->put(self::LINKING, Auth::guard('web')->id());
        } else {
            $request->session()->forget(self::LINKING);
        }

        // Google's default scopes are just openid, profile and email.
        return Socialite::driver('google')->redirect();
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);
        $linking = $request->session()->pull(self::LINKING);
        $back = fn (string $reason) => $linking ? redirect()->to(self::app('/account/google-'.$reason)) : $this->back($reason);

        // Pressed "Cancel" on Google's page.
        if ($request->filled('error')) {
            return $back('cancelled');
        }
        try {
            $google = Socialite::driver('google')->user();
        } catch (Throwable $e) {
            report($e);

            return $back('failed');
        }

        // Only an address Google itself has verified identifies anyone.
        $email = Str::lower(trim((string) $google->getEmail()));
        if ($email === '' || ! $google->getId() || ! self::verified($google)) {
            return $back('unverified');
        }

        if ($linking) {
            return $this->connect($request, (int) $linking, $google);
        }

        $user = User::where('google_id', $google->getId())->first();
        if (! $user) {
            if (User::where('email', $email)->exists()) {
                // Never joined automatically; see the class comment.
                return $this->back('exists');
            }
            $user = User::forceCreate([
                'email' => $email,
                'name' => $google->getName(),
                'google_id' => $google->getId(),
                'password' => null,
                'email_verified_at' => now(),
            ]);
        }

        $user->markSeen();
        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return redirect()->to(self::app('/'));
    }

    /** "Connect Google" from the Account page: the person proved both accounts are theirs. */
    private function connect(Request $request, int $userId, SocialiteUser $google): RedirectResponse
    {
        $user = Auth::guard('web')->user();
        // Signed out, or signed in as someone else, since pressing the button.
        if (! $user || $user->id !== $userId) {
            return $this->back('failed');
        }
        $owner = User::where('google_id', $google->getId())->first();
        if ($owner && $owner->id !== $user->id) {
            return redirect()->to(self::app('/account/google-taken'));
        }
        $user->forceFill(['google_id' => $google->getId()])->save();
        if (Str::lower(trim((string) $google->getEmail())) === Str::lower($user->email)) {
            $user->markAddressVerified();
        }
        $request->session()->regenerate();

        return redirect()->to(self::app('/account/google-connected'));
    }

    /** Whether Google reported the address as verified. Read strictly: the string "false" is false. */
    private static function verified(SocialiteUser $google): bool
    {
        $raw = $google->getRaw();

        return filter_var($raw['email_verified'] ?? $raw['verified_email'] ?? false, FILTER_VALIDATE_BOOLEAN);
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
