<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which of a person's browsers is giving a game a Deep review in the background, until when,
     * and how far it has got, so another device leaves that game alone (GameSync::claim).
     */
    public function up(): void
    {
        Schema::table('games', function (Blueprint $table) {
            $table->string('claim_device', 16)->nullable();
            $table->unsignedBigInteger('claim_until_ms')->nullable();
            $table->unsignedTinyInteger('claim_progress')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('games', function (Blueprint $table) {
            $table->dropColumn(['claim_device', 'claim_until_ms', 'claim_progress']);
        });
    }
};
