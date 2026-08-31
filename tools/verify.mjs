#!/usr/bin/env node
/**
 * Verification for the ISU-style preview.
 *
 *   node tools/verify.mjs
 *
 * Loads every section at desktop and mobile, screenshots each, and checks the
 * things a screenshot alone cannot: console errors, failed requests, horizontal
 * overflow, silently clipped text, and that the measured typography still
 * matches what was taken off the reference site.
 */
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.VERIFY_ORIGIN ?? 'http://localhost:4219';
const OUT = path.resolve(import.meta.dirname, '..', '.shots');
await mkdir(OUT, { recursive: true });

const port = 9400 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), `isuv-${port}`);
await rm(profile, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Chrome DevTools did not come up');
}

const ws = new WebSocket(await endpoint());
const pending = new Map();
const events = [];
let id = 0;
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  } else if (m.method) events.push(m);
});
const raw = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
const send = (m, p) => raw(m, p, sessionId);

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');

const ev = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};

async function load(url, w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  events.length = 0;
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1200));
  await ev('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 300));
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
}
const errorsNow = () => events
  .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => e.params.entry.text);
const badNow = () => events
  .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
  .map((e) => `${e.params.response.status} ${e.params.response.url}`);

const fail = [];
const ok = [];
const SECTIONS = ['home', 'intro', 'prices', 'contact'];

/* ------------------------------------------------------------- desktop --- */

await load(BASE + '/', 1440, 900, false);
if (errorsNow().length) fail.push(`desktop console: ${errorsNow().join(' | ')}`);
if (badNow().length) fail.push(`desktop HTTP>=400: ${badNow().join(' | ')}`);

for (const sec of SECTIONS) {
  await ev(`document.querySelector('#main-navigation [data-sec="${sec}"], .head__mark[data-sec="${sec}"]').click()`);
  await new Promise((r) => setTimeout(r, 350));
  await shot(`d-${sec}.png`);
  const s = await ev(`(() => { const s = document.getElementById('${sec}');
    const r = s.getBoundingClientRect();
    return { active: s.classList.contains('is-active'), h: Math.round(r.height),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
  if (!s.active) fail.push(`desktop: #${sec} did not activate`);
  else if (s.h < 50) fail.push(`desktop: #${sec} active but only ${s.h}px tall`);
  else if (s.overflow) fail.push(`desktop: #${sec} causes horizontal overflow`);
  else ok.push(`desktop #${sec} renders (${s.h}px), no overflow`);
}

const type = await ev(`(() => {
  const li = document.querySelector('#main-navigation li[data-sec="contact"]');
  const desc = document.querySelector('#contact .item .desc');
  const val = document.querySelector('#contact .item .value');
  const rule = document.querySelector('#contact .rule');
  const g = (el) => el ? getComputedStyle(el) : null;
  const l = g(li), d = g(desc), v = g(val), r = g(rule);
  return { navFont: l.fontFamily, navSize: l.fontSize, selected: li.classList.contains('selected'),
    descFont: d.fontFamily, descSize: d.fontSize, descAlign: d.textAlign,
    valAlign: v.textAlign, ruleW: r.width, ruleBg: r.backgroundColor };
})()`);
if (!/Bebas/.test(type.navFont) || type.navSize !== '22px') fail.push(`nav type wrong: ${type.navFont} ${type.navSize}`);
if (!/Bebas/.test(type.descFont) || type.descSize !== '22px') fail.push(`price/contact type wrong: ${type.descFont} ${type.descSize}`);
if (type.descAlign !== 'right' || type.valAlign !== 'left') fail.push(`column alignment wrong: ${type.descAlign}/${type.valAlign}`);
if (type.ruleW !== '6px') fail.push(`centre rule should be 6px, got ${type.ruleW}`);
if (!type.selected) fail.push('nav .selected state not applied');
if (fail.length === 0) ok.push(`typography matches reference (Bebas 22px, ${type.descAlign}/${type.valAlign}, ${type.ruleW} rule)`);

/* silently clipped text */
const clipped = [];
for (const sec of ['intro', 'prices', 'contact']) {
  await ev(`document.querySelector('#main-navigation [data-sec="${sec}"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  /*
    .legend is exempt on purpose. It is set `white-space: nowrap` and is meant
    to run past its 500px column, exactly as ISU's does, so scrollWidth always
    exceeds clientWidth for it. That is intentional overflow, not clipping —
    it is asserted separately below against the viewport edge, which is the
    thing that would actually cut it off.
  */
  const c = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#${sec} p, #${sec} a')]
    .filter(el => !el.classList.contains('legend'))
    .filter(el => el.scrollWidth - el.clientWidth > 2 && el.clientWidth >= 4)
    .map(el => el.className + ' :: ' + el.textContent.trim().slice(0, 40)))`));
  if (c.length) clipped.push(`${sec}: ${c.join(' | ')}`);
}
if (clipped.length) fail.push(`clipped text: ${clipped.join(' || ')}`);
else ok.push('no clipped text in any desktop section');

