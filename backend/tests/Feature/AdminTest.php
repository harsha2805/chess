<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AdminSecrets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Events\MessageSent;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['chessdebrief.admin_emails' => ['boss@example.com']]);
    }

    private function admin(): User
    {
        return User::factory()->create(['email' => 'boss@example.com', 'email_verified_at' => now()]);
    }

    public function test_only_verified_listed_addresses_are_admins(): void
    {
        $this->actingAs(User::factory()->create())->getJson('/api/admin/status')->assertForbidden();
    }

    public function test_a_listed_address_that_is_not_verified_is_not_an_admin(): void
    {
        // Sign-up does not check addresses: anyone could register the admin's.
        $squatter = User::factory()->create(['email' => 'boss@example.com', 'email_verified_at' => null]);

        $this->actingAs($squatter)->getJson('/api/admin/status')->assertForbidden();
        $this->actingAs($squatter)->postJson('/api/admin/run', ['action' => 'migrate'])->assertForbidden();
    }

    public function test_signed_out_is_refused(): void
    {
        $this->getJson('/api/admin/status')->assertUnauthorized();
    }

    public function test_the_session_tells_the_app_who_is_an_admin(): void
    {
        $this->actingAs($this->admin())->getJson('/api/session')->assertJsonPath('user.isAdmin', true);
    }

    public function test_status_lists_checks_and_numbers(): void
    {
        $this->actingAs($this->admin())->getJson('/api/admin/status')
            ->assertOk()
            ->assertJsonPath('stats.people', 1)
            ->assertJsonPath('stats.admins', 1)
            ->assertJsonStructure(['checks' => [['label', 'ok', 'detail']], 'stats' => ['games', 'reviewed', 'chessAccounts', 'lastFetch']]);
    }

    public function test_only_listed_commands_run(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/admin/run', ['action' => 'down'])->assertJsonValidationErrors('action');
        $this->actingAs($admin)->postJson('/api/admin/run', ['action' => 'migrate_status'])
            ->assertOk()
            ->assertJsonPath('output', fn (string $out) => str_contains($out, 'php artisan migrate:status') && str_contains($out, 'create_games_table'));
        $this->actingAs($admin)->postJson('/api/admin/run', ['action' => 'log'])->assertOk();
    }

    public function test_the_test_email_goes_to_the_report_address(): void
    {
        config(['chessdebrief.report.to' => 'dev@example.com']);
        Event::fake([MessageSent::class]);

        $this->actingAs($this->admin())->postJson('/api/admin/run', ['action' => 'mail'])
            ->assertJsonPath('output', fn (string $out) => str_starts_with($out, 'Sent to dev@example.com'));
        Event::assertDispatched(MessageSent::class, fn (MessageSent $e) => $e->message->getTo()[0]->getAddress() === 'dev@example.com');
    }

    public function test_a_new_cron_token_works_for_the_cron_route_once_made(): void
    {
        config(['chessdebrief.cron_token' => '']);
        $this->get('/cron?token=anything')->assertForbidden();

        $made = $this->actingAs($this->admin())->postJson('/api/admin/cron-token')->assertOk()->json();
        $this->assertStringEndsWith('/cron?token='.$made['token'], $made['url']);

        $this->get('/cron?token='.$made['token'])->assertOk()->assertSee('Checked 0 accounts');
        $this->assertNotNull(AdminSecrets::get('cron_last_run'));
        $this->get('/cron?token=wrong')->assertForbidden();
    }

    public function test_the_cron_route_sets_no_cookies(): void
    {
        config(['chessdebrief.cron_token' => 'env-cron-token-12345']);

        $this->get('/cron?token=env-cron-token-12345')->assertOk()->assertCookieMissing(config('session.cookie'));
    }

    public function test_setup_only_answers_before_the_first_migration(): void
    {
        config(['chessdebrief.setup_password' => 'setup-password-12345']);
        $this->get('/setup')->assertNotFound();

        Schema::drop('migrations');
        $this->get('/setup')->assertOk()->assertSee('Set up ChessDebrief');
        $this->post('/setup', ['password' => 'wrong'])->assertForbidden();

        config(['chessdebrief.setup_password' => '']);
        $this->get('/setup')->assertNotFound();
    }
}
