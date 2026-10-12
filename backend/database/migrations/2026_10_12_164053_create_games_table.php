<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One row per game per person. A removed game keeps its row with `deleted` set, so the
     * scheduled fetch does not bring it back. Times are milliseconds since 1970, as in the app.
     */
    public function up(): void
    {
        Schema::create('games', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // The app's game id, e.g. "chesscom:<uuid>" or "lichess:<id>". Case matters: Lichess ids differ only by case.
            $gameId = $table->string('game_id', 120);
            if (in_array(Schema::getConnection()->getDriverName(), ['mysql', 'mariadb'], true)) {
                $gameId->charset('ascii')->collation('ascii_bin');
            }
            $table->string('source', 10);
            $table->string('account', 40)->nullable();
            $table->unsignedBigInteger('played_ms')->default(0);
            $table->unsignedBigInteger('added_ms')->default(0);
            // The game as the app stores it (JSON text), when the app sent it.
            $table->longText('record')->nullable();
            // The game as chess.com or Lichess sent it (JSON text), when the server fetched it.
            // The app turns it into a record itself, so the import rules live in one place.
            $table->longText('raw')->nullable();
            $table->longText('review')->nullable();
            // When the stored review was made, to keep the newer of two.
            $table->unsignedBigInteger('review_ms')->nullable();
            $table->boolean('deleted')->default(false);
            // Changes are pulled in (updated_ms, id) order.
            $table->unsignedBigInteger('updated_ms');
            // The browser that made the last change, so it is not sent back what it already has.
            $table->string('origin', 16)->nullable();

            $table->unique(['user_id', 'game_id']);
            $table->index(['user_id', 'updated_ms', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('games');
    }
};
