<?php
// Copy this file to report-config.php (same folder) and fill it in.
// report-config.php is not part of the repository, so your address stays private.
return [
    // Where bug reports are delivered.
    'to' => 'you@example.com',
    // The sender address. Use an address on the site's own domain so mail is not rejected.
    'from' => 'no-reply@example.com',
    // Limits against abuse.
    'per_hour' => 5,   // per visitor
    'per_day' => 200,  // everyone together
];
