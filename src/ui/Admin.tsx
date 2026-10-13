import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../lib/account';
import { ApiError, api } from '../lib/api';
import { agoLabel } from './format';
import { href } from './router';

// The admin page (#/admin/<section>), for hosts without a command line. The server decides who
// may see it (CHESSDEBRIEF_ADMIN_EMAILS, verified addresses) and runs only a fixed set of commands.

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

interface Status {
  checks: Check[];
  stats: { people: number; google: number; admins: number; chessAccounts: number; games: number; reviewed: number; lastFetch: string | null };
}

type Action = 'migrate' | 'migrate_status' | 'optimize' | 'clear' | 'fetch' | 'fetch_all' | 'mail' | 'log';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'update', label: 'Update' },
  { id: 'games', label: 'Games' },
  { id: 'email', label: 'Email' },
  { id: 'logs', label: 'Logs' },
  { id: 'cron', label: 'Cron' },
] as const;

type Section = (typeof SECTIONS)[number]['id'];

const ACTIONS: Record<Section, { action: Action; label: string; hint: string }[]> = {
  overview: [],
  update: [
    { action: 'migrate', label: 'Run migrations', hint: 'Creates or updates the database tables. Run after every upload.' },
    { action: 'clear', label: 'Clear caches', hint: 'Run after editing .env, or when something looks stale.' },
    { action: 'optimize', label: 'Cache config and routes', hint: 'Faster pages. After this, edits to .env need "Clear caches".' },
    { action: 'migrate_status', label: 'Migration status', hint: 'Which migrations have run.' },
  ],
  games: [
    { action: 'fetch', label: 'Fetch due games now', hint: 'What the cron does every 15 minutes: accounts not checked for 2 hours.' },
    { action: 'fetch_all', label: 'Fetch all accounts now', hint: 'Every linked account of an active person, due or not.' },
  ],
  email: [{ action: 'mail', label: 'Send a test email', hint: 'To CHESSDEBRIEF_REPORT_TO, with the MAIL_* settings from .env.' }],
  logs: [{ action: 'log', label: 'Show recent errors', hint: 'The end of storage/logs/laravel.log.' }],
  cron: [],
};

const INTRO: Record<Section, string> = {
  overview: 'How the server is doing. Anything marked needs attention.',
  update: 'After uploading a new zip: Run migrations, then Clear caches, then Cache config and routes.',
  games: 'New games from linked chess.com and Lichess accounts. The cron does this by itself every 15 minutes.',
  email: 'Password reset emails and bug reports use the mail settings in .env.',
  logs: 'Errors the server has logged, newest at the end.',
  cron: 'The address your host’s cron job opens every 15 minutes to fetch new games.',
};

/** A UTC time from the server, "2026-10-13 06:00:00", in milliseconds. */
const utc = (time: string) => Date.parse(`${time.replace(' ', 'T')}Z`);

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  };
  return [copied, copy] as const;
}

