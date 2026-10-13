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
    private function google(string $id, string $email, mixed $verified = true): void
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
        $this->get('/auth/google/redirect')->assertRedirectContains('accounts.google.com')->assertSessionMissing('google_link_user');
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

    public function test_an_existing_account_is_never_joined_to_google_automatically(): void
    {
        // Possibly made by an impostor with someone else's address: joining it would let them in.
        $existing = User::factory()->create(['email' => 'me@example.com', 'password' => 'my password']);
        $this->google('g-2', 'me@example.com');

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/signin/google-exists'));

        $this->assertNull($existing->fresh()->google_id);
        $this->assertSame(1, User::count());
        $this->getJson('/api/session')->assertJsonPath('user', null);
    }

    public function test_an_unverified_google_address_is_refused(): void
    {
        $this->google('g-3', 'someone@example.com', verified: false);

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/signin/google-unverified'));

        $this->assertSame(0, User::count());
    }

    public function test_the_verified_flag_is_read_strictly(): void
    {
        // A cast to bool would read the string "false" as true.
        $this->google('g-3b', 'someone@example.com', verified: 'false');

        $this->get('/auth/google/callback?code=x')->assertRedirect(GoogleController::app('/signin/google-unverified'));
        $this->assertSame(0, User::count());
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

    public function test_connect_google_from_the_account_page(): void
    {
        $user = User::factory()->create(['email' => 'me@example.com', 'password' => 'my password']);

        // Pressing "Connect Google" while signed in marks the round trip as connecting.
        $this->actingAs($user)->get('/auth/google/redirect')->assertSessionHas('google_link_user', $user->id);

        // The Google account may use another address: both are proven to be theirs.
        $this->google('g-5', 'other@gmail.com');
        $this->actingAs($user)->withSession(['google_link_user' => $user->id])
            ->get('/auth/google/callback?code=x')
            ->assertRedirect(GoogleController::app('/account/google-connected'));

        $this->assertSame('g-5', $user->fresh()->google_id);
        $this->assertSame('me@example.com', $user->fresh()->email);
    }

    public function test_a_google_account_already_used_elsewhere_is_not_connected(): void
    {
        User::factory()->create(['google_id' => 'g-6']);
        $user = User::factory()->create(['password' => 'my password']);
        $this->google('g-6', 'shared@gmail.com');

        $this->actingAs($user)->withSession(['google_link_user' => $user->id])
            ->get('/auth/google/callback?code=x')
            ->assertRedirect(GoogleController::app('/account/google-taken'));

        $this->assertNull($user->fresh()->google_id);
    }

    public function test_connecting_needs_the_same_person_still_signed_in(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $this->google('g-7', 'x@gmail.com');

        $this->actingAs($other)->withSession(['google_link_user' => $user->id])
            ->get('/auth/google/callback?code=x')
            ->assertRedirect(GoogleController::app('/signin/google-failed'));

        $this->assertNull($user->fresh()->google_id);
        $this->assertNull($other->fresh()->google_id);
    }

    public function test_disconnecting_google_with_a_password_to_fall_back_on(): void
    {
        $withPassword = User::factory()->create(['google_id' => 'g-8', 'password' => 'my password']);
        $this->actingAs($withPassword)->deleteJson('/api/user/google')->assertOk()->assertJsonPath('user.google', false);
        $this->assertNull($withPassword->fresh()->google_id);
    }

    public function test_disconnecting_google_is_refused_without_a_password(): void
    {
        $googleOnly = User::factory()->create(['google_id' => 'g-9', 'password' => null]);
        $this->actingAs($googleOnly)->deleteJson('/api/user/google')->assertJsonValidationErrors('google');
        $this->assertSame('g-9', $googleOnly->fresh()->google_id);
    }

    public function test_a_google_only_account_is_told_to_use_google_when_trying_a_password(): void
    {
        User::factory()->create(['email' => 'g@example.com', 'password' => null, 'google_id' => 'g-10']);

        $this->postJson('/api/login', ['email' => 'g@example.com', 'password' => 'anything'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'This account signs in with Google. Use "Continue with Google", or set a password with "Forgot your password?".');
    }

    public function test_a_google_only_account_is_deleted_by_typing_its_address(): void
    {
        $user = User::factory()->create(['email' => 'g@example.com', 'password' => null, 'google_id' => 'g-11']);

        $this->actingAs($user)->deleteJson('/api/user', ['confirm' => 'someone@else.com'])->assertJsonValidationErrors('confirm');
        $this->actingAs($user)->deleteJson('/api/user', ['confirm' => ' G@Example.com '])->assertNoContent();

        $this->assertSame(0, User::count());
    }
}
