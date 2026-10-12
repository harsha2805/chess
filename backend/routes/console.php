<?php

use Illuminate\Support\Facades\Schedule;

// New games for linked chess accounts. Each account is checked when its last check is
// CHESSDEBRIEF_FETCH_EVERY_HOURS old (2 by default); running often spreads the work out.
// The server needs one cron entry: * * * * * php /path/to/backend/artisan schedule:run
Schedule::command('games:fetch')->everyFifteenMinutes()->withoutOverlapping(30);

// Password reset links past their date. (Database sessions are cleared by Laravel itself.)
Schedule::command('auth:clear-resets')->daily();