export function Admin({ section: raw }: { section?: string }) {
  const status = useAccount((s) => s.status);
  const isAdmin = useAccount((s) => s.user?.isAdmin ?? false);
  const section: Section = SECTIONS.some((s) => s.id === raw) ? (raw as Section) : 'overview';
  const [data, setData] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState<Action | null>(null);
  const [outputs, setOutputs] = useState<Partial<Record<Section, string>>>({});
  const [cron, setCron] = useState<{ token: string; url: string } | null>(null);
  const [cronBusy, setCronBusy] = useState(false);
  const [copied, copy] = useCopy();

  const load = useCallback(async () => {
    try {
      setData(await api<Status>('admin/status'));
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'The status could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (status === 'signed-in' && isAdmin) void load();
  }, [status, isAdmin, load]);

  // On phones the sections are a scrolling row of tabs: keep the open one in view.
  useEffect(() => {
    // Only the row scrolls (scrollIntoView would nudge the whole page sideways too).
    const nav = document.querySelector<HTMLElement>('.admin-nav');
    const open = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (nav && open && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = open.offsetLeft - (nav.clientWidth - open.offsetWidth) / 2;
  }, [section, isAdmin]);

  if (status === 'checking') return <p className="muted">Checking your account…</p>;
  if (status !== 'signed-in' || !isAdmin) {
    return (
      <article className="prose">
        <h1>Admin</h1>
        <p>This page is for the site’s admins. {status === 'signed-in' ? 'Your account is not one of them.' : <a href={href('signin')}>Sign in</a>}</p>
      </article>
    );
  }

  async function run(action: Action) {
    setRunning(action);
    try {
      const { output } = await api<{ output: string }>('admin/run', { method: 'POST', body: { action } });
      setOutputs((o) => ({ ...o, [section]: output }));
    } catch (e) {
      setOutputs((o) => ({ ...o, [section]: e instanceof ApiError ? e.message : 'The command could not be run.' }));
    } finally {
      setRunning(null);
      void load();
    }
  }

  async function newCron() {
    if (!window.confirm('Make a new cron address? The current one stops working until you paste the new one into your cron job.')) return;
    setCronBusy(true);
    try {
      setCron(await api<{ token: string; url: string }>('admin/cron-token', { method: 'POST' }));
      void load();
    } catch (e) {
      setOutputs((o) => ({ ...o, cron: e instanceof ApiError ? e.message : 'No new address was made.' }));
    } finally {
      setCronBusy(false);
    }
  }

  const problems = data?.checks.filter((c) => !c.ok).length ?? 0;
  const cronCheck = data?.checks.find((c) => c.label === 'Web cron');
  const mailCheck = data?.checks.find((c) => c.label === 'Mail');
  const wget = cron ? `wget -q -O /dev/null "${cron.url}"` : '';

  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin sections">
        <p className="admin-title">Admin</p>
        {SECTIONS.map((s) => (
          <a key={s.id} href={href('admin', s.id)} aria-current={section === s.id ? 'page' : undefined}>
            {s.label}
            {s.id === 'overview' && problems > 0 && (
              <span className="admin-badge" aria-label={`${problems} to look at`}>
                {problems}
              </span>
            )}
          </a>
        ))}
      </nav>

      <section className="admin-panel" aria-labelledby="admin-heading">
        <div className="admin-head">
          <h1 id="admin-heading">{SECTIONS.find((s) => s.id === section)!.label}</h1>
          <button className="btn quiet small" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <p className="admin-intro">{INTRO[section]}</p>
        {loadError && (
          <p className="notice error" role="alert">
            {loadError}
          </p>
        )}

        {section === 'overview' && data && (
          <>
            <div className="admin-stats">
              <Stat label="People" value={data.stats.people} sub={`${data.stats.google} with Google`} />
              <Stat label="Chess accounts" value={data.stats.chessAccounts} sub={data.stats.lastFetch ? `checked ${agoLabel(utc(data.stats.lastFetch))}` : 'not checked yet'} />
              <Stat label="Games" value={data.stats.games} sub={`${data.stats.reviewed} reviewed`} />
              <Stat label="Health" value={problems === 0 ? 'Fine' : `${problems} to fix`} sub={`${data.checks.length} checks`} warn={problems > 0} />
            </div>
            <table className="admin-checks">
              <tbody>
                {data.checks.map((c) => (
                  <tr key={c.label}>
                    <th scope="row">
                      <span className={c.ok ? 'ok' : 'bad'} aria-hidden="true">
                        {c.ok ? '✓' : '✗'}
                      </span>{' '}
                      {c.label}
                      <span className="visually-hidden">{c.ok ? ' (fine)' : ' (needs attention)'}</span>
                    </th>
                    <td>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {section === 'overview' && !data && !loadError && <p className="muted">Loading…</p>}

        {section === 'email' && mailCheck && <p className="admin-intro">Now: {mailCheck.detail}.</p>}

        {ACTIONS[section].length > 0 && (
          <div className="admin-actions">
            {ACTIONS[section].map((a) => (
              <div className="admin-action" key={a.action}>
                <button className="btn" type="button" disabled={running !== null} onClick={() => void run(a.action)}>
                  {running === a.action ? 'Running…' : a.label}
                </button>
                <small>{a.hint}</small>
              </div>
            ))}
          </div>
        )}

        {section === 'cron' && (
          <>
            {cronCheck && <p className="admin-intro">Now: {cronCheck.detail}.</p>}
            {cron ? (
              <div className="admin-cron">
                <p className="notice" role="status">
                  New address made. Copy it into your cron job now: it is stored hashed and will not be shown again. The previous address has stopped working.
                </p>
                <label className="field">
                  <span>Cron job command (every 15 minutes: minute 0,15,30,45)</span>
                  <div className="admin-copy">
                    <code>{wget}</code>
                    <button className="btn quiet small" type="button" onClick={() => void copy(wget)}>
                      {copied === wget ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>Or just the address (for a service such as cron-job.org)</span>
                  <div className="admin-copy">
                    <code>{cron.url}</code>
                    <button className="btn quiet small" type="button" onClick={() => void copy(cron.url)}>
                      {copied === cron.url ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </label>
              </div>
            ) : (
              <p>The address is stored hashed, so it cannot be shown again. If you lost it, or it may have leaked, make a new one.</p>
            )}
            <div className="admin-actions">
              <div className="admin-action">
                <button className="btn" type="button" disabled={cronBusy} onClick={() => void newCron()}>
                  {cronBusy ? 'Making…' : 'Make a new cron address'}
                </button>
                <small>The current address stops working, so update the cron job straight away.</small>
              </div>
            </div>
          </>
        )}

        {outputs[section] && (
          <div className="admin-output">
            <div className="admin-output-head">
              <span>Output</span>
              <button className="linklike" type="button" onClick={() => void copy(outputs[section]!)}>
                {copied === outputs[section] ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre>{outputs[section]}</pre>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, warn = false }: { label: string; value: number | string; sub: string; warn?: boolean }) {
  return (
    <div className={warn ? 'admin-stat warn' : 'admin-stat'}>
      <span>{label}</span>
      <b className="num">{value}</b>
      <small>{sub}</small>
    </div>
  );
}
