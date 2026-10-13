<?php

namespace Tests\Feature;

use App\Support\AdminSecrets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminSecretsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['chessdebrief.cron_token' => 'env-cron-token-12345']);
    }

    public function test_a_new_cron_token_is_stored_hashed_and_replaces_the_old_one(): void
    {
        $this->assertSame('env', AdminSecrets::cronSource());
        $this->assertTrue(AdminSecrets::checkCronToken('env-cron-token-12345'));

        $token = AdminSecrets::newCronToken();

        $this->assertSame('database', AdminSecrets::cronSource());
        $this->assertSame(40, strlen($token));
        $this->assertTrue(AdminSecrets::checkCronToken($token));
        $this->assertFalse(AdminSecrets::checkCronToken('env-cron-token-12345'));
        $this->assertSame(hash('sha256', $token), DB::table('settings')->where('key', 'cron_token_hash')->value('value'));
        $this->assertNotSame($token, AdminSecrets::newCronToken());
        $this->assertFalse(AdminSecrets::checkCronToken($token));
    }

    public function test_short_env_tokens_do_not_count(): void
    {
        config(['chessdebrief.cron_token' => 'short']);
        $this->assertSame('none', AdminSecrets::cronSource());
        $this->assertFalse(AdminSecrets::checkCronToken('short'));
    }

    public function test_without_the_settings_table_the_env_token_still_works(): void
    {
        Schema::drop('settings');

        $this->assertSame('env', AdminSecrets::cronSource());
        $this->assertTrue(AdminSecrets::checkCronToken('env-cron-token-12345'));
        $this->assertNull(AdminSecrets::get('cron_last_run'));
    }
}
