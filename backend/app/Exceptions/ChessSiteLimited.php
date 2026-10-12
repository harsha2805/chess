<?php

namespace App\Exceptions;

use RuntimeException;

/** chess.com or Lichess asked for fewer requests (HTTP 429). Asking again at once makes it worse. */
class ChessSiteLimited extends RuntimeException {}
