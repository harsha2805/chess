// Builds the sandboxed preview page: the app with username import switched off,
// its stylesheet inlined, and a plain JavaScript engine added as a backup.
// Usage: node scripts/make-preview.mjs <output folder>
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist-preview'));

execFileSync('node', ['scripts/copy-engine.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_PREVIEW: '1' },
});

copyFileSync(join(root, 'node_modules', 'stockfish', 'bin', 'stockfish-19-asm.js'), join(out, 'engine', 'stockfish-19-asm.js'));

const assets = readdirSync(join(out, 'assets'));
const cssFile = assets.find((f) => /^index-.*\.css$/.test(f));
const jsFile = assets.find((f) => /^index-.*\.js$/.test(f));
// The stylesheet moves into the page, so its font addresses must be relative to the page.
const css = readFileSync(join(out, 'assets', cssFile), 'utf8').replace(/url\((["']?)\.\//g, 'url($1assets/');

const page = `<title>ChessDebrief Chess Review</title>
<style>${css}</style>
<div id="root"></div>
<script type="module" src="assets/${jsFile}"></script>
`;
writeFileSync(join(out, 'page.html'), page);

// Not needed in the preview: the server-side report endpoint and the original page.
for (const f of ['api', '.htaccess', 'index.html', join('assets', cssFile)]) rmSync(join(out, f), { recursive: true, force: true });
console.log(`Preview written to ${out}`);
