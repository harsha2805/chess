import { useMemo, useState, type FormEvent } from 'react';
import { APP_NAME, APP_VERSION, PREVIEW, REPO_URL, REPORT_ENDPOINT } from '../config';
import { recentErrors } from '../lib/diagnostics';
import { getState, useStore } from '../lib/store';

/** Bug report form. `gameId` and `ply` are set when it is opened from a review. */
export function Report({ gameId, ply }: { gameId?: string; ply?: number }) {
  const game = useStore((s) => (gameId ? s.games.find((g) => g.id === gameId) : undefined));
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [includeGame, setIncludeGame] = useState(true);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState(false);

  const details = useMemo(() => {
    const s = getState();
    const lines = [
      `${APP_NAME} ${APP_VERSION}`,
      `Browser: ${navigator.userAgent}`,
      `Window: ${window.innerWidth} x ${window.innerHeight}, language ${navigator.language}`,
      `Games stored: ${s.games.length}, reviewed: ${s.games.filter((g) => g.review).length}`,
      `Engine: ${s.engine}${s.engineError ? ` (${s.engineError})` : ''}, setting: ${s.settings.depth}`,
    ];
    const errors = recentErrors();
    if (errors.length) lines.push('Recent errors:', ...errors.map((e) => `  ${e}`));
    return lines.join('\n');
  }, []);

  const gameText = game && includeGame ? `Game: ${game.white.name} against ${game.black.name}${ply ? `, at move ${Math.ceil(ply / 2)}` : ''}\n${game.url ?? ''}\n\n${game.pgn}` : '';
  const fullText = `${message.trim()}\n\n---\n${details}${gameText ? `\n\n${gameText}` : ''}`;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) {
      setProblem('Describe what happened in a sentence or two, so the problem can be found.');
      return;
    }
    setProblem('');
    setState('sending');
    try {
      const response = await fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), email: email.trim(), details, game: gameText, website }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) {
        setProblem(body?.error ?? '');
        setState('failed');
        return;
      }
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (state === 'sent') {
    return (
      <article className="prose">
        <h1>Report sent</h1>
        <p>Thank you. It goes straight to the developer{email.trim() ? ', who will reply to the address you gave if there are questions' : ''}.</p>
        <p>
          <a href="#/">Back to your games</a>
        </p>
      </article>
    );
  }

  return (
    <article className="prose">
      <h1>Report a bug</h1>
      <p>Say what you did and what went wrong. If a move was marked in a way that looks wrong, name the move.</p>

      {PREVIEW && (
        <p className="notice" style={{ fontFamily: 'var(--sans)', fontSize: '0.9375rem', marginTop: 14 }}>
          Sending is switched off in this preview. On the live site this form emails the report to the developer.
        </p>
      )}

      <form className="form" onSubmit={send} noValidate>
        <label className="field">
          <span>What happened?</span>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} required aria-invalid={problem && state === 'idle' ? true : undefined} />
        </label>
        <label className="field">
          <span>
            Your email <span className="muted" style={{ fontWeight: 400 }}>(optional, only for a reply)</span>
          </span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
        </label>
        {/* Left empty by people; filled by bots. */}
        <label className="hp" aria-hidden="true">
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        {game && (
          <label className="check">
            <input type="checkbox" checked={includeGame} onChange={(e) => setIncludeGame(e.target.checked)} />
            <span>
              Include the game I was reviewing ({game.white.name} against {game.black.name})
            </span>
          </label>
        )}
        <details>
          <summary>What gets sent with it</summary>
          <pre>{details + (gameText ? `\n\n${gameText}` : '')}</pre>
        </details>

        {state === 'idle' && problem && (
          <p className="notice error" role="alert">
            {problem}
          </p>
        )}
        {state === 'failed' && (
          <div className="notice error" role="alert">
            <strong>The report could not be sent.</strong> {problem || 'The reporting service did not answer.'} You can copy the report and{' '}
            <a href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">
              open an issue on GitHub
            </a>{' '}
            instead.
          </div>
        )}

        <div className="form-actions">
          <button className="btn" type="submit" disabled={state === 'sending' || PREVIEW}>
            {state === 'sending' ? 'Sending…' : 'Send report'}
          </button>
          {state === 'failed' && (
            <button className="btn quiet" type="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy report'}
            </button>
          )}
        </div>
      </form>
    </article>
  );
}
