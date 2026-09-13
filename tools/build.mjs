#!/usr/bin/env node
/*
  Copies only what the public site needs into dist/, which is what Netlify
  publishes. Tests, docs, database migrations and the README stay in the repo
  but are never served.
*/
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');

const PAGES = ['index.html', 'home.html', 'gallery.html', 'reservation.html', 'admin.html', '404.html'];
const DIRS = ['assets'];
const FILES = ['_headers', '_redirects', 'robots.txt'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const copied = [];
for (const f of [...PAGES, ...FILES]) {
  const src = path.join(root, f);
  if (existsSync(src)) { await cp(src, path.join(out, f)); copied.push(f); }
}
for (const d of DIRS) {
  await cp(path.join(root, d), path.join(out, d), {
    recursive: true,
    filter: (src) => !/\.(map|md)$/i.test(src)
  });
  copied.push(d + '/');
}
for (const required of ['index.html', 'home.html', 'reservation.html']) {
  if (!existsSync(path.join(out, required))) {
    console.error('build: missing required page ' + required);
    process.exit(1);
  }
}
console.log('dist/ <- ' + copied.join(', '));
console.log('top level: ' + (await readdir(out)).join(', '));
