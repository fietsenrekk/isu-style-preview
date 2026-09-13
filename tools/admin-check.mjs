#!/usr/bin/env node
/*
  Checks for the owner dashboard at /admin, without real credentials.

    node tools/admin-check.mjs                 (server on http://localhost:4219)
    ADMIN_ORIGIN=http://localhost:4219 node tools/admin-check.mjs

  1. Node unit tests: the Brussels timezone helper (winter, summer, both DST
     switch days) with the process deliberately in another timezone, and the
     host-based demo guard.
  2. Source rules: no inline script/style/handlers in admin.html, noindex,
     no innerHTML-style sinks in assets/admin, no em dashes, no public page
     linking to /admin.
  3. Headless Chrome over CDP, with the production CSP from _headers injected
     into every /admin response so a CSP violation shows up as an error:
     sign-in form at 1440x900 and 390x844, a wrong password, overflow, the
     demo dashboard (every panel, desktop and mobile, screenshots in
     .shots/admin-*.png) in a foreign device timezone, and the demo guard on a
     non-localhost host.
*/

process.env.TZ = 'America/Los_Angeles';   // the helper must not care

import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.env.ADMIN_ORIGIN ?? 'http://localhost:4219').replace(/\/$/, '');
const SHOTS = path.join(ROOT, '.shots');
const FAKE_HOST = 'http://uchi-guard.test';

const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log('  ok   ' + m); };
const no = (m) => { fail.push(m); console.error('  x    ' + m); };
const check = (cond, good, bad) => cond ? ok(good) : no(bad ?? ('FAILED: ' + good));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ================================================================ unit == */
console.log('\n[unit] Brussels timezone helper (process TZ = ' + process.env.TZ + ')');
const T = require(path.join(ROOT, 'assets/admin/tz.js'));
const cases = [
  ['winter', '2026-01-15', '10:00', '2026-01-15T09:00:00.000Z'],
  ['summer', '2026-07-15', '10:00', '2026-07-15T08:00:00.000Z'],
  ['spring switch, before 02:00', '2026-03-29', '01:30', '2026-03-29T00:30:00.000Z'],
  ['spring switch, after 03:00', '2026-03-29', '03:30', '2026-03-29T01:30:00.000Z'],
  ['spring switch, midday', '2026-03-29', '12:00', '2026-03-29T10:00:00.000Z'],
  ['autumn switch, before the repeat', '2026-10-25', '01:30', '2026-10-24T23:30:00.000Z'],
  ['autumn switch, after the repeat', '2026-10-25', '03:30', '2026-10-25T02:30:00.000Z'],
  ['autumn switch, midday', '2026-10-25', '12:00', '2026-10-25T11:00:00.000Z'],
  ['midnight at the start of a winter day', '2026-12-31', '00:00', '2026-12-30T23:00:00.000Z']
];
for (const [label, d, t, iso] of cases) {
  const got = T.toInstant(d, t).toISOString();
  check(got === iso, `${label}: ${d} ${t} Brussels = ${iso}`, `${label}: ${d} ${t} gave ${got}, expected ${iso}`);
  const back = [T.dateOf(iso), T.timeOf(iso)].join(' ');
  check(back === d + ' ' + t, `  and ${iso} reads back as ${d} ${t}`, `  ${iso} reads back as ${back}`);
}
check(T.offsetMinutes('2026-01-15T12:00:00Z') === 60 && T.offsetMinutes('2026-07-15T12:00:00Z') === 120,
  'offset is +60 in winter and +120 in summer', 'offsets wrong');
const len = (d) => { const [a, b] = T.dayRange(d); return (b - a) / 3600000; };
check(len('2026-03-29') === 23 && len('2026-10-25') === 25 && len('2026-09-14') === 24,
  'switch days are 23 h and 25 h long, an ordinary day 24 h',
  `day lengths ${len('2026-03-29')} / ${len('2026-10-25')} / ${len('2026-09-14')}`);
