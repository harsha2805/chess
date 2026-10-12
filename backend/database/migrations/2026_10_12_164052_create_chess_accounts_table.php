<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Chess accounts whose new games are fetched every few hours.
     */
    public function up(): void
    {
        Schema::create('chess_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('platform', 10);
            // Lower case.
            $table->string('username', 30);
            // Games that ended before this (ms since 1970) were already brought in, or deliberately left out.
            $table->unsignedBigInteger('watermark_ms');
            $table->timestamp('last_fetched_at')->nullable()->index();
            $table->string('last_error')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'platform', 'username']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chess_accounts');
    }
};
