import { useState, type FormEvent } from 'react';
import { FETCH_EVERY_HOURS } from '../config';
import {
  checkForGames,
  deleteAccount,
  linkAccount,
  register,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
  unlinkAccount,
  useAccount,
  type ChessAccount,
} from '../lib/account';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { agoLabel } from './format';
import { href, navigate } from './router';

const PLATFORM_NAME = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;

/** Form state shared by the account forms: busy flag, the message for the whole form, one per field. */
function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) setFields(e.fields);
      else setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, run };
}

function FieldError({ text, id }: { text?: string; id: string }) {
  return text ? (
    <small className="field-error" id={id}>
      {text}
    </small>
  ) : null;
}

function Unavailable() {
  return (
    <article className="prose">
      <h1>Accounts</h1>
      <p>Accounts are not available on this copy of the site. Your games are saved in this browser.</p>
      <p>
        <a href={href()}>Back to your games</a>
      </p>
    </article>
  );
}

/** Shown on account pages until the server has said who is signed in. */
function useReady(): 'wait' | 'unavailable' | 'ok' {
  const status = useAccount((s) => s.status);
  if (status === 'checking') return 'wait';
  if (status === 'unavailable') return 'unavailable';
  return 'ok';
}

/** Sign in, or create an account. */
export function SignIn({ create = false }: { create?: boolean }) {
  const ready = useReady();
  const status = useAccount((s) => s.status);
  const localGames = useStore((s) => s.games.length);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, fields, run } = useForm();

  if (ready === 'wait') return <p className="muted">Checking your account…</p>;
  if (ready === 'unavailable') return <Unavailable />;
  if (status === 'signed-in') return <AccountPage />;

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await (create ? register : signIn)(email.trim(), password);
      navigate();
    });
  }

  return (
    <article className="prose">
      <h1>{create ? 'Create an account' : 'Sign in'}</h1>
      <p>
        An account keeps your games and reviews on every device, and brings in new games from your chess.com or Lichess account every{' '}
        {FETCH_EVERY_HOURS} hours. Reviews still run here in your browser.
      </p>
      {localGames > 0 && (
        <p>
          The {localGames} {localGames === 1 ? 'game' : 'games'} in this browser will be saved to the account.
        </p>
      )}

      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete={create ? 'email' : 'username'}
            inputMode="email"
            required
            aria-invalid={fields.email ? true : undefined}
            aria-describedby={fields.email ? 'email-error' : undefined}
          />
          <FieldError text={fields.email} id="email-error" />
        </label>
        <label className="field">
          <span>
            Password {create && <span className="muted" style={{ fontWeight: 400 }}>(at least 8 characters)</span>}
          </span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={create ? 'new-password' : 'current-password'}
            minLength={create ? 8 : undefined}
            required
            aria-invalid={fields.password ? true : undefined}
            aria-describedby={fields.password ? 'password-error' : undefined}
          />
          <FieldError text={fields.password} id="password-error" />
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? (create ? 'Creating…' : 'Signing in…') : create ? 'Create account' : 'Sign in'}
          </button>
          {create ? (
            <a className="linklike" href={href('signin')}>
              I have an account
            </a>
          ) : (
            <>
              <a className="linklike" href={href('signup')}>
                Create an account
              </a>
              <a className="linklike" href={href('forgot')}>
                Forgot your password?
              </a>
            </>
          )}
        </div>
      </form>
    </article>
  );
}

export function Forgot() {
  const ready = useReady();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const { busy, error, fields, run } = useForm();
  if (ready === 'wait') return <p className="muted">Checking your account…</p>;
  if (ready === 'unavailable') return <Unavailable />;

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => setSent(await requestPasswordReset(email.trim())));
  }

  return (
    <article className="prose">
      <h1>Set a new password</h1>
      {sent ? (
        <>
          <p>{sent} The link works for an hour.</p>
          <p>
            <a href={href('signin')}>Back to sign in</a>
          </p>
        </>
      ) : (
        <>
          <p>Enter the email address of your account. A link to set a new password will be sent to it.</p>
          <form className="form" onSubmit={submit} noValidate>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                required
                aria-invalid={fields.email ? true : undefined}
                aria-describedby={fields.email ? 'email-error' : undefined}
              />
              <FieldError text={fields.email} id="email-error" />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send the link'}
              </button>
              <a className="linklike" href={href('signin')}>
                Back to sign in
              </a>
            </div>
          </form>
        </>
      )}
    </article>
  );
}

/** Opened from the link in the reset email: #/reset/<token>/<email>. */
export function Reset({ token, email }: { token: string; email: string }) {
  const ready = useReady();
  const [password, setPassword] = useState('');
  const { busy, error, fields, run } = useForm();
  if (ready === 'wait') return <p className="muted">Checking your account…</p>;
  if (ready === 'unavailable') return <Unavailable />;

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await resetPassword(token, email, password);
      navigate();
    });
  }

  const linkProblem = fields.token ?? fields.email;
  return (
    <article className="prose">
      <h1>Set a new password</h1>
      <p>For {email}. You will be signed in afterwards, and signed out everywhere else.</p>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>
            New password <span className="muted" style={{ fontWeight: 400 }}>(at least 8 characters)</span>
          </span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            aria-invalid={fields.password ? true : undefined}
            aria-describedby={fields.password ? 'password-error' : undefined}
          />
          <FieldError text={fields.password} id="password-error" />
        </label>
        {(error || linkProblem) && (
          <p className="notice error" role="alert">
            {linkProblem ?? error}{' '}
            {linkProblem && (
              <a className="linklike" href={href('forgot')}>
                Ask for a new link
              </a>
            )}
          </p>
        )}
        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save the new password'}
          </button>
        </div>
      </form>
    </article>
  );
}

