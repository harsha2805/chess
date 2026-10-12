<?php

namespace Tests\Feature;

use Illuminate\Mail\Events\MessageSent;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class ReportTest extends TestCase
{
    private function report(array $extra = [])
    {
        return $this->postJson('/api/report', $extra + ['message' => 'The blunder on move 12 looks wrong.', 'details' => 'ChessDebrief 1.0.0']);
    }

    public function test_reports_are_refused_until_a_recipient_is_set(): void
    {
        config(['chessdebrief.report.to' => '']);

        $this->report()->assertStatus(503)->assertJsonPath('ok', false);
    }

    public function test_a_report_is_emailed_with_the_reply_address(): void
    {
        config(['chessdebrief.report.to' => 'dev@example.com', 'chessdebrief.report.from' => 'no-reply@example.com']);
        Event::fake([MessageSent::class]);

        $this->report(['email' => 'player@example.com'])->assertOk()->assertJsonPath('ok', true);

        Event::assertDispatched(MessageSent::class, function (MessageSent $event) {
            $mail = $event->message;

            return $mail->getTo()[0]->getAddress() === 'dev@example.com'
                && $mail->getFrom()[0]->getAddress() === 'no-reply@example.com'
                && $mail->getReplyTo()[0]->getAddress() === 'player@example.com'
                && str_contains($mail->getSubject(), 'The blunder on move 12')
                && str_contains($mail->getTextBody(), 'Reply to: player@example.com');
        });
    }

    public function test_bots_filling_the_hidden_field_are_told_it_worked(): void
    {
        config(['chessdebrief.report.to' => 'dev@example.com']);
        Event::fake([MessageSent::class]);

        $this->report(['website' => 'spam'])->assertOk();

        Event::assertNotDispatched(MessageSent::class);
    }

    public function test_short_reports_and_bad_addresses_are_refused(): void
    {
        config(['chessdebrief.report.to' => 'dev@example.com']);

        $this->report(['message' => 'bad'])->assertJsonPath('errors.message.0', 'Describe what happened in a sentence or two.');
        $this->report(['email' => 'not an address'])->assertJsonValidationErrors('email');
    }

    public function test_reports_are_limited_per_visitor(): void
    {
        config(['chessdebrief.report.to' => 'dev@example.com', 'chessdebrief.report.per_hour' => 2]);

        $this->report()->assertOk();
        $this->report()->assertOk();
        $this->report()->assertStatus(429)->assertJsonPath('error', 'That is a lot of reports in a short time. Try again in an hour.');
    }
}
