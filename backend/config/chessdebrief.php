<?php

return [

    /*
    | Sent to chess.com and Lichess in the User-Agent of every request, as both ask.
    */
    'contact' => env('CHESSDEBRIEF_CONTACT', ''),

    /*
    | How often each linked chess account is checked for new games, in hours.
    | The scheduler runs every 15 minutes and checks the accounts that are due.
    */
    'fetch_every_hours' => (float) env('CHESSDEBRIEF_FETCH_EVERY_HOURS', 2),

    /*
    | Accounts of people who have not opened the site for this many days are not checked.
    */
    'active_days' => (int) env('CHESSDEBRIEF_ACTIVE_DAYS', 30),

    /*
    | How many chess accounts one person can have checked.
    */
    'max_accounts' => 5,

    /*
    | Where the "Support ChessDebrief" link goes: a page at Buy Me a Coffee, Ko-fi, GitHub
    | Sponsors, Razorpay, PayPal or similar. The link is hidden while this is empty.
    */
    'donate_url' => env('CHESSDEBRIEF_DONATE_URL', ''),

    /*
    | Who may open the admin page (#/admin in the app): accounts with one of these email
    | addresses (comma separated) whose address is verified, by signing in with Google or by a
    | password reset. Sign-up does not check addresses, so an unverified one never counts.
    */
    'admin_emails' => array_values(array_filter(array_map(
        fn (string $email) => strtolower(trim($email)),
        explode(',', (string) env('CHESSDEBRIEF_ADMIN_EMAILS', '')),
    ))),

    /*
    | Only for a brand-new server: /setup runs the first migrations with this password (16+
    | characters), since nobody can sign in before the tables exist. /setup switches itself off
    | for good once they do.
    */
    'setup_password' => env('CHESSDEBRIEF_SETUP_PASSWORD', ''),

    /*
    | Web cron: opening /cron?token=<token> checks the chess accounts that are due, for hosts
    | whose cron jobs cannot run PHP. A token made on the admin page is stored hashed in the
    | database and replaces this one. Off while neither is set; at least 16 characters.
    */
    'cron_token' => env('CHESSDEBRIEF_CRON_TOKEN', ''),

    /*
    | Bug reports from the site's form. They are sent with the mailer set by MAIL_* in .env,
    | the same one that sends password reset emails.
    |
    | to:       where reports are delivered. Reports are refused while this is empty.
    | from:     the sender. Use an address on the site's own domain so mail is not rejected.
    |           Defaults to MAIL_FROM_ADDRESS.
    | per_hour: reports one visitor can send in an hour.
    | per_day:  reports everyone together can send in a day.
    */
    'report' => [
        'to' => env('CHESSDEBRIEF_REPORT_TO', ''),
        'from' => env('CHESSDEBRIEF_REPORT_FROM') ?: env('MAIL_FROM_ADDRESS'),
        'per_hour' => (int) env('CHESSDEBRIEF_REPORT_PER_HOUR', 5),
        'per_day' => (int) env('CHESSDEBRIEF_REPORT_PER_DAY', 200),
    ],

];
