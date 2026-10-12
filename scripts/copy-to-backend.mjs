// Copies the built app (dist/) into the Laravel backend's public/ folder, so one site serves
// both: the app's files as static files, and /api through Laravel. Run by `npm run build:server`.
//
// Laravel's own files in public/ (index.php, .htaccess) are never touched. What was copied last
// time is listed in public/.app-files and removed first, so files from older builds do not pile up.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const pub = join(root, 'backend', 'public');
const manifest = join(pub, '.app-files');
const KEEP = new Set(['index.php', '.htaccess', '.app-files']);

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ has no build. Run `npm run build` first.');
  process.exit(1);
}

const previous = existsSync(manifest) ? readFileSync(manifest, 'utf8').split('\n').filter(Boolean) : [];
for (const name of previous) {
  if (!KEEP.has(name)) rmSync(join(pub, name), { recursive: true, force: true });
}

// dist/.htaccess is for the static-only site; backend/public/.htaccess carries the same rules plus Laravel's.
const entries = readdirSync(dist).filter((name) => !KEEP.has(name) && name !== 'api');
for (const name of entries) {
  rmSync(join(pub, name), { recursive: true, force: true });
  cpSync(join(dist, name), join(pub, name), { recursive: true });
}
writeFileSync(manifest, entries.join('\n') + '\n');
console.log(`Copied ${entries.length} entries from dist/ into backend/public/: ${entries.join(', ')}`);
