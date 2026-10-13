<?php

namespace Tests\Feature;

use App\Models\Game;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_session_is_empty_before_signing_in(): void
    {
        $this->getJson('/api/session')->assertOk()->assertJsonPath('user', null);
    }

    public function test_the_session_carries_the_donation_link_only_when_it_is_https(): void
    {
        config(['chessdebrief.donate_url' => '']);
        $this->getJson('/api/session')->assertJsonPath('donate', null);
        config(['chessdebrief.donate_url' => 'javascript:alert(1)']);
        $this->getJson('/api/session')->assertJsonPath('donate', null);
        config(['chessdebrief.donate_url' => 'https://ko-fi.com/chessdebrief']);
        $this->getJson('/api/session')->assertJsonPath('donate', 'https://ko-fi.com/chessdebrief');
    }

    public function test_register_signs_in_and_lowercases_the_email(): void
    {
        $this->postJson('/api/register', ['email' => '  Player@Example.com ', 'password' => 'long enough'])
            ->assertCreated()
            ->assertJsonPath('user.email', 'player@example.com');

        $this->getJson('/api/session')->assertJsonPath('user.email', 'player@example.com');
        $this->assertNotNull(User::first()->last_seen_at);
    }

    public function test_the_site_itself_gets_a_session_without_being_listed(): void
    {
        // The real setting, as in production: the site's own domain is in no list.
        config(['sanctum.stateful' => (require config_path('sanctum.php'))['stateful']]);
        $site = 'https://chessdebrief.example';
        $this->withHeaders(['Origin' => $site, 'Referer' => "{$site}/"]);

        $this->postJson("{$site}/api/register", ['email' => 'site@example.com', 'password' => 'long enough'])->assertCreated();
        $this->getJson("{$site}/api/session")->assertJsonPath('user.email', 'site@example.com');
    }

    public function test_register_refuses_a_taken_email_and_a_short_password(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/register', ['email' => 'TAKEN@example.com', 'password' => 'long enough'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'An account with that email already exists. Sign in instead.');
        $this->postJson('/api/register', ['email' => 'new@example.com', 'password' => 'short'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');
    }

    public function test_login_and_logout(): void
    {
        User::factory()->create(['email' => 'me@example.com', 'password' => 'right password']);

        $this->postJson('/api/login', ['email' => 'me@example.com', 'password' => 'wrong password'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'That email and password do not match an account.');

        $this->postJson('/api/login', ['email' => 'Me@Example.com', 'password' => 'right password'])
            ->assertOk()
            ->assertJsonPath('user.email', 'me@example.com');
        $this->postJson('/api/logout')->assertNoContent();

        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/session')->assertJsonPath('user', null);
    }

    public function test_signed_out_requests_to_games_are_refused(): void
    {
        $this->getJson('/api/games')->assertUnauthorized();
        $this->postJson('/api/refresh')->assertUnauthorized();
    }

    public function test_forgot_password_answers_the_same_for_unknown_addresses(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email' => 'me@example.com']);

        $known = $this->postJson('/api/forgot-password', ['email' => 'me@example.com'])->assertOk()->json();
        $unknown = $this->postJson('/api/forgot-password', ['email' => 'nobody@example.com'])->assertOk()->json();
        $this->assertSame($known, $unknown);

        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use ($user) {
            $url = $n->toMail($user)->actionUrl;

            return str_contains($url, '/#/reset/'.$n->token.'/me%40example.com');
        });
    }

    public function test_reset_password_sets_the_new_password_and_signs_in(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email' => 'me@example.com']);
        $this->postJson('/api/forgot-password', ['email' => 'me@example.com']);
        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use (&$token) {
            $token = $n->token;

            return true;
        });

        $this->postJson('/api/reset-password', ['token' => 'not-the-token', 'email' => 'me@example.com', 'password' => 'a new password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('token');
        $this->postJson('/api/reset-password', ['token' => $token, 'email' => 'me@example.com', 'password' => 'a new password'])
            ->assertOk()
            ->assertJsonPath('user.email', 'me@example.com');

        $this->assertTrue(password_verify('a new password', $user->fresh()->password));
    }

    public function test_deleting_the_account_needs_the_password_and_removes_its_games(): void
    {
        $user = User::factory()->create(['password' => 'my password']);
        $user->games()->create(['game_id' => 'pgn:1', 'source' => 'pgn', 'record' => '{}', 'updated_ms' => 1]);

        $this->actingAs($user)->deleteJson('/api/user', ['password' => 'not it'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.password.0', 'That password is not right.');
        $this->actingAs($user)->deleteJson('/api/user', ['password' => 'my password'])->assertNoContent();

        $this->assertDatabaseMissing('users', ['id' => $user->id]);
        $this->assertSame(0, Game::count());
    }
}
