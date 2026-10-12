<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Game;
use App\Services\GameSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class GameController extends Controller
{
    private const ID = 'regex:/^[A-Za-z0-9:_\-.\/]{1,120}$/';

    private const DEVICE = 'regex:/^[A-Za-z0-9]{16}$/';

    public function __construct(private GameSync $sync) {}

    /**
     * Changes since a cursor (`since` ms and `after` row id), or named games in full (`ids`).
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'since' => ['nullable', 'integer', 'min:0'],
            'after' => ['nullable', 'integer', 'min:0'],
            'device' => ['nullable', 'string', self::DEVICE],
            'ids' => ['nullable', 'array', 'max:'.GameSync::PAGE],
            'ids.*' => ['string', self::ID],
        ]);
        $user = $request->user();
        if (! empty($data['ids'])) {
            return response()->json(['games' => $this->sync->find($user, $data['ids'])]);
        }

        return response()->json($this->sync->changes($user, (int) ($data['since'] ?? 0), (int) ($data['after'] ?? 0), $data['device'] ?? null));
    }

    /**
     * Games added or reviewed in a browser, and games removed there.
     *
     * The body is decoded here rather than read from the request, because Laravel trims strings
     * and turns empty ones into null on the way in, and records must arrive exactly as sent.
     * `record` and `review` are JSON text, stored as they are.
     */
    public function sync(Request $request): JsonResponse
    {
        $body = json_decode($request->getContent(), true);
        $data = Validator::make(is_array($body) ? $body : [], [
            'device' => ['nullable', 'string', self::DEVICE],
            'upsert' => ['array', 'max:50'],
            'upsert.*.id' => ['required', 'string', self::ID, 'distinct'],
            'upsert.*.source' => ['required', 'string', 'in:'.implode(',', Game::SOURCES)],
            'upsert.*.account' => ['nullable', 'string', 'regex:/^(chesscom|lichess):[a-z0-9_\-]{1,30}$/'],
            'upsert.*.playedAt' => ['required', 'integer', 'min:0'],
            'upsert.*.addedAt' => ['required', 'integer', 'min:0'],
            'upsert.*.record' => ['required', 'string', 'json', 'max:300000'],
            'upsert.*.review' => ['nullable', 'string', 'json', 'max:2000000'],
            'upsert.*.reviewAt' => ['nullable', 'required_with:upsert.*.review', 'integer', 'min:0'],
            'delete' => ['array', 'max:500'],
            'delete.*' => ['string', self::ID],
        ])->validate();

        $user = $request->user();
        $device = $data['device'] ?? null;

        return response()->json([
            'saved' => $this->sync->upsert($user, $data['upsert'] ?? [], $device),
            'deleted' => $this->sync->delete($user, array_values(array_unique($data['delete'] ?? [])), $device),
        ]);
    }
}
