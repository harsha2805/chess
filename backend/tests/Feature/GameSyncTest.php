<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GameSyncTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    private function game(string $id, array $extra = []): array
    {
        return $extra + [
            'id' => $id,
            'source' => 'chesscom',
            'account' => 'chesscom:me',
            'playedAt' => 1_760_000_000_000,
            'addedAt' => 1_760_000_100_000,
            // An empty object and padded text, which must survive the trip unchanged.
            'record' => '{"id":"'.$id.'","pgn":"1. e4 e5 ","headers":{}}',
        ];
    }

    private function push(array $body)
    {
        return $this->actingAs($this->user)->postJson('/api/games/sync', $body);
    }

    private function pull(array $query = [])
    {
        return $this->actingAs($this->user)->getJson('/api/games?'.http_build_query($query));
    }

    public function test_pushed_games_come_back_exactly_as_sent(): void
    {
        $this->push(['upsert' => [$this->game('chesscom:a')]])->assertOk()->assertJson(['saved' => 1, 'deleted' => 0]);

        $row = $this->pull()->assertOk()->json('games.0');
        $this->assertSame('chesscom:a', $row['id']);
        $this->assertSame('{"id":"chesscom:a","pgn":"1. e4 e5 ","headers":{}}', $row['record']);
        $this->assertNull($row['review']);
        $this->assertFalse($row['deleted']);
    }

    public function test_the_newer_review_wins(): void
    {
        $this->push(['upsert' => [$this->game('chesscom:a', ['review' => '{"v":"new"}', 'reviewAt' => 200])]]);
        $this->push(['upsert' => [$this->game('chesscom:a', ['review' => '{"v":"old"}', 'reviewAt' => 100])]]);
        $this->assertSame('{"v":"new"}', $this->pull()->json('games.0.review'));

        // A push without a review keeps the stored one.
        $this->push(['upsert' => [$this->game('chesscom:a')]]);
        $this->assertSame('{"v":"new"}', $this->pull()->json('games.0.review'));

        $this->push(['upsert' => [$this->game('chesscom:a', ['review' => '{"v":"newer"}', 'reviewAt' => 300])]]);
        $this->assertSame('{"v":"newer"}', $this->pull()->json('games.0.review'));
    }

    public function test_changes_are_paged_by_cursor(): void
    {
        $games = array_map(fn ($i) => $this->game("pgn:{$i}", ['source' => 'pgn', 'account' => null]), range(1, 50));
        $this->push(['upsert' => $games]);
        $this->push(['upsert' => [$this->game('pgn:51', ['source' => 'pgn', 'account' => null])]]);

        $first = $this->pull()->json();
        $this->assertCount(50, $first['games']);
        $this->assertTrue($first['more']);

        $second = $this->pull(['since' => $first['cursor']['ms'], 'after' => $first['cursor']['id']])->json();
        $this->assertSame(['pgn:51'], array_column($second['games'], 'id'));
        $this->assertFalse($second['more']);

        $third = $this->pull(['since' => $second['cursor']['ms'], 'after' => $second['cursor']['id']])->json();
        $this->assertSame([], $third['games']);
        $this->assertSame($second['cursor'], $third['cursor']);
    }

    public function test_a_browser_is_not_sent_back_its_own_changes(): void
    {
        $this->push(['device' => 'aaaaaaaaaaaaaaaa', 'upsert' => [$this->game('chesscom:a')]]);

        $own = $this->pull(['device' => 'aaaaaaaaaaaaaaaa'])->json('games.0');
        $this->assertTrue($own['same']);
        $this->assertArrayNotHasKey('record', $own);

        $other = $this->pull(['device' => 'bbbbbbbbbbbbbbbb'])->json('games.0');
        $this->assertArrayNotHasKey('same', $other);
        $this->assertNotNull($other['record']);

        $found = $this->actingAs($this->user)->getJson('/api/games?ids[]=chesscom:a')->json('games.0');
        $this->assertNotNull($found['record']);
    }

    public function test_deleting_leaves_an_empty_marker(): void
    {
        $this->push(['upsert' => [$this->game('chesscom:a', ['review' => '{}', 'reviewAt' => 1])]]);
        $this->push(['delete' => ['chesscom:a', 'lichess:neverSeen']])->assertJson(['deleted' => 2]);

        $rows = collect($this->pull()->json('games'))->keyBy('id');
        $this->assertTrue($rows['chesscom:a']['deleted']);
        $this->assertArrayNotHasKey('record', $rows['chesscom:a']);
        $this->assertTrue($rows['lichess:neverSeen']['deleted']);
        $this->assertDatabaseHas('games', ['game_id' => 'lichess:neverSeen', 'source' => 'lichess', 'deleted' => true]);

        // Adding the game again brings it back.
        $this->push(['upsert' => [$this->game('chesscom:a')]]);
        $this->assertFalse(collect($this->pull()->json('games'))->firstWhere('id', 'chesscom:a')['deleted']);
    }

    public function test_lichess_ids_that_differ_only_by_case_are_different_games(): void
    {
        $this->push(['upsert' => [$this->game('lichess:AbCd1234', ['source' => 'lichess']), $this->game('lichess:abcd1234', ['source' => 'lichess'])]]);
        $this->assertCount(2, $this->pull()->json('games'));
    }

    public function test_bad_input_is_refused(): void
    {
        $this->push(['upsert' => [$this->game('bad id with spaces')]])->assertUnprocessable();
        $this->push(['upsert' => [$this->game('chesscom:a', ['record' => 'not json'])]])->assertUnprocessable();
        $this->push(['upsert' => [$this->game('chesscom:a', ['review' => '{}'])]])->assertJsonValidationErrors('upsert.0.reviewAt');
        $this->push(['upsert' => [$this->game('chesscom:a', ['source' => 'elsewhere'])]])->assertUnprocessable();
    }

    public function test_people_only_see_their_own_games(): void
    {
        $this->push(['upsert' => [$this->game('chesscom:a')]]);
        $other = User::factory()->create();

        $this->actingAs($other)->getJson('/api/games')->assertJsonPath('games', []);
    }
}
