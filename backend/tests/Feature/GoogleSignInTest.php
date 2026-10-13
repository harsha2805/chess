<?php

namespace Tests\Feature;

use App\Http\Controllers\Auth\GoogleController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as GoogleUser;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class GoogleSignInTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.google.client_id' => 'id', 'services.google.client_secret' => 'secret', 'services.google.redirect' => 'http://localhost/auth/google/callback']);
    }

    /** Google answers with this person. */
    private function google(string $id, string $email, bool $verified = true): void
    {
        $user = (new GoogleUser)->setRaw(['sub' => $id, 'email' => $email, 'email_verified' => $verified])
            ->map(['id' => $id, 'email' => $email, 'name' => 'Some Player']);
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andReturn($user);
        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
    }

    public function test_the_session_says_whether_google_is_set_up(): void
    {
        $this->getJson('/api/session')->assertJsonPath('providers.google', true);
        config(['services.google.client_id' => '']);
        $this->getJson('/api/session')->assertJsonPath('providers.google', false);
        $this->get('/auth/google/redirect')->assertNotFound();
    }

    public function test_the_redirect_goes_to_google(): void
    {
        $this->get('/auth/google/redirect')->assertRedirectContains('accounts.google.com');
    }

    public function test_a_new_person_gets_an_account_without_a_password(): void
    {
        $this->google('g-1', 'New@Example.com');

        $this->get('/auth/google/callback?code=x&state=y')->assertRedirect(GoogleController::app('/'));

        $user = User::sole();
        $this->assertSame('new@example.com', $user->email);
        $this->assertSame('g-1', $user->google_id);
        $this->assertNull($user->password);
        $this->assertNotNull($user->email_verified_at);
        $this->getJson('/api/session')
            ->assertJsonPath('user.email', 'new@example.com')
            ->assertJsonPath('user.hasPassword', false)
            ->assertJsonPath('user.google', true);
    }

    public function test_a_verified_address_is_linked_to_the_existing_account(): void
    {
        $existing = User::factory()->create(['email' => 'me@example.com', 'password' => 'my password']);
        $this->google('g-2', 'me@example.com');

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/'));

        $this->assertSame(1, User::count());
        $this->assertSame('g-2', $existing->fresh()->google_id);
        $this->getJson('/api/session')->assertJsonPath('user.hasPassword', true);
    }

    public function test_an_unverified_address_never_takes_over_an_account(): void
    {
        $existing = User::factory()->create(['email' => 'me@example.com']);
        $this->google('g-3', 'me@example.com', verified: false);

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/signin/google-unverified'));

        $this->assertNull($existing->fresh()->google_id);
        $this->getJson('/api/session')->assertJsonPath('user', null);
    }

    public function test_signing_in_again_finds_the_account_by_google_id(): void
    {
        User::factory()->create(['email' => 'old@example.com', 'google_id' => 'g-4']);
        // The Google address changed since; the account is still theirs.
        $this->google('g-4', 'renamed@example.com');

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/'));

        $this->assertSame(1, User::count());
        $this->getJson('/api/session')->assertJsonPath('user.email', 'old@example.com');
    }

    public function test_cancelling_or_a_failure_goes_back_to_sign_in(): void
    {
        $this->get('/auth/google/callback?error=access_denied')->assertRedirect(GoogleController::app('/signin/google-cancelled'));

        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andThrow(new RuntimeException('Invalid state'));
        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/signin/google-failed'));
    }

    public function test_a_google_only_account_is_told_to_use_google_when_trying_a_password(): void
    {
        User::factory()->create(['email' => 'g@example.com', 'password' => null, 'google_id' => 'g-5']);

        $this->postJson('/api/login', ['email' => 'g@example.com', 'password' => 'anything'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'This account signs in with Google. Use "Continue with Google", or set a password with "Forgot your password?".');
    }

    public function test_a_google_only_account_is_deleted_by_typing_its_address(): void
    {
        $user = User::factory()->create(['email' => 'g@example.com', 'password' => null, 'google_id' => 'g-6']);

        $this->actingAs($user)->deleteJson('/api/user', ['confirm' => 'someone@else.com'])->assertJsonValidationErrors('confirm');
        $this->actingAs($user)->deleteJson('/api/user', ['confirm' => ' G@Example.com '])->assertNoContent();

        $this->assertSame(0, User::count());
    }
}
