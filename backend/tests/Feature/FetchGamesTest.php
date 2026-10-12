<?php

namespace Tests\Feature;

use App\Models\ChessAccount;
use App\Models\Game;
use App\Models\User;
use App\Services\GameSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FetchGamesTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['last_seen_at' => now()]);
    }

    private function account(string $platform, array $extra = []): ChessAccount
    {
        return $this->user->chessAccounts()->create($extra + [
            'platform' => $platform,
            'username' => 'me',
            'watermark_ms' => GameSync::nowMs() - 86_400_000,
        ]);
    }

    private function chessComGame(string $uuid, int $endedMs, array $extra = []): array
    {
        return $extra + [
            'uuid' => $uuid,
            'url' => "https://www.chess.com/game/live/{$uuid}",
            'pgn' => '[White "me"]',
            'end_time' => intdiv($endedMs, 1000),
            'rules' => 'chess',
            'time_class' => 'blitz',
            'white' => ['username' => 'me', 'rating' => 1500],
            'black' => ['username' => 'them', 'rating' => 1500],
            'accuracies' => (object) [],
        ];
    }

    private function fakeChessCom(array $games): void
    {
        $month = gmdate('Y/m');
        Http::fake([
            'api.chess.com/pub/player/me/games/archives' => Http::response(['archives' => ['https://api.chess.com/pub/player/me/games/2020/01', "https://api.chess.com/pub/player/me/games/{$month}"]]),
            "api.chess.com/pub/player/me/games/{$month}" => Http::response(['games' => $games]),
            '*' => Http::response('unexpected request', 500),
        ]);
    }

    public function test_chess_com_games_after_the_watermark_come_in_once(): void
    {
        $account = $this->account('chesscom');
        $now = GameSync::nowMs();
        $this->fakeChessCom([
            $this->chessComGame('new', $now - 60_000),
            $this->chessComGame('old', $now - 3 * 86_400_000),
            $this->chessComGame('variant', $now - 60_000, ['rules' => 'chess960']),
        ]);

        $this->artisan('games:fetch')->assertSuccessful();

        $games = Game::all();
        $this->assertSame(['chesscom:new'], $games->pluck('game_id')->all());
        $this->assertSame('chesscom:me', $games[0]->account);
        $this->assertNull($games[0]->record);
        // Empty objects stay objects.
        $this->assertStringContainsString('"accuracies":{}', $games[0]->raw);
        $account->refresh();
        $this->assertNull($account->last_error);
        $this->assertGreaterThan($now - 1000, $account->watermark_ms);
        Http::assertSent(fn ($request) => str_contains($request->header('User-Agent')[0] ?? '', 'ChessDebrief'));

        // Not due again for two hours.
        $this->artisan('games:fetch')->expectsOutputToContain('Checked 0 accounts');
    }

    public function test_a_removed_game_is_not_brought_back(): void
    {
        $this->account('chesscom');
        $this->user->games()->create(['game_id' => 'chesscom:gone', 'source' => 'chesscom', 'deleted' => true, 'updated_ms' => 1]);
        $this->fakeChessCom([$this->chessComGame('gone', GameSync::nowMs() - 60_000)]);

        $this->artisan('games:fetch')->expectsOutputToContain('0 new games');

        $this->assertTrue(Game::firstWhere('game_id', 'chesscom:gone')->deleted);
    }

    public function test_lichess_games_are_read_from_ndjson(): void
    {
        $this->account('lichess');
        $now = GameSync::nowMs();
        $lines = [
            ['id' => 'AbCd1234', 'variant' => 'standard', 'createdAt' => $now - 600_000, 'lastMoveAt' => $now - 60_000, 'pgn' => '1. e4', 'players' => (object) []],
            ['id' => 'zh000001', 'variant' => 'crazyhouse', 'createdAt' => $now - 600_000, 'lastMoveAt' => $now - 60_000, 'pgn' => '1. e4'],
            ['id' => 'old00001', 'variant' => 'standard', 'createdAt' => $now - 5 * 86_400_000, 'lastMoveAt' => $now - 5 * 86_400_000, 'pgn' => '1. e4'],
        ];
        Http::fake(['lichess.org/api/games/user/me*' => Http::response(implode("\n", array_map('json_encode', $lines))."\n")]);

        $this->artisan('games:fetch')->assertSuccessful();

        $game = Game::sole();
        $this->assertSame('lichess:AbCd1234', $game->game_id);
        $this->assertSame($now - 600_000, $game->played_ms);
        Http::assertSent(fn ($request) => $request->hasHeader('Accept', 'application/x-ndjson') && str_contains($request->url(), 'pgnInJson=true'));
    }

    public function test_problems_are_recorded_on_the_account(): void
    {
        $account = $this->account('chesscom');
        Http::fake(['*' => Http::response('', 404)]);

        $this->artisan('games:fetch')->assertSuccessful();

        $this->assertSame('No chess.com player is called "me".', $account->fresh()->last_error);
    }

    public function test_a_rate_limit_stops_asking_that_site_for_the_rest_of_the_run(): void
    {
        $this->account('lichess', ['username' => 'one']);
        $this->account('lichess', ['username' => 'two']);
        Http::fake(['*' => Http::response('', 429)]);

        $this->artisan('games:fetch')->assertSuccessful();

        Http::assertSentCount(1);
    }

    public function test_people_who_stopped_coming_are_skipped(): void
    {
        $this->user->forceFill(['last_seen_at' => now()->subDays(45)])->save();
        $this->account('chesscom');
        Http::fake();

        $this->artisan('games:fetch')->expectsOutputToContain('Checked 0 accounts');
        Http::assertNothingSent();
    }

    public function test_linking_an_account_and_refreshing(): void
    {
        $this->actingAs($this->user)->postJson('/api/accounts', ['platform' => 'chesscom', 'username' => 'Me'])
            ->assertCreated()
            ->assertJsonPath('account.username', 'me');
        // Linking again is not a second account.
        $this->actingAs($this->user)->postJson('/api/accounts', ['platform' => 'chesscom', 'username' => 'me'])->assertOk();
        $this->assertSame(1, ChessAccount::count());

        $this->fakeChessCom([$this->chessComGame('fresh', GameSync::nowMs() + 1000)]);

        // Not due yet: nothing is asked.
        $this->actingAs($this->user)->postJson('/api/refresh')->assertOk()->assertJsonPath('added', 0);
        Http::assertNothingSent();

        // Within a minute of the last check, the Refresh button does not ask either.
        $this->actingAs($this->user)->postJson('/api/refresh', ['force' => true])->assertJsonPath('added', 0);
        Http::assertNothingSent();

        // After that it asks, though the schedule would wait.
        $this->travel(2)->minutes();
        $this->actingAs($this->user)->postJson('/api/refresh', ['force' => true])
            ->assertOk()
            ->assertJsonPath('added', 1)
            ->assertJsonPath('accounts.0.lastError', null);
    }

    public function test_at_most_five_accounts(): void
    {
        foreach (['a1', 'a2', 'a3', 'a4', 'a5'] as $name) {
            $this->actingAs($this->user)->postJson('/api/accounts', ['platform' => 'lichess', 'username' => $name])->assertCreated();
        }
        $this->actingAs($this->user)->postJson('/api/accounts', ['platform' => 'lichess', 'username' => 'a6'])
            ->assertJsonValidationErrors('username');

        $id = ChessAccount::first()->id;
        $this->actingAs($this->user)->deleteJson("/api/accounts/{$id}")->assertNoContent();
        $this->assertSame(4, ChessAccount::count());
    }
}