check(T.dateOf('2026-03-28T23:30:00Z') === '2026-03-29' && T.timeOf('2026-03-28T23:30:00Z') === '00:30',
  'an instant late on the UTC day belongs to the next Brussels day', 'date boundary wrong');
check(T.weekStart('2026-09-13') === '2026-09-07' && T.weekStart('2026-09-14') === '2026-09-14'
  && T.addDays('2026-10-24', 2) === '2026-10-26', 'week starts Monday; addDays crosses the switch',
  'weekStart/addDays wrong');
check(T.dayLabel('2026-10-25') === 'SUN 25 OCT 2026', 'day label reads SUN 25 OCT 2026', 'dayLabel: ' + T.dayLabel('2026-10-25'));

console.log('\n[unit] demo guard is host-based');
const { demoAllowed } = require(path.join(ROOT, 'assets/admin/demo.js'));
check(demoAllowed('localhost', '?demo=1') && demoAllowed('127.0.0.1', '?x=2&demo=1'),
  'demo allowed on localhost and 127.0.0.1 with ?demo=1', 'demo refused on localhost');
check(!demoAllowed('localhost', '') && !demoAllowed('localhost', '?demo=0') && !demoAllowed('localhost', '?demo=10'),
  'demo needs exactly demo=1', 'demo allowed without demo=1');
for (const h of ['uchi.be', 'labiwebsite.netlify.app', 'localhost.evil.com', 'evil-localhost', '127.0.0.1.nip.io', '']) {
  check(!demoAllowed(h, '?demo=1'), `demo refused on host "${h}"`, `demo ALLOWED on host "${h}"`);
}

