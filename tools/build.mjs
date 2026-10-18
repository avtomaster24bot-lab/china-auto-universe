// Сборка статического сайта: web/ + data/ → dist/. Без зависимостей.
import { cpSync, rmSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'web'), dist, { recursive: true });
cpSync(join(root, 'data'), join(dist, 'data'), { recursive: true, filter: (p) => !p.endsWith('.md') && !p.includes('_template') });

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p); else files.push(relative(dist, p));
  }
})(dist);

const precache = ['./', ...files.filter((f) => f !== 'sw.js').map((f) => './' + f.split('\\').join('/'))].sort();
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 10);

const swPath = join(dist, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace("'__VERSION__'", JSON.stringify(version)).replace('= __PRECACHE__;', '= ' + JSON.stringify(precache, null, 2) + ';'));
writeFileSync(join(dist, '404.html'), readFileSync(join(dist, 'index.html')));
console.log(`dist/ готов: ${files.length} файлов, версия кэша ${version}`);
