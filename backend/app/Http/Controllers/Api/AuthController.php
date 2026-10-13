<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sign-in for the app, with Sanctum's cookie sessions. The app and this API share one site,
 * so there are no tokens to keep: the session cookie is httpOnly and requests carry the
 * XSRF token Laravel sets.
 */
class AuthController extends Controller
{
    private const PASSWORD_RULES = ['required', 'string', 'min:8', 'max:200'];

    /** Who is signed in, or null. Asked when the app opens. */
    public function session(Request $request): JsonResponse
    {
        $user = Auth::guard('web')->user();
        $user?->markSeen();

        return response()->json([
            'user' => $user?->toApi(),
            // Ways to sign in that this server has set up, so the app shows only those.
            'providers' => ['google' => GoogleController::enabled()],
            // The "Support ChessDebrief" link, or null to hide it.
            'donate' => self::donateUrl(),
        ]);
    }

    public function register(Request $request): JsonResponse
    {
        $request->merge(['email' => self::email($request)]);
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:254', 'unique:users,email'],
            'password' => self::PASSWORD_RULES,
        ], [
            'email.unique' => 'An account with that email already exists. Sign in instead.',
        ]);

        $user = User::create($data);
        $user->markSeen();
        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return response()->json(['user' => $user->toApi()], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $request->merge(['email' => self::email($request)]);
        $data = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::guard('web')->attempt($data, remember: true)) {
            $googleOnly = User::where('email', $data['email'])->whereNull('password')->whereNotNull('google_id')->exists();
            throw ValidationException::withMessages(['email' => $googleOnly
                ? 'This account signs in with Google. Use "Continue with Google", or set a password with "Forgot your password?".'
                : 'That email and password do not match an account.']);
        }
        $request->session()->regenerate();
        $user = Auth::guard('web')->user();
        $user->markSeen();

        return response()->json(['user' => $user->toApi()]);
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    /** Emails a link to set a new password. The answer is the same whether or not the address has an account. */
    public function forgot(Request $request): JsonResponse
    {
        $request->merge(['email' => self::email($request)]);
        $request->validate(['email' => ['required', 'string', 'email']]);
        Password::sendResetLink($request->only('email'));

        return response()->json(['message' => 'If an account uses that address, a link to set a new password is on its way.']);
    }

    public function reset(Request $request): JsonResponse
    {
        $request->merge(['email' => self::email($request)]);
        $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'string', 'email'],
            'password' => self::PASSWORD_RULES,
        ]);

        $status = Password::reset($request->only('email', 'password', 'token'), function (User $user, string $password) {
            // The link reached the inbox, so the address is theirs.
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60), 'email_verified_at' => $user->email_verified_at ?? now()])->save();
            // Signed in elsewhere with the old password: those sessions end.
            DB::table('sessions')->where('user_id', $user->id)->delete();
            event(new PasswordReset($user));
        });
        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['token' => 'This link has expired or was already used. Ask for a new one.']);
        }

        $user = User::where('email', $request->string('email'))->firstOrFail();
        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return response()->json(['user' => $user->toApi()]);
    }

    /** Deletes the account and everything stored with it. Games in the browser are untouched. */
    public function destroy(Request $request): Response
    {
        $user = $request->user();
        if ($user->password !== null) {
            $request->validate(['password' => ['required', 'string', 'current_password:web']], [
                'password.current_password' => 'That password is not right.',
            ]);
        } elseif (Str::lower(trim((string) $request->input('confirm'))) !== $user->email) {
            // Signed in only with Google: typing the address confirms instead.
            throw ValidationException::withMessages(['confirm' => 'Type your email address exactly to confirm.']);
        }
        Auth::guard('web')->logout();
        DB::table('sessions')->where('user_id', $user->id)->delete();
        $user->delete();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    /** Stops signing in with Google. Only for an account with a password, so it cannot lock itself out. */
    public function disconnectGoogle(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->password === null) {
            throw ValidationException::withMessages(['google' => 'Set a password first ("Forgot your password?" on the sign-in page), so you can still sign in.']);
        }
        $user->forceFill(['google_id' => null])->save();

        return response()->json(['user' => $user->toApi()]);
    }

    private static function donateUrl(): ?string
    {
        $url = (string) config('chessdebrief.donate_url');

        return preg_match('#^https://#i', $url) ? $url : null;
    }

    private static function email(Request $request): string
    {
        return Str::lower(trim((string) $request->input('email')));
    }
}