/* ============================================================== source == */
console.log('\n[source] admin files and public pages');
const adminHtml = await readFile(path.join(ROOT, 'admin.html'), 'utf8');
check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(adminHtml), 'admin.html has no inline <script>', 'inline <script> in admin.html');
check(!/<style[\s>]/i.test(adminHtml) && !/\sstyle\s*=/i.test(adminHtml), 'admin.html has no <style> or style=""', 'inline style in admin.html');
check(!/\son[a-z]+\s*=/i.test(adminHtml), 'admin.html has no on*= handlers', 'inline handler in admin.html');
check(!/javascript:/i.test(adminHtml), 'admin.html has no javascript: URLs', 'javascript: URL in admin.html');
check(/<meta name="robots" content="noindex, nofollow">/.test(adminHtml), 'admin.html carries noindex, nofollow', 'noindex meta missing');
const order = [...adminHtml.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
check(order[0].endsWith('vendor/supabase-2.116.0.js') && order[1].endsWith('supabase-config.js') && order[2].endsWith('js/sb.js'),
  'script order: vendor, config, sb.js, then admin scripts', 'script order is ' + order.join(', '));

const adminDir = path.join(ROOT, 'assets/admin');
for (const f of await readdir(adminDir)) {
  const src = await readFile(path.join(adminDir, f), 'utf8');
  if (f.endsWith('.js')) {
    check(!/\.innerHTML|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src),
      `${f}: no HTML-string sinks or eval`, `${f} uses an HTML sink or eval`);
    check(!/setAttribute\(\s*['"](style|on\w+)['"]/.test(src), `${f}: never sets style/on* attributes`, `${f} sets a style/on* attribute`);
  }
  check(!/\u2014/.test(src), `${f}: no em dashes`, `${f} contains an em dash`);
}
check(!/\u2014/.test(adminHtml), 'admin.html: no em dashes', 'admin.html contains an em dash');

for (const f of (await readdir(ROOT)).filter(f => f.endsWith('.html') && f !== 'admin.html')) {
  const src = await readFile(path.join(ROOT, f), 'utf8');
  check(!/href=["'][^"']*admin/i.test(src), `${f} does not link to /admin`, `${f} links to admin`);
}

/* ============================================================== chrome == */
const headers = await readFile(path.join(ROOT, '_headers'), 'utf8').catch(() => '');
const CSP = ((headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1]
  || "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://kvnnikyjsvhxpdftfagj.supabase.co; font-src 'self'; connect-src 'self' https://kvnnikyjsvhxpdftfagj.supabase.co wss://kvnnikyjsvhxpdftfagj.supabase.co")
  .replace(/;\s*upgrade-insecure-requests/, '').trim();   // the local server is plain http

const port = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'admin-check-' + port);
await rm(profile, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

function die(label) {
  return (err) => {
    console.error('\n' + label + ': ' + ((err && err.stack) || err));
    console.error('stopped after ' + pass.length + ' passing checks.');
    try { chrome.kill(); } catch {}
    process.exit(1);
  };
}
process.on('unhandledRejection', die('UNHANDLED REJECTION'));
process.on('uncaughtException', die('UNCAUGHT EXCEPTION'));

async function endpoint() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return (await r.json()).webSocketDebuggerUrl; } catch {}
    await sleep(150);
  }
  throw new Error('Chrome did not come up');
}
const ws = new WebSocket(await endpoint());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('close', () => { if (pending.size) die('DEVTOOLS CLOSED')(new Error(pending.size + ' calls unanswered')); });
const pending = new Map();
let msgId = 0, sessionId = null;
let consoleErrors = [], requests = [];
const raw = (method, params = {}, sid) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  const keepAlive = setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timed out after 45 s')); } }, 45000);
  const done = pending.get(id); pending.set(id, { res: (v) => { clearTimeout(keepAlive); done.res(v); }, rej: (e) => { clearTimeout(keepAlive); done.rej(e); } });
  ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
const send = (m, p) => raw(m, p, sessionId);

async function fulfilFrom(reqId, url, extraHeaders) {
  const r = await fetch(url);
  const body = Buffer.from(await r.arrayBuffer()).toString('base64');
  const hdrs = [{ name: 'Content-Type', value: r.headers.get('content-type') || 'application/octet-stream' }, ...extraHeaders];
  await send('Fetch.fulfillRequest', { requestId: reqId, responseCode: r.status, responseHeaders: hdrs, body });
}

ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  const p = m.params || {};
  if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    consoleErrors.push(p.args.map(a => a.value ?? a.description ?? '?').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('uncaught: ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
  } else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') {
    /* The wrong-password attempt is expected to answer 400; that is not a page error. */
    if (!/auth\/v1\/token/.test(p.entry.url || '') && !/status of 400/.test(p.entry.text)) consoleErrors.push('log: ' + p.entry.text);
  } else if (m.method === 'Network.requestWillBeSent') {
    requests.push(p.request.url);
  } else if (m.method === 'Fetch.requestPaused') {
    if (process.env.DEBUG) console.log('paused', p.resourceType, p.request.url);
    try {
      const u = new URL(p.request.url);
      const csp = [{ name: 'Content-Security-Policy', value: CSP }];
      if (p.request.url.startsWith(FAKE_HOST)) {
        await fulfilFrom(p.requestId, BASE + u.pathname + u.search, p.resourceType === 'Document' ? csp : []);
      } else if (p.request.url.startsWith(BASE) && p.resourceType === 'Document' && /^\/admin/.test(u.pathname)) {
        await fulfilFrom(p.requestId, p.request.url, csp);
      } else {
        await send('Fetch.continueRequest', { requestId: p.requestId });
      }
    } catch (err) {
      console.error('interception failed for ' + p.request.url + ': ' + err.message);
      send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    }
  }
});

const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true }));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: FAKE_HOST + '/*' }, { urlPattern: BASE + '/admin*', resourceType: 'Document' }] });

