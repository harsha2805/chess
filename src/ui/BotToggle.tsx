import { updateSettings, useStore } from '../lib/store';

/** Shown once there are games against the bot: whether they are listed and counted with the real ones. */
export function BotToggle() {
  const include = useStore((s) => s.settings.includeBots);
  const count = useStore((s) => s.games.reduce((n, g) => n + (g.source === 'bot' ? 1 : 0), 0));
  if (count === 0) return null;
  return (
    <label className="bot-toggle">
      <input type="checkbox" checked={include} onChange={(e) => updateSettings({ includeBots: e.target.checked })} />
      <span>
        Include my {count} {count === 1 ? 'game' : 'games'} against the bot
      </span>
    </label>
  );
}
