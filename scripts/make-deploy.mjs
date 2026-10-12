// Builds the zip to upload to shared hosting: the Laravel backend with production packages
// (vendor/ without dev tools) and the built app. Run by `npm run deploy:zip`, after
// `npm run build:server` has copied the app into backend/public/.
//
// The zip holds two folders, for hosts whose web root is public_html (DirectAdmin, cPanel):
//   chessdebrief/   the Laravel app, kept out of the web root
//   public_html/    Laravel's public/ folder: the app's files, index.php, maintenance.php
// Extracted in the folder that contains public_html, they land side by side.
//
//   node scripts/make-deploy.mjs                  update zip: no .env inside, the server keeps its own
//   node scripts/make-deploy.mjs --env <file>     first deploy: <file> goes in as .env
//
// The working backend/vendor is left alone; production packages are installed in a copy.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const backend = join(root, 'backend');
const out = join(root, 'deploy');
// The working copy is built outside the project, where editors' PHP indexers do not lock its files.
const work = join(tmpdir(), 'chessdebrief-deploy');
const stage = join(work, 'chessdebrief');
const web = join(work, 'public_html');
const args = process.argv.slice(2);
const envFile = args.includes('--env') ? args[args.indexOf('--env') + 1] : null;

if (!existsSync(join(backend, 'public', 'index.html'))) {
  console.error('backend/public has no app build. Run `npm run build:server` first.');
  process.exit(1);
}
if (envFile && !existsSync(envFile)) {
  console.error(`No file at ${envFile}.`);
  process.exit(1);
}

/** Paths (relative to backend/, with /) that never go to the server. */
const SKIP = [
  /^vendor(\/|$)/,
  /^node_modules(\/|$)/,
  /^tests(\/|$)/,
  /^\.env($|\.(?!example$))/,
  /^phpunit\.xml$/,
  /^\.phpunit/,
  /^database\/database\.sqlite$/,
  /^bootstrap\/cache\/.+\.php$/,
  /^storage\/logs\/.+\.log$/,
  /^storage\/framework\/(sessions|views|cache\/data)\/(?!\.gitignore$).+/,
  /^storage\/framework\/(maintenance-guard\.json|web-cron.*)$/,
  /^\.(idea|vscode|fleet)(\/|$)/,
];

console.log('Copying backend/ …');
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// deploy/ keeps only the newest zip.
mkdirSync(out, { recursive: true });
for (const old of readdirSync(out)) if (/^chessdebrief-.*\.zip$/.test(old)) rmSync(join(out, old), { force: true });
cpSync(backend, stage, {
  recursive: true,
  filter: (src) => {
    const rel = relative(backend, src).split(sep).join('/');
    return rel === '' || !SKIP.some((re) => re.test(rel));
  },
});

console.log('Installing production packages (composer install --no-dev) …');
// On Windows composer is a .bat file, which only runs through the shell, given as one command line.
const composerArgs = `install --no-dev --optimize-autoloader --no-interaction --no-progress --working-dir="${stage}"`;
const composer =
  process.platform === 'win32'
    ? spawnSync(`composer ${composerArgs}`, { stdio: 'inherit', shell: true })
    : spawnSync('sh', ['-c', `composer ${composerArgs}`], { stdio: 'inherit' });
if (composer.status !== 0) {
  console.error('composer install failed.');
  process.exit(1);
}
// package:discover may have started a log; the server starts its own.
rmSync(join(stage, 'storage', 'logs', 'laravel.log'), { force: true });

// The web root is public_html, beside the app. index.php and maintenance.php look for the app there.
renameSync(join(stage, 'public'), web);
rmSync(join(web, '.app-files'), { force: true }); // copy-to-backend's own list
// Nothing in the app folder is meant for the web, even if it ends up inside a web root.
writeFileSync(join(stage, '.htaccess'), 'Require all denied\n');

if (envFile) {
  cpSync(envFile, join(stage, '.env'));
  console.log(`Included ${envFile} as .env`);
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const zip = join(out, `chessdebrief-${version}-${stamp}${envFile ? '-first-deploy' : ''}.zip`);
console.log('Zipping …');
// Windows ships bsdtar, which writes zip files (-a picks the format from the name).
const zipped =
  process.platform === 'win32'
    ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', work, 'chessdebrief', 'public_html'], { stdio: 'inherit' })
    : spawnSync('zip', ['-qr', zip, 'chessdebrief', 'public_html'], { cwd: work, stdio: 'inherit' });
if (zipped.status !== 0) {
  console.error(`Zipping failed. The files are ready in ${work}.`);
  process.exit(1);
}
const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
const files = count(stage) + count(web);
// The folders were only the working copy for the zip.
rmSync(work, { recursive: true, force: true });
console.log(`\n${zip}\n${files} files.`);
