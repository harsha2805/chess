<?php

namespace App\Http\Controllers\Api;

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

        return response()->json(['user' => $user?->toApi()]);
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
            throw ValidationException::withMessages(['email' => 'That email and password do not match an account.']);
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
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
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
        $request->validate(['password' => ['required', 'string', 'current_password:web']], [
            'password.current_password' => 'That password is not right.',
        ]);
        $user = $request->user();
        Auth::guard('web')->logout();
        DB::table('sessions')->where('user_id', $user->id)->delete();
        $user->delete();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    private static function email(Request $request): string
    {
        return Str::lower(trim((string) $request->input('email')));
    }
}
