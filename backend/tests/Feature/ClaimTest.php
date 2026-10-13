<?php

namespace Tests\Feature;

use App\Models\Game;
use App\Models\User;
use App\Services\GameSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClaimTest extends TestCase
{
    use RefreshDatabase;

    private const A = 'aaaaaaaaaaaaaaaa';

    private const B = 'bbbbbbbbbbbbbbbb';

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user)->postJson('/api/games/sync', ['upsert' => [[
            'id' => 'lichess:a/b',
            'source' => 'lichess',
            'playedAt' => 1,
            'addedAt' => 1,
            'record' => '{}',
        ]]])->assertOk();
    }

    private function claim(string $device, string $action = 'claim', int $progress = 0, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->user)->postJson('/api/games/claim', ['id' => 'lichess:a/b', 'device' => $device, 'action' => $action, 'progress' => $progress]);
    }

    private function row(): Game
    {
        return Game::where('game_id', 'lichess:a/b')->firstOrFail();
    }

    public function test_one_browser_at_a_time_works_on_a_game(): void
    {
        $this->claim(self::A)->assertOk()->assertJson(['granted' => true]);
        $this->claim(self::A, 'renew', 40)->assertOk();
        $this->claim(self::B)->assertOk()->assertJson(['granted' => false, 'progress' => 40]);

        $this->claim(self::B, 'release')->assertOk();
        $this->assertSame(self::A, $this->row()->claim_device);

        $this->claim(self::A, 'release')->assertOk();
        $this->claim(self::B)->assertOk();
    }

    public function test_a_claim_runs_out_unless_renewed(): void
    {
        $this->claim(self::A)->assertOk();
        $this->row()->update(['claim_until_ms' => GameSync::nowMs() - 1]);

        $this->claim(self::B)->assertOk();
        // The first browser comes back from sleep: the game is no longer its own.
        $this->claim(self::A, 'renew', 80)->assertJson(['granted' => false]);
    }

    public function test_claims_do_not_send_the_game_to_other_devices_again(): void
    {
        $before = $this->row()->updated_ms;
        $this->claim(self::A);
        $this->claim(self::A, 'renew', 50);
        $this->claim(self::A, 'release');
        $this->assertSame($before, $this->row()->updated_ms);
    }

    public function test_the_claim_ends_when_its_review_arrives_or_the_game_is_removed(): void
    {
        $this->claim(self::A)->assertOk();
        $this->actingAs($this->user)->postJson('/api/games/sync', ['device' => self::A, 'upsert' => [[
            'id' => 'lichess:a/b', 'source' => 'lichess', 'playedAt' => 1, 'addedAt' => 1, 'record' => '{}',
            'review' => '{"version":1,"depth":16}', 'reviewAt' => 5,
        ]]])->assertOk();
        $this->assertNull($this->row()->claim_device);

        $this->claim(self::B)->assertOk();
        $this->actingAs($this->user)->postJson('/api/games/sync', ['delete' => ['lichess:a/b']])->assertOk();
        $this->assertNull($this->row()->claim_device);
        $this->claim(self::A)->assertNotFound();
    }

    public function test_people_only_claim_their_own_games(): void
    {
        $this->claim(self::A, as: User::factory()->create())->assertNotFound();
        $this->actingAs($this->user)->postJson('/api/games/claim', ['id' => 'bad id', 'device' => self::A, 'action' => 'claim'])->assertUnprocessable();
        $this->actingAs($this->user)->postJson('/api/games/claim', ['id' => 'lichess:a/b', 'device' => self::A, 'action' => 'steal'])->assertUnprocessable();
    }
}