/* The legend must stay inside the viewport at the widest and the narrowest
   desktop width it is used at. */
for (const w of [1440, 901]) {
  await load(BASE + '/', w, 900, false);
  await ev(`document.querySelector('#main-navigation [data-sec="prices"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  const bounds = await ev(`(() => { const l = document.querySelector('#prices .legend');
    const r = l.getBoundingClientRect();
    return { right: Math.round(r.right), vw: document.documentElement.clientWidth,
      hiddenByAncestor: (() => { let el = l.parentElement;
        while (el) { const o = getComputedStyle(el).overflowX;
          if (o === 'hidden' || o === 'clip') {
            const p = el.getBoundingClientRect();
            if (r.right > p.right + 1) return true;
          } el = el.parentElement; } return false; })() }; })()`);
  if (bounds.right > bounds.vw) fail.push(`legend runs off the viewport at ${w}px (right ${bounds.right} > ${bounds.vw})`);
  else if (bounds.hiddenByAncestor) fail.push(`legend is clipped by an ancestor at ${w}px`);
  else ok.push(`legend fits at ${w}px (ends at ${bounds.right} of ${bounds.vw})`);
}

/* ---------------------------------------------------------- reservation --- */

await load(BASE + '/reservation.html', 1440, 900, false);
if (errorsNow().length) fail.push(`reservation console: ${errorsNow().join(' | ')}`);
if (badNow().length) fail.push(`reservation HTTP>=400: ${badNow().join(' | ')}`);
await shot('d-reservation.png');
const res = await ev(`(() => { const c = document.querySelector('.reserve-cta');
  return { href: c.href, text: c.textContent.trim(),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
if (!res.href.includes('labibookings.setmore.com')) fail.push(`reservation CTA points at ${res.href}`);
if (res.overflow) fail.push('reservation page overflows horizontally');
else ok.push(`reservation page renders, CTA -> Setmore`);

/* --------------------------------------------------------------- mobile --- */

await load(BASE + '/', 390, 844, true);
if (errorsNow().length) fail.push(`mobile console: ${errorsNow().join(' | ')}`);

for (const sec of SECTIONS) {
  await ev(`(() => { const n = document.getElementById('main-navigation-mobile');
    if (!n.classList.contains('open')) document.getElementById('ico-nav').click(); })()`);
  await new Promise((r) => setTimeout(r, 250));
  await ev(`document.querySelector('#main-navigation-mobile [data-sec="${sec}"]').click()`);
  await new Promise((r) => setTimeout(r, 350));
  await shot(`m-${sec}.png`);
  const s = await ev(`(() => { const s = document.getElementById('${sec}');
    const r = s.getBoundingClientRect();
    return { active: s.classList.contains('is-active'), h: Math.round(r.height),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      menuClosed: !document.getElementById('main-navigation-mobile').classList.contains('open'),
      logoW: Math.round(document.querySelector('.head__mark img').getBoundingClientRect().width) }; })()`);
  if (!s.active) fail.push(`mobile: #${sec} did not activate`);
  else if (s.overflow) fail.push(`mobile: #${sec} causes horizontal overflow`);
  else if (!s.menuClosed) fail.push(`mobile: menu stayed open after choosing ${sec}`);
  else if (s.logoW < 90) fail.push('mobile: logo is only ' + s.logoW + 'px wide - the lockup sub-line will not read');
  else ok.push(`mobile #${sec} renders (${s.h}px), menu closes, no overflow`);
}

await ev(`document.getElementById('ico-nav').click()`);
await new Promise((r) => setTimeout(r, 400));
await shot('m-menu.png');
const menu = await ev(`(() => { const n = document.getElementById('main-navigation-mobile');
  const cs = getComputedStyle(n); const li = getComputedStyle(n.querySelector('li'));
  return { open: n.classList.contains('open'), bg: cs.backgroundColor, liSize: li.fontSize,
    burgerX: document.getElementById('ico-nav').classList.contains('open') }; })()`);
if (menu.bg !== 'rgb(136, 136, 136)') fail.push(`mobile menu ground should be #888888, got ${menu.bg}`);
if (!menu.burgerX) fail.push('burger did not switch to its X state');
if (!fail.some((f) => f.includes('menu'))) ok.push(`mobile menu opens on #888888, li ${menu.liSize}, burger becomes X`);

await load(BASE + '/reservation.html', 390, 844, true);
await shot('m-reservation.png');
const resM = await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth');
if (resM) fail.push('reservation page overflows horizontally on mobile');
else ok.push('reservation page fits at 390px');

/* --------------------------------------------------------------- report --- */

ws.close();
chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});

console.log(ok.map((o) => '  ok   ' + o).join('\n'));
if (fail.length) {
  console.error(`\n${fail.length} FAILED:\n` + fail.map((f) => '  x  ' + f).join('\n'));
  process.exit(1);
}
console.log(`\nall checks passed against ${BASE}`);
