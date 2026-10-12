<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ChessSiteLimited;
use App\Http\Controllers\Controller;
use App\Models\ChessAccount;
use App\Services\GameFetcher;
use App\Services\GameSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** The chess accounts whose new games are fetched for the person signed in. */
class ChessAccountController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['accounts' => $this->list($request)]);
    }

    /**
     * Starts checking an account. Its games up to now are taken as already brought in: the
     * app has just fetched the ones the person asked for.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'platform' => ['required', Rule::in(ChessAccount::PLATFORMS)],
            'username' => ['required', 'string', 'regex:/^[A-Za-z0-9_\-]{2,30}$/'],
        ]);
        $user = $request->user();
        $username = Str::lower($data['username']);
        $account = $user->chessAccounts()->where(['platform' => $data['platform'], 'username' => $username])->first();
        if (! $account) {
            $max = config('chessdebrief.max_accounts');
            if ($user->chessAccounts()->count() >= $max) {
                throw ValidationException::withMessages(['username' => "Up to {$max} accounts can be checked. Remove one on the Account page first."]);
            }
            $account = $user->chessAccounts()->create([
                'platform' => $data['platform'],
                'username' => $username,
                'watermark_ms' => GameSync::nowMs(),
                // The app's own import counts as the first check; the next is due in two hours.
                'last_fetched_at' => now(),
            ]);
        }

        return response()->json(['account' => $account->toApi(), 'accounts' => $this->list($request)], $account->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, int $id): Response
    {
        $request->user()->chessAccounts()->whereKey($id)->delete();

        return response()->noContent();
    }

    /**
     * Checks the person's accounts now. Without `force`, only the accounts due by the schedule
     * (the app asks this way every two hours while it is open); with it, every account not
     * checked in the last minute (the Refresh button).
     */
    public function refresh(Request $request, GameFetcher $fetcher): JsonResponse
    {
        $force = $request->boolean('force');
        $user = $request->user();
        $user->markSeen();
        $seconds = $force ? 60 : (int) round(config('chessdebrief.fetch_every_hours') * 3600);
        set_time_limit(120);

        $added = 0;
        $limited = [];
        foreach ($user->chessAccounts()->stale($seconds)->get() as $account) {
            if (in_array($account->platform, $limited, true)) {
                continue;
            }
            try {
                $added += $fetcher->fetch($account);
            } catch (ChessSiteLimited) {
                $limited[] = $account->platform;
            }
        }

        return response()->json(['added' => $added, 'accounts' => $this->list($request)]);
    }

    private function list(Request $request): array
    {
        return $request->user()->chessAccounts()->orderBy('id')->get()->map(fn (ChessAccount $a) => $a->toApi())->all();
    }
}