function AccountRow({ account }: { account: ChessAccount }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="linked">
      <span className="linked-name">
        <b>{account.username}</b> <span className="muted">on {PLATFORM_NAME[account.platform]}</span>
      </span>
      <span className="linked-state">
        {account.lastError ? (
          <span className="error-text">{account.lastError}</span>
        ) : account.lastFetchedAt ? (
          `Checked ${agoLabel(account.lastFetchedAt)}`
        ) : (
          'Not checked yet'
        )}
      </span>
      <button
        className="linklike"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          unlinkAccount(account.id).catch(() => setBusy(false));
        }}
      >
        Stop checking
      </button>
    </li>
  );
}

export function AccountPage() {
  const ready = useReady();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const accounts = useAccount((s) => s.accounts);
  const checking = useAccount((s) => s.checking);
  const syncing = useAccount((s) => s.syncing);
  const syncError = useAccount((s) => s.syncError);
  const lastAdded = useAccount((s) => s.lastAdded);
  const settings = useStore((s) => s.settings);
  const games = useStore((s) => s.games.length);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [linkError, setLinkError] = useState('');
  const del = useForm();

  if (ready === 'wait') return <p className="muted">Checking your account…</p>;
  if (ready === 'unavailable') return <Unavailable />;
  if (status !== 'signed-in' || !user) return <SignIn />;

  // The account last used to get games, offered when it is not checked yet.
  const suggested =
    settings.username && !accounts.some((a) => a.platform === settings.platform && a.username === settings.username.toLowerCase())
      ? { platform: settings.platform, username: settings.username }
      : null;

  return (
    <article className="prose">
      <h1>Your account</h1>
      <p>
        Signed in as <b>{user.email}</b>. {games} {games === 1 ? 'game is' : 'games are'} saved to it
        {syncing ? ', saving changes now' : ''}.
      </p>
      {syncError && (
        <p className="notice error" role="alert">
          {syncError}
        </p>
      )}

      <h2>New games</h2>
      <p>
        These accounts are checked every {FETCH_EVERY_HOURS} hours, and when you press Check now. New games appear in your list, ready to review.
      </p>
      {accounts.length > 0 ? (
        <ul className="linked-list">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </ul>
      ) : (
        <p className="muted">
          None yet. When you get games by username on the <a href={href()}>Games</a> page, that account is checked from then on.
        </p>
      )}
      {suggested && (
        <p>
          <button
            className="linklike"
            type="button"
            onClick={() => void linkAccount(suggested.platform, suggested.username).then((e) => setLinkError(e ?? ''))}
          >
            Check {suggested.username} on {PLATFORM_NAME[suggested.platform]} too
          </button>
        </p>
      )}
      {linkError && (
        <p className="notice error" role="alert">
          {linkError}
        </p>
      )}
      {accounts.length > 0 && (
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="btn quiet" type="button" disabled={checking} onClick={() => void checkForGames(true)}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
          {lastAdded !== null && !checking && (
            <span className="muted" role="status">
              {lastAdded === 0 ? 'No new games.' : `${lastAdded} new ${lastAdded === 1 ? 'game' : 'games'}.`}
            </span>
          )}
        </div>
      )}

      <h2>Sign out</h2>
      <p>Signing out removes the games from this browser. They stay in your account.</p>
      <div className="form-actions">
        <button
          className="btn quiet"
          type="button"
          onClick={() => {
            void signOut().then(() => navigate());
          }}
        >
          Sign out
        </button>
      </div>

      <h2>Delete the account</h2>
      <p>This deletes your account and the games and reviews saved to it. The games in this browser stay here.</p>
      {confirmDelete ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void del.run(async () => {
              await deleteAccount(password);
              navigate();
            });
          }}
          noValidate
        >
          <label className="field">
            <span>Your password, to confirm</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              aria-invalid={del.fields.password ? true : undefined}
              aria-describedby={del.fields.password ? 'delete-error' : undefined}
            />
            <FieldError text={del.fields.password} id="delete-error" />
          </label>
          {del.error && (
            <p className="notice error" role="alert">
              {del.error}
            </p>
          )}
          <div className="form-actions">
            <button className="btn danger" type="submit" disabled={del.busy}>
              {del.busy ? 'Deleting…' : 'Delete my account'}
            </button>
            <button className="btn quiet" type="button" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <button className="btn quiet" type="button" onClick={() => setConfirmDelete(true)}>
            Delete the account
          </button>
        </div>
      )}
    </article>
  );
}