const evaluate = async (expr) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description || exceptionDetails.text) + ' :: ' + expr.slice(0, 160));
  return result.value;
};
async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
}
async function goto(url, settle = 900) {
  consoleErrors = []; requests = [];
  await send('Page.navigate', { url });
  await sleep(150);
  await evaluate('new Promise(r => { if (document.readyState === "complete") r(1); else addEventListener("load", () => r(1)); })');
  await sleep(settle);
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(120); }
  return false;
}
async function shot(name) {
  const { contentSize } = await send('Page.getLayoutMetrics');
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(contentSize.width), height: Math.min(Math.ceil(contentSize.height), 6000), scale: 1 } });
  await writeFile(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
}
const J = JSON.stringify;
const clickSel = (sel) => evaluate(`(() => { const n = document.querySelector(${J(sel)}); if (!n) return false; n.click(); return true; })()`);
const setVal = (sel, v) => evaluate(`(() => { const n = document.querySelector(${J(sel)}); if (!n) return false;
  n.value = ${J(v)}; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const overflow = () => evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');

/* -------------------------------------------------------- sign-in form -- */
for (const [w, h, mob, tag] of [[1440, 900, false, 'desktop'], [390, 844, true, 'mobile']]) {
  console.log(`\n[browser] sign-in, ${tag} ${w}x${h}`);
  await viewport(w, h, mob);
  await goto(BASE + '/admin');
  const s = await evaluate(`(() => ({
    auth: !document.getElementById('auth').hidden, app: !document.getElementById('app').hidden,
    email: !!document.querySelector('#form-signin input[type=email][autocomplete=username]'),
    pw: !!document.querySelector('#form-signin input[type=password][autocomplete=current-password]'),
    submit: !!document.querySelector('#form-signin button[type=submit]'),
    forgot: !!document.querySelector('[data-show=reset]'), first: !!document.querySelector('[data-show=signup]'),
    logo: (() => { const i = document.querySelector('.logo--auth img'); return i && i.complete && i.naturalWidth > 0; })(),
    font: document.fonts.check('20px "Bebas Neue"'),
    minTap: Math.min(...[...document.querySelectorAll('#form-signin button, #form-signin input')].map(n => n.getBoundingClientRect().height))
  }))()`);
  check(s.auth && !s.app, 'sign-in screen shows, dashboard hidden', 'screen state ' + J(s));
  check(s.email && s.pw && s.submit, 'e-mail, password and sign-in button render', 'form parts ' + J(s));
  check(s.forgot && s.first, '"Forgot password" and "First time" toggles present', 'toggles missing');
  check(s.logo, 'UCHI logo loaded', 'logo did not load');
  check(s.minTap >= 44, `every sign-in control is at least 44 px tall (${s.minTap})`, `a control is ${s.minTap}px tall`);
  check(await overflow() <= 0, 'no horizontal overflow', 'overflow ' + await overflow());
  await shot(`admin-${tag[0]}-signin`);
  if (tag === 'desktop') {
    await clickSel('[data-show=signup]'); await sleep(200);
    check(await evaluate(`!document.getElementById('form-signup').hidden && /admin list/.test(document.getElementById('form-signup').innerText)`),
      '"First time" shows the create-login form with the admin-list explanation', 'signup form not shown');
    await clickSel('#form-signup [data-show=signin]'); await clickSel('[data-show=reset]'); await sleep(200);
    check(await evaluate(`!document.getElementById('form-reset').hidden`), '"Forgot password" shows the reset form', 'reset form not shown');
    await clickSel('#form-reset [data-show=signin]'); await sleep(200);

    await setVal('#si-email', 'nobody@example.invalid');
    await setVal('#si-pw', 'definitely-wrong-password-1');
    await clickSel('#form-signin button[type=submit]');
    const got = await until(`document.getElementById('auth-banner').classList.contains('msg--err')`, 12000);
    const text = await evaluate(`document.getElementById('auth-banner').textContent`);
    check(got && /do not match|too many attempts/i.test(text), `a wrong password shows a friendly error: "${text}"`, 'wrong password message: ' + J(text));
    check(!/invalid_credentials|AuthApiError|400/.test(text), 'no raw error codes shown to the user', 'raw error: ' + text);
    check(await evaluate(`document.getElementById('app').hidden`), 'the dashboard stays hidden', 'dashboard shown after failed login');
    await shot('admin-d-signin-error');
  }
  check(consoleErrors.length === 0, 'no console errors or CSP violations', 'console: ' + J(consoleErrors));
}

/* ----------------------------------------------------------- demo mode -- */
const PANELS = {
  bookings: `(() => ({
    tabs: document.querySelectorAll('#panel-bookings [role=tab]').length === 3,
    stats: document.querySelectorAll('#panel-bookings .stat').length === 3,
    refresh: !!document.querySelector('[data-act=refresh]'), add: !!document.querySelector('[data-act=new-booking]'),
    filters: document.querySelectorAll('#panel-bookings .filters select').length === 2 && !!document.querySelector('#panel-bookings input[type=search]'),
    rows: document.querySelectorAll('#panel-bookings .bk__row').length >= 3,
    tel: !!document.querySelector('#panel-bookings a[href^="tel:"]'), mail: !!document.querySelector('#panel-bookings a[href^="mailto:"]'),
    actions: !!document.querySelector('#panel-bookings [data-status=completed]') && !!document.querySelector('#panel-bookings [data-status=no_show]')
      && !!document.querySelector('#panel-bookings [data-status=cancelled]') && !!document.querySelector('#panel-bookings [data-status=confirmed]')
  }))()`,
  gallery: `(() => ({
    drop: !!document.querySelector('#panel-gallery [data-drop]'), file: !!document.querySelector('#panel-gallery input[type=file][multiple]'),
    cards: document.querySelectorAll('#panel-gallery .gal__item').length >= 5,
    caption: !!document.querySelector('#panel-gallery [data-key=caption]'), alt: !!document.querySelector('#panel-gallery [data-key=alt]'),
    publish: !!document.querySelector('#panel-gallery [data-key=published]'),
    move: !!document.querySelector('#panel-gallery [aria-label="Move later"]'),
    del: [...document.querySelectorAll('#panel-gallery button')].some(b => b.textContent === 'Delete'),
    note: /6 images per page/.test(document.getElementById('panel-gallery').innerText),
    imgs: [...document.querySelectorAll('#panel-gallery .gal__img img')].every(i => i.complete && i.naturalWidth > 0)
  }))()`,
  services: `(() => ({
    rows: document.querySelectorAll('#panel-services .svc__row').length === 8,
    price: document.querySelectorAll('#panel-services input[type=number][step="0.01"]').length === 8,
    staff: document.querySelectorAll('#panel-services .svc__staff input[type=checkbox]').length === 16,
    save: document.querySelectorAll('#panel-services .svc__row button[type=submit]').length === 8
  }))()`,
  hours: `(() => ({
    days: document.querySelectorAll('#hours-form [data-day]').length === 7,
    times: document.querySelectorAll('#hours-form input[type=time]').length === 4,
    nobreak: !!document.querySelector('#hours-form [name=nobreak]'),
    step: !!document.querySelector('#hours-form [name=step]'), lead: !!document.querySelector('#hours-form [name=lead]'),
    horizon: !!document.querySelector('#hours-form [name=horizon]'),
    offForm: !!document.querySelector('#off-form [name=who]') && document.querySelectorAll('#off-form input[type=date]').length === 2,
    offItems: document.querySelectorAll('#panel-hours .off__item').length >= 2,
    explain: /blocks online booking/.test(document.getElementById('panel-hours').innerText)
  }))()`,
  team: `(() => ({
    staff: document.querySelectorAll('#panel-team .team__row').length === 2,
    admins: document.querySelectorAll('#panel-team .adm__item').length === 2,
    selfLocked: [...document.querySelectorAll('#panel-team .adm__item')].some(li => /You/.test(li.innerText) && li.querySelector('button').disabled),
    add: !!document.querySelector('#admin-add input[type=email]')
  }))()`
};

for (const [w, h, mob, tag] of [[1440, 900, false, 'desktop'], [390, 844, true, 'mobile']]) {
  console.log(`\n[browser] demo dashboard, ${tag} ${w}x${h}, device timezone America/New_York`);
  await viewport(w, h, mob);
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await goto(BASE + '/admin?demo=1&pass=' + tag + '#bookings', 1500);   // distinct URL: a hash-only change would not reload
  check(await until(`!document.getElementById('app').hidden && document.querySelectorAll('.bk__row').length > 0`),
    'demo dashboard renders on localhost', 'demo did not render');
  check(await evaluate(`!document.getElementById('demo-flag').hidden`), 'the demo is labelled as demo data', 'no demo label');
  const deviceTz = await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone');
  const times = await evaluate(`[...document.querySelectorAll('#panel-bookings .bk__time span:first-child')].map(n => n.textContent)`);
  check(deviceTz === 'America/New_York' && times.includes('10:00') && times.includes('11:15'),
    `bookings made for 10:00 and 11:15 Brussels show as 10:00 and 11:15 on a ${deviceTz} device`, 'times shown: ' + J(times) + ' on ' + deviceTz);

  for (const name of Object.keys(PANELS)) {
    await clickSel(`.nav__btn[data-panel=${name}]`);
    await sleep(1100);
    const st = await evaluate(`(() => ({ visible: !document.getElementById('panel-${name}').hidden,
      current: document.querySelector('.nav__btn[data-panel=${name}]').getAttribute('aria-current') === 'page',
      others: [...document.querySelectorAll('.panel')].filter(p => !p.hidden).length }))()`);
    check(st.visible && st.current && st.others === 1, `${name}: panel switches in and nav marks it current`, `${name} switch: ${J(st)}`);
    const k = await evaluate(PANELS[name]);
    const missing = Object.entries(k).filter(([, v]) => !v).map(([x]) => x);
    check(missing.length === 0, `${name}: key controls present (${Object.keys(k).join(', ')})`, `${name}: missing ${J(missing)}`);
    const small = await evaluate(`[...document.querySelectorAll('#panel-${name} button, #panel-${name} input:not([type=checkbox]):not([type=file]), #panel-${name} select, .nav__btn')]
      .filter(n => n.offsetParent && n.getBoundingClientRect().height < 43.5).map(n => (n.textContent || n.name || n.type).slice(0, 20))`);
    check(small.length === 0, `${name}: every tap target is at least 44 px tall`, `${name}: small targets ${J(small)}`);
    const ov = await overflow();
    check(ov <= 0, `${name}: no horizontal overflow`, `${name}: overflows by ${ov}px`);
    await sleep(300);
    await shot(`admin-${tag[0]}-${name}`);
  }

  if (tag === 'desktop') {
    console.log('\n[browser] demo interactions');
    await clickSel('.nav__btn[data-panel=bookings]'); await sleep(700);
    /* new booking: Labi rules out the colour services */
    await clickSel('[data-act=new-booking]'); await sleep(500);
    await setVal('#nb-form [name=staff]', 'labi'); await sleep(100);
    const rules = await evaluate(`[...document.querySelectorAll('#nb-form .check input')].filter(i => i.disabled).map(i => i.value)`);
    check(J(rules.sort()) === J(['balayage', 'highlights', 'kleuring', 'roots', 'toner']),
      'new booking: choosing LABI disables the five services Labi does not do', 'disabled: ' + J(rules));
    await setVal('#nb-form [name=staff]', 'donovan'); await sleep(100);
    await evaluate(`document.querySelector('#nb-form .check input[value=balayage]').click()`);
    const grp = await evaluate(`[...document.querySelectorAll('#nb-form .check input')].filter(i => i.disabled).map(i => i.value)`);
    check(J(grp.sort()) === J(['highlights', 'kleuring', 'roots']), 'new booking: one colour service per booking', 'disabled: ' + J(grp));
    await shot('admin-d-new-booking');

    /* overlap: Labi already has a walk-in at 15:00 today in the demo data */
    await setVal('#nb-form [name=staff]', 'labi'); await sleep(100);
    await evaluate(`document.querySelector('#nb-form .check input[value=knippen]').click()`);
    await setVal('#nb-form [name=date]', await evaluate('UchiTZ.today()'));
    await setVal('#nb-form [name=time]', '15:00');
    await setVal('#nb-form [name=name]', 'Test Person'); await setVal('#nb-form [name=phone]', '0470 00 00 00');
    await clickSel('#nb-form button[type=submit]');
    await sleep(400);
    if (await evaluate(`document.getElementById('confirm').open`)) { await clickSel('#confirm-ok'); }
    await until(`!!document.querySelector('#nb-form .msg--err')`, 4000);
    const overlapMsg = await evaluate(`(document.querySelector('#nb-form .msg') || {}).textContent`);
    check(/already has a confirmed booking/.test(overlapMsg), `an overlapping booking is refused in plain words: "${overlapMsg}"`, 'overlap message: ' + J(overlapMsg));
    await shot('admin-d-overlap');

    /* cancel with confirm, then restore */
    const cancelBtn = `#panel-bookings .bk__row [data-status=cancelled]`;
    const before = await evaluate(`document.querySelectorAll('#panel-bookings .badge--cancelled').length`);
    await clickSel(cancelBtn); await sleep(300);
    check(await evaluate(`document.getElementById('confirm').open`), 'cancel asks for confirmation first', 'no confirmation for cancel');
    await clickSel('#confirm-ok');
    await until(`document.querySelectorAll('#panel-bookings .badge--cancelled').length === ${before + 1}`, 4000);
    check(await evaluate(`document.querySelectorAll('#panel-bookings .badge--cancelled').length`) === before + 1, 'cancelling updates the status badge', 'cancel did not apply');
    check(requests.every(u => !/supabase\.co/.test(u)), 'demo mode made no request to the database (' + requests.length + ' requests, none to supabase.co)',
      'demo mode contacted the database: ' + J(requests.filter(u => /supabase\.co/.test(u))));
  }
  check(consoleErrors.length === 0, 'no console errors or CSP violations in the demo', 'console: ' + J(consoleErrors));
}
await send('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => {});

/* ------------------------------------------------ demo guard, off-host -- */
console.log('\n[browser] demo guard on a non-localhost host');
await viewport(1440, 900);
await goto(FAKE_HOST + '/admin?demo=1', 1800);
const guard = await evaluate(`(() => ({ host: location.hostname, auth: !document.getElementById('auth').hidden,
  app: !document.getElementById('app').hidden, flag: !document.getElementById('demo-flag').hidden,
  rows: document.querySelectorAll('.bk__row').length }))()`);
check(guard.host === 'uchi-guard.test' && guard.auth && !guard.app && !guard.flag && guard.rows === 0,
  'on uchi-guard.test, ?demo=1 is ignored and the sign-in screen shows', 'guard failed: ' + J(guard));

/* ------------------------------------------- public pages never link it -- */
console.log('\n[browser] public pages');
for (const p of ['/home', '/reservation', '/gallery']) {
  await goto(BASE + p, 800);
  const found = await evaluate(`[...document.querySelectorAll('a[href]')].filter(a => /admin/i.test(a.getAttribute('href'))).length`);
  check(found === 0, `${p} renders no link to /admin`, `${p} links to admin`);
}

ws.close(); chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});
if (fail.length) {
  console.error('\n' + fail.length + ' FAILED:\n' + fail.map(f => '  x  ' + f).join('\n'));
  process.exit(1);
}
console.log('\nall ' + pass.length + ' admin checks passed against ' + BASE);
process.exit(0);
