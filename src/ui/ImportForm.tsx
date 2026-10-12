import { useId, useState, type FormEvent } from 'react';
import { PREVIEW, SAMPLE_PGN } from '../config';
import { ImportError, importAccount, readAccount, recordsFromPgn, type Platform } from '../lib/importers';
import { addGames, updateSettings, useStore } from '../lib/store';
import { navigate } from './router';

const PLATFORM_NAME: Record<Platform, string> = { chesscom: 'Chess.com', lichess: 'Lichess' };

/** Opens the built-in sample game, adding it on first use, at move `ply` when given. */
export async function openSample(ply?: number) {
  const { records } = recordsFromPgn(SAMPLE_PGN, 'sample');
  await addGames(records);
  navigate('game', records[0].id, ...(ply ? [ply] : []));
}

/** Username import and PGN paste. `compact` is the one-row version shown above the game list. */
export function ImportForm({ compact = false }: { compact?: boolean }) {
  const settings = useStore((s) => s.settings);
  const [username, setUsername] = useState(settings.username);
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pasting, setPasting] = useState(PREVIEW);
  const [pgn, setPgn] = useState('');
  const id = useId();
  const platform = settings.platform;

  async function fetchGames(e: FormEvent) {
    e.preventDefault();
    // A pasted profile address works too, and picks the right site by itself.
    const account = readAccount(username, settings.platform);
    const name = account.username;
    const platform = account.platform;
    if (!name) {
      setMessage({ kind: 'error', text: `Enter your ${PLATFORM_NAME[platform]} username.` });
      return;
    }
    if (platform !== settings.platform || name !== username) {
      updateSettings({ platform });
      setUsername(name);
    }
    setBusy(true);
    setMessage(null);
    try {
      const records = await importAccount(platform, name, count);
      if (records.length === 0) {
        setMessage({ kind: 'error', text: `${name} has no standard games on ${PLATFORM_NAME[platform]} from the last year.` });
        return;
      }
      const added = await addGames(records);
      const first = records.find((r) => r.me);
      const shown = first ? (first.me === 'w' ? first.white.name : first.black.name) : name;
      updateSettings({ platform, username: name, player: shown });
      setMessage({
        kind: 'ok',
        text: added === 0 ? `Nothing new: all ${records.length} games were already here.` : `${added} ${added === 1 ? 'game' : 'games'} added.`,
      });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ImportError ? err.message : 'The games could not be fetched. Try again in a moment.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function addPgn(e: FormEvent) {
    e.preventDefault();
    if (!pgn.trim()) {
      setMessage({ kind: 'error', text: 'Paste the PGN of a game first.' });
      return;
    }
    const { records, errors } = recordsFromPgn(pgn);
    if (records.length === 0) {
      setMessage({ kind: 'error', text: errors[0] ?? 'No game was found in that text.' });
      return;
    }
    const added = await addGames(records);
    setPgn('');
    setPasting(false);
    if (records.length === 1) {
      navigate('game', records[0].id);
      return;
    }
    const skipped = errors.length ? ` ${errors.length} could not be read.` : '';
    setMessage({ kind: errors.length ? 'error' : 'ok', text: `${added} of ${records.length} games were new.${skipped}` });
  }

  const platformPicker = (
    <div className="segmented" role="radiogroup" aria-label="Where you play">
      {(Object.keys(PLATFORM_NAME) as Platform[]).map((p) => (
        <label key={p}>
          <input type="radio" name={`${id}-platform`} checked={platform === p} onChange={() => updateSettings({ platform: p })} />
          <span>{PLATFORM_NAME[p]}</span>
        </label>
      ))}
    </div>
  );

  const countPicker = (
    <select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many games to get">
      <option value={10}>Last 10 games</option>
      <option value={20}>Last 20 games</option>
      <option value={50}>Last 50 games</option>
    </select>
  );

  const feedback = message && (
    <p className={message.kind === 'error' ? 'notice error' : 'notice'} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </p>
  );

  const pastePanel = pasting && (
    <form onSubmit={addPgn} style={{ display: 'grid', gap: 10 }}>
      <label className="field">
        <span>PGN of one or more games</span>
        <textarea
          className="textarea"
          value={pgn}
          onChange={(e) => setPgn(e.target.value)}
          placeholder={'[Event "Live Chess"]\n[White "you"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 …'}
          spellCheck={false}
          autoFocus={!PREVIEW}
        />
      </label>
      <div className="form-actions">
        <button className="btn" type="submit">
          Add PGN
        </button>
        {!PREVIEW && (
          <button className="btn quiet" type="button" onClick={() => setPasting(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  if (PREVIEW) {
    return (
      <div className={compact ? 'addbar' : 'importer'}>
        <p className="notice">
          This is a preview. It cannot reach chess.com or Lichess, so getting games by username is switched off here; it works on the live
          site. Paste a PGN instead{compact ? '.' : ', or open the sample game.'}
        </p>
        {pastePanel}
        {feedback}
        <p className="alt">
          {!pasting && (
            <button className="linklike" type="button" onClick={() => setPasting(true)}>
              Paste a PGN
            </button>
          )}
          {!compact && (
            <button className="linklike" type="button" onClick={() => void openSample()}>
              Open a sample game
            </button>
          )}
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="addbar">
        <form className="addbar-main" onSubmit={fetchGames}>
          {platformPicker}
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            aria-label={`${PLATFORM_NAME[platform]} username`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {countPicker}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Getting games…' : 'Get games'}
          </button>
          {!pasting && (
            <button className="btn quiet" type="button" onClick={() => setPasting(true)}>
              Paste a PGN
            </button>
          )}
        </form>
        {pastePanel}
        {feedback}
      </div>
    );
  }

  return (
    <div className="importer">
      <form onSubmit={fetchGames} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {platformPicker}
          {countPicker}
        </div>
        <div className="importer-row">
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={`Your ${PLATFORM_NAME[platform]} username`}
            aria-label={`${PLATFORM_NAME[platform]} username`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Getting games…' : 'Get games'}
          </button>
        </div>
      </form>
      {feedback}
      {pastePanel}
      <p className="alt">
        {!pasting && (
          <button className="linklike" type="button" onClick={() => setPasting(true)}>
            Paste a PGN instead
          </button>
        )}
        <button className="linklike" type="button" onClick={() => void openSample()}>
          Open a sample game
        </button>
      </p>
    </div>
  );
}
