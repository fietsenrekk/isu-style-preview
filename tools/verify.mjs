#!/usr/bin/env node
/*
  End-to-end verification for the UCHI site.

  Drives a real headless Chrome over the DevTools Protocol and clicks the site
  the way a visitor would: swaps the hero photograph, walks the whole booking
  flow, and checks that the exclusion between Labi and the colour services
  actually holds in the DOM rather than only in booking-core's unit tests.

  Run against a local server:   node tools/verify.mjs
  Run against the live URL:     VERIFY_ORIGIN=https://... node tools/verify.mjs
*/

import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.VERIFY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.env.VERIFY_ORIGIN ?? 'http://localhost:4219').replace(/\/$/, '');
const SHOTS = process.env.VERIFY_SHOTS ? path.resolve(process.env.VERIFY_SHOTS) : null;

const port = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'verify-' + port);
await rm(profile, { recursive: true, force: true });
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Chrome did not come up');
}

const ws = new WebSocket(await endpoint());
const pending = new Map();
let msgId = 0;
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '?').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description
      ?? m.params.exceptionDetails.text));
  } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    badResponses.push(m.params.response.status + ' ' + m.params.response.url);
  }
});
const raw = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

let consoleErrors = [], badResponses = [];
const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
const send = (m, p) => raw(m, p, sessionId);
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const evaluate = async (expr) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' :: ' + expr.slice(0, 120));
  return result.value;
};

const pass = [], fail = [];
/*
  Printed as they happen, not collected and printed at the end. An open
  WebSocket keeps Node's event loop alive, so a thrown error in this file does
  not terminate the process - it just stops making progress. Buffering the
  output until the end turned every such failure into a silent hang with
  nothing on stdout to say where it stopped.
*/
const ok = (m) => { pass.push(m); console.log('  ok   ' + m); };
const no = (m) => { fail.push(m); console.error('  x    ' + m); };

/* And make a throw end the run, loudly, with Chrome cleaned up after it. */
function die(label) {
  return (err) => {
    console.error('\n' + label + ': ' + ((err && err.stack) || err));
    console.error('stopped after ' + pass.length + ' passing checks.');
    try { ws.close(); } catch {}
    try { chrome.kill(); } catch {}
    process.exit(1);
  };
}
process.on('unhandledRejection', die('UNHANDLED REJECTION'));
process.on('uncaughtException', die('UNCAUGHT EXCEPTION'));
const check = (cond, good, bad) => cond ? ok(good) : no(bad);

async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile });
}
async function goto(url) {
  consoleErrors = []; badResponses = [];
  await send('Page.navigate', { url });
  await evaluate('new Promise(r => { if (document.readyState === "complete") r(1);'
    + ' else addEventListener("load", () => r(1)); })');
  await new Promise(r => setTimeout(r, 2600));   // clear of the curtain (.45s) and the reveal (~2.1s)
}
async function shot(name) {
  if (!SHOTS) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
}
/* Click by selector and let the transition settle. */
async function click(sel, settle = 420) {
  const hit = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return false; n.click(); return true; })()`);
  if (!hit) throw new Error('no element for ' + sel);
  await new Promise(r => setTimeout(r, settle));
  return hit;
}

/* ====================================================================== */
console.log('\nverifying ' + BASE + '\n');

/* ---------------------------------------------------------- desktop ----- */
await viewport(1440, 900);
await goto(BASE + '/home');

check(await evaluate(`document.title.includes('UCHI')`),
  'page is branded UCHI', 'title is not UCHI');

/* This is the live site: no mockup marker, no instruction to search engines to
   stay away, and none of the brands it replaced. */
const finalSite = await evaluate(`(() => ({
  flag: !!document.querySelector('.preview-flag'),
  noindex: !!document.querySelector('meta[name=robots][content*=noindex]'),
  old: /jill|scutt|kiru|mockup/i.test(document.documentElement.outerHTML)
}))()`);
check(!finalSite.flag, 'no PREVIEW MOCKUP marker on the page', 'the preview marker is still on the page');
check(!finalSite.noindex, 'the page is indexable (no noindex)', 'the page still tells search engines to stay away');
check(!finalSite.old, 'no trace of the earlier brand names or the word mockup', 'an old brand name survives in the markup');

/* The wordmark: present, right shape, and not sitting in a white box. */
const logo = await evaluate(`(() => {
  const img = document.querySelector('.head__mark img');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right),
           top: Math.round(r.top), nat: img.naturalWidth + 'x' + img.naturalHeight,
           src: img.currentSrc, complete: img.complete };
})()`);
check(logo && logo.complete && logo.w > 0, 'wordmark loaded (' + (logo && logo.nat) + ')',
  'wordmark did not load: ' + JSON.stringify(logo));
check(logo && Math.abs((logo.w / logo.h) - 2.711) < 0.15,
  'wordmark keeps its 2.71:1 proportion (' + (logo && (logo.w / logo.h).toFixed(2)) + ')',
  'wordmark is distorted: ' + JSON.stringify(logo));
check(logo && logo.w >= 160, 'wordmark is legible at ' + (logo && logo.w) + 'px wide',
  'wordmark is only ' + (logo && logo.w) + 'px wide');

/* Transparency: the pixel just inside the logo box, away from ink, must be the
   page's paper colour. A white-boxed PNG would read 255,255,255 against
   #fcfcfc = 252. Sampled by drawing the actual served file to a canvas. */
const alpha = await evaluate(`(async () => {
  const img = document.querySelector('.head__mark img');
  const im = new Image(); im.crossOrigin = 'anonymous'; im.src = img.currentSrc;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const corners = [[1,1],[im.naturalWidth-2,1],[1,im.naturalHeight-2],
                   [im.naturalWidth-2,im.naturalHeight-2]];
  return corners.map(([a,b]) => x.getImageData(a,b,1,1).data[3]);
})()`);
check(Array.isArray(alpha) && alpha.every(a => a === 0),
  'wordmark corners are fully transparent (alpha ' + JSON.stringify(alpha) + ')',
  'wordmark carries a background: corner alpha ' + JSON.stringify(alpha));

/* Nav wording. */
const navText = await evaluate(
  `[...document.querySelectorAll('#main-navigation li')].map(n => n.textContent.trim())`);
check(JSON.stringify(navText) === JSON.stringify(['INTRO', 'CONTACT', 'GALLERY', 'RESERVATION']),
  'desktop nav reads INTRO / CONTACT / GALLERY / RESERVATION',
  'desktop nav is ' + JSON.stringify(navText));
check(!navText.some(t => /PRICES/i.test(t)), 'PRICES is gone from the nav',
  'PRICES still in the nav');
check(!navText.some(t => /MAKE A/i.test(t)), '"MAKE A RESERVATION" is now "RESERVATION"',
  'nav still says MAKE A RESERVATION');
check(await evaluate(`!document.getElementById('prices')`),
  'the prices section is gone from the page', 'a #prices section is still present');

/* Each section renders and nothing overflows. */
for (const id of ['home', 'intro', 'contact']) {
  if (id !== 'home') await click(`#main-navigation [data-sec="${id}"]`, 1300);
  const s = await evaluate(`(() => {
    const n = document.getElementById(${JSON.stringify(id)});
    const r = n.getBoundingClientRect();
    return { active: n.classList.contains('is-active'), h: Math.round(r.height),
             overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  check(s.active && s.h > 40, `desktop #${id} renders (${s.h}px)`,
    `desktop #${id} did not render: ${JSON.stringify(s)}`);
  check(s.overflow <= 0, `desktop #${id} has no horizontal overflow`,
    `desktop #${id} overflows by ${s.overflow}px`);
}
await shot('d-contact');

/* The final contact details, as links a phone can act on. */
const contact = await evaluate(`(() => {
  const s = document.getElementById('contact');
  return {
    tel: [...s.querySelectorAll('a[href^="tel:"]')].map(a => [a.getAttribute('href'), a.textContent.trim()]),
    mail: [...s.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href')),
    ig: [...s.querySelectorAll('a[href*="instagram.com"]')].map(a => [a.getAttribute('href'), a.textContent.trim()]),
    text: s.innerText
  };
})()`);
check(JSON.stringify(contact.tel) === JSON.stringify([['tel:+32498803033', '+32 498 80 30 33']]),
  'the phone is 0498 80 30 33, as a tappable tel: link',
  'phone links are ' + JSON.stringify(contact.tel));
check(JSON.stringify(contact.mail) === JSON.stringify(['mailto:info@uchi.be']),
  'the e-mail is info@uchi.be', 'mail links are ' + JSON.stringify(contact.mail));
check(JSON.stringify(contact.ig) === JSON.stringify([
        ['https://www.instagram.com/labi_antwerp/', '@LABI_ANTWERP'],
        ['https://www.instagram.com/donovanhairdresser/', '@DONOVANHAIRDRESSER']]),
  'both Instagram accounts are listed, Labi first and Donovan second',
  'instagram links are ' + JSON.stringify(contact.ig));
check(!/468|alabivof/.test(contact.text), 'none of the old contact details remain',
  'an old phone number or address survives on the contact section');

/* Opening hours: what is published must equal what booking-data holds. */
const hours = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('#hours-rows .item')].map(i => [
    i.querySelector('.desc').textContent.trim(), i.querySelector('.value').textContent.trim()]);
  return { rows, brk: document.getElementById('hours-break').textContent.trim(),
           fromData: BookingCore.hoursSummary(SHOP).map(r => [r.label, r.value]) };
})()`);
check(JSON.stringify(hours.rows) === JSON.stringify(hours.fromData),
  'published hours are rendered from booking-data, and match it',
  'published hours differ from booking-data:\n     page ' + JSON.stringify(hours.rows)
  + '\n     data ' + JSON.stringify(hours.fromData));
check(hours.rows.length === 2,
  'the hours are stated in two lines, not seven',
  'expected 2 collapsed rows, got ' + hours.rows.length + ': ' + JSON.stringify(hours.rows));
check(JSON.stringify(hours.rows[0]) === JSON.stringify(['MON-FRI', '10:00-22:00']),
  'Monday to Friday is one row reading 10:00-22:00',
  'weekday row is ' + JSON.stringify(hours.rows[0]));
check(JSON.stringify(hours.rows[1]) === JSON.stringify(['SAT-SUN', '/']),
  'Saturday and Sunday are one closed row',
  'weekend row is ' + JSON.stringify(hours.rows[1]));
check(!/10:00-22:00[\s\S]*10:00-22:00/.test(
        await evaluate('document.getElementById("hours-rows").innerText')),
  'the opening time is printed once, not five times',
  '10:00-22:00 appears more than once in the hours block');
check(/14:00-15:00/.test(hours.brk), 'the afternoon break is published (' + hours.brk + ')',
  'break not shown: ' + hours.brk);

/* No clipped text anywhere. */
const clipped = await evaluate(`(() => {
  const out = [];
  document.querySelectorAll('.section.is-active p, .section.is-active .desc, .section.is-active .value')
    .forEach(n => {
      if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible')
        out.push(n.textContent.trim().slice(0, 30));
    });
  return out;
})()`);
check(clipped.length === 0, 'no clipped text in the contact section',
  'clipped: ' + JSON.stringify(clipped));

/* ------------------------------------------------- one photograph ------ */
await goto(BASE + '/home');
const hero = await evaluate(`(() => {
  const imgs = [...document.querySelectorAll('#home .figure img')];
  const i = imgs[0];
  return { count: imgs.length, complete: i && i.complete, nat: i && (i.naturalWidth + 'x' + i.naturalHeight),
           swap: !!document.querySelector('.figure__swap, .figure__cue') };
})()`);
check(hero.count === 1 && !hero.swap, 'the homepage shows one photograph, with no swap',
  'homepage photo state: ' + JSON.stringify(hero));
check(hero.complete && hero.nat !== '0x0', 'the photograph loaded (' + hero.nat + ')',
  'the photograph did not load: ' + JSON.stringify(hero));
await shot('d-home');

/* The root address forwards to /home. */
await send('Page.navigate', { url: BASE + '/' });
await new Promise(r => setTimeout(r, 1500));
const landed = await evaluate('location.pathname');
check(/\/home$/.test(landed), 'the site root forwards to /home (' + landed + ')',
  'the root did not forward: ' + landed);

/* The tagline sits under the rule. */
const tagCover = await evaluate(`!!document.querySelector('.head .tapa--tag')`);
check(tagCover, 'the tagline has its own reveal cover', 'no reveal cover for the tagline');

/* The homepage nav sits bottom-left against a centred figure. */
await goto(BASE + '/home');
const navClash = await evaluate(`(() => {
  const n = document.getElementById('main-navigation');
  const f = document.querySelector('#home .figure');
  const x = n.getBoundingClientRect(), y = f.getBoundingClientRect();
  return { hit: x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top,
           nav: [Math.round(x.right)], fig: [Math.round(y.left)] };
})()`);
check(navClash.hit === false, 'the nav and the photograph do not overlap',
  'nav overlaps the figure: ' + JSON.stringify(navClash));

/* ============================================ one site, every page ===== */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/* Poll an expression, tolerating the context being torn down mid-navigation. */
async function waitFor(expr, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evaluate(expr)) return true; } catch {}
    await sleep(60);
  }
  return false;
}
const IDLE = `!/curtain-(cover|in|out)/.test(document.documentElement.className)`;
const PAGES = ['home', 'gallery', 'reservation'];
const HREF = { HOME: 'home', INTRO: 'home#intro', CONTACT: 'home#contact',
               GALLERY: 'gallery', RESERVATION: 'reservation' };

/* --- static audit: strict-CSP readiness and no /admin, in the files ----- */
{
  const { readFileSync } = await import('node:fs');
  const root = path.join(path.dirname((await import('node:url')).fileURLToPath(import.meta.url)), '..');
  for (const f of ['index.html', 'home.html', 'gallery.html', 'reservation.html']) {
    const src = readFileSync(path.join(root, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const inlineScripts = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m => !/\bsrc\s*=/.test(m[1]) || m[2].trim() !== '');
    const styleAttr = src.match(/<[^>]+\sstyle\s*=/gi) || [];
    const handlers = src.match(/<[^>]+\son[a-z]+\s*=/gi) || [];
    const jsUrls = src.match(/javascript:/gi) || [];
    const styleTags = src.match(/<style\b/gi) || [];
    check(inlineScripts.length + styleAttr.length + handlers.length + jsUrls.length + styleTags.length === 0,
      f + ' has no inline script, style, on* handler or javascript: URL',
      f + ' is not CSP-clean: ' + JSON.stringify({ inlineScripts: inlineScripts.length,
        styleAttr, handlers, jsUrls: jsUrls.length, styleTags: styleTags.length }));
    check(!/href\s*=\s*"[^"]*admin/i.test(src), f + ' never links /admin', f + ' links to admin');
  }
}

/* --- the nav, on every page, at desktop and on a phone -------------------- */
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await viewport(w, h, mobile);
  for (const p of PAGES) {
    await goto(BASE + '/' + p);
    const nav = await evaluate(`(() => {
      const shown = n => !!n && getComputedStyle(n).display !== 'none';
      const read = sel => [...document.querySelectorAll(sel + ' li')].map(li => {
        const a = li.querySelector('a');
        return [a && a.textContent.trim(), a && a.getAttribute('href'), li.classList.contains('selected')];
      });
      const links = [...document.querySelectorAll('a[href]')];
      return { desk: read('#main-navigation'), mob: read('#main-navigation-mobile'),
        deskShown: shown(document.getElementById('main-navigation')),
        burgerShown: shown(document.getElementById('ico-nav')),
        admin: links.some(a => /admin/i.test(a.getAttribute('href') + ' ' + a.textContent)) };
    })()`);
    const label = p + ' @' + w;
    const want = (items) => items.map(t => [t, HREF[t],
      (p === 'gallery' && t === 'GALLERY') || (p === 'reservation' && t === 'RESERVATION')
      || (p === 'home' && t === 'HOME')]);
    check(JSON.stringify(nav.desk) === JSON.stringify(want(['INTRO', 'CONTACT', 'GALLERY', 'RESERVATION'])),
      label + ': desktop nav INTRO / CONTACT / GALLERY / RESERVATION, current page marked',
      label + ': desktop nav is ' + JSON.stringify(nav.desk));
    check(JSON.stringify(nav.mob) === JSON.stringify(want(['HOME', 'INTRO', 'CONTACT', 'GALLERY', 'RESERVATION'])),
      label + ': mobile menu HOME / INTRO / CONTACT / GALLERY / RESERVATION, current marked',
      label + ': mobile menu is ' + JSON.stringify(nav.mob));
    check(mobile ? (!nav.deskShown && nav.burgerShown) : (nav.deskShown && !nav.burgerShown),
      label + ': the ' + (mobile ? 'burger' : 'left nav') + ' is the one showing',
      label + ': wrong nav visible ' + JSON.stringify(nav));
    check(!nav.admin, label + ': no admin link', label + ': an admin link is on the page');
  }
}

/* --- the burger ------------------------------------------------------------ */
/* The reservation page is the long one on a phone, so scroll lock is observable. */
await viewport(390, 844, true);
await goto(BASE + '/reservation');

async function key(k, code, extra = {}) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: extra.vk, modifiers: extra.mod || 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: extra.vk, modifiers: extra.mod || 0 });
}
async function tap(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const menuState = `(() => {
  const b = document.getElementById('ico-nav'), n = document.getElementById('main-navigation-mobile');
  const cs = getComputedStyle(n), links = [...n.querySelectorAll('a')];
  const br = b.getBoundingClientRect();
  return { cls: document.documentElement.classList.contains('menu-open'),
    expanded: b.getAttribute('aria-expanded'), vis: cs.visibility, op: cs.opacity,
    focusIn: n.contains(document.activeElement), focusBurger: document.activeElement === b,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    liOpacity: [...n.querySelectorAll('li')].map(li => getComputedStyle(li).opacity),
    linkH: links.map(a => Math.round(a.getBoundingClientRect().height)),
    burger: [Math.round(br.width), Math.round(br.height)], scrollY: Math.round(scrollY) };
})()`;

await evaluate(`window.scrollTo(0, 200)`);
const scrolledTo = await evaluate('Math.round(scrollY)');
await evaluate(`window.scrollTo(0, 0)`);
await sleep(100);
const bRect = await evaluate(`(() => { const r = document.getElementById('ico-nav').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
await tap(bRect[0], bRect[1] + 0);
await sleep(1200);
let m = await evaluate(menuState);
check(m.cls && m.expanded === 'true' && m.vis === 'visible' && m.op === '1',
  'burger opens the menu, aria-expanded="true"', 'menu did not open: ' + JSON.stringify(m));
check(m.focusIn, 'focus moves into the open menu', 'focus stayed outside the menu');
check(m.liOpacity.every(o => o === '1'), 'every menu item has faded in', 'menu items: ' + m.liOpacity);
check(m.htmlOverflow === 'hidden', 'page scroll is locked while the menu is open',
  'html overflow while open is ' + m.htmlOverflow);
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 400, deltaX: 0, deltaY: 500 });
await sleep(300);
const wheelY = await evaluate('Math.round(scrollY)');
check(scrolledTo > 0 && wheelY === 0, 'a wheel/scroll gesture does not move the page under the menu',
  'the page scrolled under the menu (' + wheelY + ', page scrollable to ' + scrolledTo + ')');
check(m.linkH.every(hh => hh >= 40) && m.burger[0] >= 40 && m.burger[1] >= 40,
  'menu links (' + m.linkH.join('/') + 'px) and the burger (' + m.burger.join('x') + ') are 40px+ targets',
  'tap targets too small: ' + JSON.stringify({ links: m.linkH, burger: m.burger }));
await shot('m-menu-open');

/* Tab stays inside the burger + links ring. */
for (let i = 0; i < 7; i++) await key('Tab', 'Tab', { vk: 9 });
m = await evaluate(menuState);
check(m.focusIn || m.focusBurger, 'Tab is trapped inside the open menu', 'focus escaped the menu');

await key('Escape', 'Escape', { vk: 27 });
await sleep(500);
m = await evaluate(menuState);
check(!m.cls && m.expanded === 'false' && m.vis === 'hidden',
  'Escape closes the menu and it ends hidden', 'Escape did not close: ' + JSON.stringify(m));
check(m.focusBurger, 'focus returns to the burger on close', 'focus did not return to the burger');
check(m.htmlOverflow !== 'hidden', 'scroll lock is released on close', 'scroll still locked after close');

await tap(bRect[0], bRect[1]);
await sleep(900);
await tap(370, 820);   // grey overlay, nowhere near a link
await sleep(500);
m = await evaluate(menuState);
check(!m.cls && m.vis === 'hidden', 'tapping the backdrop closes the menu', 'backdrop tap left it open: ' + JSON.stringify(m));

/* A link in the menu closes it and goes where it says. */
await tap(bRect[0], bRect[1]);
await sleep(900);
const gRect = await evaluate(`(() => { const r = document.querySelector('#main-navigation-mobile a[href="gallery"]').getBoundingClientRect();
  return [r.left + 20, r.top + r.height / 2]; })()`);
await tap(gRect[0], gRect[1]);
check(await waitFor(`location.pathname === '/gallery' && document.readyState === 'complete'`, 8000),
  'GALLERY in the mobile menu lands on /gallery', 'the mobile menu link did not navigate');
check(await waitFor(IDLE, 3000), 'the curtain is idle after arriving from the menu', 'curtain stuck after menu nav');
check(await evaluate(`!document.documentElement.classList.contains('menu-open')`),
  'the arriving page has its menu closed', 'menu arrived open');

/* --- cross-page navigation from every page, and back ---------------------- */
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await viewport(w, h, mobile);
  for (const from of PAGES) {
    for (const to of ['gallery', 'reservation']) {
      if (from === to) continue;
      await goto(BASE + '/' + from);
      const t0 = Date.now();
      const navSel = mobile ? '#main-navigation-mobile' : '#main-navigation';
      await evaluate(`document.querySelector('${navSel} a[href="${to}"]').click()`);
      const landed = await waitFor(`location.pathname === '/${to}' && document.readyState === 'complete'`, 8000);
      const idle = landed && await waitFor(IDLE, 3000);
      const took = Date.now() - t0;
      check(landed && idle, `@${w} ${from} -> ${to} lands and the curtain ends idle (${took}ms incl. load)`,
        `@${w} ${from} -> ${to}: landed ${landed}, idle ${idle}`);
      check(took < 1600, `@${w} ${from} -> ${to} completes its transition in under 1.6s`,
        `@${w} ${from} -> ${to} took ${took}ms`);
      if (w === 1440 && from === 'home') {
        await evaluate('history.back()');
        const back = await waitFor(`location.pathname === '/home' && document.readyState === 'complete'`, 8000);
        await sleep(200);
        const idleBack = back && await waitFor(IDLE, 2000);
        const revealed = await evaluate(`!!document.querySelector('.page.is-revealed')`).catch(() => false);
        check(back && idleBack && revealed, `history.back() from ${to} shows home with no stuck curtain`,
          `after back from ${to}: back ${back}, idle ${idleBack}, revealed ${revealed}`);
      }
    }
  }
}

/* --- home#contact and home#intro, arriving from another page ---------------- */
await viewport(1440, 900);
for (const sec of ['contact', 'intro']) {
  await goto(BASE + '/gallery');
  await evaluate(`document.querySelector('#main-navigation a[href="home#${sec}"]').click()`);
  const landed = await waitFor(`location.pathname === '/home' && document.readyState === 'complete'`, 8000);
  const coveredOnArrival = landed && await evaluate(`/curtain-(cover|out)/.test(document.documentElement.className)`).catch(() => false);
  const idle = landed && await waitFor(IDLE, 3000);
  const st = await evaluate(`({ active: document.querySelector('.section.is-active').id, hash: location.hash,
    selected: [...document.querySelectorAll('#main-navigation li.selected a')].map(a => a.textContent) })`);
  check(landed && idle && st.active === sec && st.hash === '#' + sec,
    `GALLERY -> ${sec.toUpperCase()} arrives on home with #${sec} open`, `arrival on home#${sec}: ` + JSON.stringify({ landed, idle, st }));
  check(coveredOnArrival, `home#${sec} opens under the curtain, then uncovers (no jump)`,
    `home#${sec} was not covered on arrival`);
  check(JSON.stringify(st.selected) === JSON.stringify([sec.toUpperCase()]),
    `${sec.toUpperCase()} is marked as the current item`, 'selected items: ' + JSON.stringify(st.selected));
}

/* --- the gallery: empty state, and the composition with photographs ------- */

const fakePhotos = (n) => `Array.from({ length: ${n} }, (_, i) => ({
  src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="hsl(' + (i * 45) + ',0%,' + (20 + i * 8) + '%)"/><text x="450" y="640" font-size="200" text-anchor="middle" fill="#fff">' + (i + 1) + '</text></svg>'),
  alt: 'test photograph ' + (i + 1) }))`;

for (const [w, h, mobile] of [[1440, 900, false], [1024, 768, false], [768, 1024, false], [390, 844, true], [360, 740, true]]) {
  await viewport(w, h, mobile);
  await goto(BASE + '/gallery');
  const ready = await waitFor(`document.getElementById('collections').classList.contains('is-ready')`, 12000);
  await sleep(600);
  const g = await evaluate(`(() => {
    const s = document.getElementById('collections');
    const frag = document.querySelector('.collections-block.is-current .collections-fragments');
    const imgs = [...document.querySelectorAll('#collections img')];
    return { empty: s.classList.contains('is-empty'),
      title: frag && frag.querySelector('.frag__t').textContent, body: frag && frag.querySelector('.frag__p').textContent,
      fragOpacity: getComputedStyle(document.querySelector('#collections .content')).opacity,
      imgs: imgs.length, broken: imgs.filter(i => !(i.complete && i.naturalWidth > 0)).length,
      switcher: !document.getElementById('collections-nav').hidden,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  const L = 'gallery @' + w + 'x' + h;
  check(ready && g.empty && g.title === 'GALLERY' && g.body === 'New work is on its way.' && g.fragOpacity === '1',
    L + ': empty state reads GALLERY / New work is on its way.', L + ': empty state wrong ' + JSON.stringify({ ready, g }));
  check(g.imgs === 0 && g.broken === 0 && !g.switcher, L + ': no image frames and no page switcher when empty',
    L + ': stray frames or switcher ' + JSON.stringify(g));
  check(g.overflow <= 0, L + ': no horizontal overflow', L + ': overflows by ' + g.overflow);
  if (w === 1440 || w === 390) await shot((mobile ? 'm' : 'd') + '-gallery-empty');

  /* Nine test photographs through the page's own renderer: two pages. */
  await evaluate(`window.UchiGallery.render(${fakePhotos(9)})`);
  await sleep(900);
  const c = await evaluate(`(() => {
    const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
    const hit = (a, b) => a.w > 0 && b.w > 0 && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const cur = document.querySelector('.collections-block.is-current');
    const items = [...document.querySelectorAll('.collections-block' + (${mobile} ? '' : '.is-current') + ' .item')];
    const head = R(document.querySelector('.head')), nav = R(document.getElementById('main-navigation'));
    const burger = R(document.getElementById('ico-nav')), sw = R(document.getElementById('collections-nav'));
    const frag = R(cur.querySelector('.collections-fragments'));
    const clashes = [];
    items.forEach(it => {
      const r = R(it);
      if (hit(r, head)) clashes.push(it.id + ' x header');
      if (hit(r, nav)) clashes.push(it.id + ' x nav');
      if (hit(r, sw)) clashes.push(it.id + ' x switcher');
      if (!${mobile} && hit(r, frag)) clashes.push(it.id + ' x text');
    });
    if (hit(frag, head)) clashes.push('text x header');
    if (hit(frag, nav)) clashes.push('text x nav');
    if (hit(burger, head)) clashes.push('burger x header');
    return { pages: document.querySelectorAll('.collections-block').length, onPage: cur.querySelectorAll('.item').length,
      loaded: items.filter(i => i.classList.contains('is-loaded')).length, items: items.length,
      buttons: [...document.querySelectorAll('#collections-nav button')].map(b => b.textContent),
      switcherShown: getComputedStyle(document.getElementById('collections-nav')).display !== 'none',
      clashes, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      alts: items.every(i => /test photograph/.test(i.querySelector('img').alt)),
      lazy: items.every(i => i.querySelector('img').loading === 'lazy' && i.querySelector('img').decoding === 'async') };
  })()`);
  check(c.pages === 2 && c.onPage === 6, L + ': nine photographs make two pages, six on the first',
    L + ': pagination wrong ' + JSON.stringify(c));
  check(c.alts && c.lazy, L + ': alt text carried through, images lazy + async', L + ': alt/lazy wrong');
  check(mobile ? !c.switcherShown : (c.switcherShown && JSON.stringify(c.buttons) === '["1","2"]'),
    L + ': page switcher ' + (mobile ? 'hidden on the stacked phone layout' : 'shows 1 2'),
    L + ': switcher state ' + JSON.stringify(c));
  check(c.clashes.length === 0, L + ': photographs clear the logo, nav, switcher and text block',
    L + ': overlaps ' + JSON.stringify(c.clashes));
  check(c.overflow <= 0, L + ': no horizontal overflow with photographs', L + ': overflows by ' + c.overflow);
  if (w === 1440 || w === 390) await shot((mobile ? 'm' : 'd') + '-gallery-collage');

  if (!mobile) {
    await evaluate(`document.querySelectorAll('#collections-nav button')[1].click()`);
    await sleep(250);
    const midSwitch = await evaluate(`[...document.querySelectorAll('.collections-block')].map(b => +getComputedStyle(b).opacity)`);
    await sleep(1700);
    const sw = await evaluate(`({ op: [...document.querySelectorAll('.collections-block')].map(b => getComputedStyle(b).opacity),
      vis: [...document.querySelectorAll('.collections-block')].map(b => getComputedStyle(b).visibility),
      sel: document.querySelector('#collections-nav .selected').textContent })`);
    check(midSwitch[0] > 0.05 && midSwitch[0] < 0.99,
      L + ': the page switch cross-fades (page 1 at opacity ' + midSwitch[0].toFixed(2) + ' mid-way)',
      L + ': the page switch jumped ' + JSON.stringify(midSwitch));
    check(JSON.stringify(sw.op) === '["0","1"]' && sw.vis[0] === 'hidden' && sw.sel === '2',
      L + ': switching to 2 settles on page 2', L + ': after switching ' + JSON.stringify(sw));
    if (w === 1440) await shot('d-gallery-page2');
  }
}

/* --- every page, every viewport: overflow, overlap, targets, focus ring ---- */
const MAIN = { home: '#home .figure', gallery: '.collections-block.is-current .collections-fragments', reservation: '#reservation-box' };
for (const [w, h, mobile] of [[1440, 900, false], [1024, 768, false], [768, 1024, false], [390, 844, true], [360, 740, true]]) {
  await viewport(w, h, mobile);
  for (const p of PAGES) {
    await goto(BASE + '/' + p);
    const r = await evaluate(`(() => {
      const R = s => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const hit = (a, b) => !!a && !!b && a.w > 0 && b.w > 0 && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const head = R('.head'), nav = R('#main-navigation'), burger = R('#ico-nav'), main = R(${JSON.stringify(MAIN[p])});
      const clashes = [];
      if (hit(head, nav)) clashes.push('header x nav');
      if (hit(head, main)) clashes.push('header x content');
      if (hit(nav, main)) clashes.push('nav x content');
      if (hit(burger, head)) clashes.push('burger x header');
      if (hit(burger, main)) clashes.push('burger x content');
      return { clashes, main: !!main, burger,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    const L = p + ' @' + w + 'x' + h;
    if (w === 1440 || w === 390) await shot('vp-' + p + '-' + w);
    check(r.main && r.clashes.length === 0, L + ': logo, nav and content do not overlap',
      L + ': overlap ' + JSON.stringify(r));
    check(r.overflow <= 0, L + ': no horizontal overflow', L + ': overflows by ' + r.overflow);
    if (mobile) {
      check(r.burger.w >= 40 && r.burger.h >= 40, L + ': burger is a ' + r.burger.w + 'x' + r.burger.h + ' target',
        L + ': burger only ' + r.burger.w + 'x' + r.burger.h);
    }
  }
}

await viewport(1440, 900);
await goto(BASE + '/gallery');
await key('Tab', 'Tab', { vk: 9 });
const ring = await evaluate(`(() => { const a = document.activeElement; const cs = getComputedStyle(a);
  return { tag: a.tagName, style: cs.outlineStyle, width: cs.outlineWidth, fv: a.matches(':focus-visible') }; })()`);
check(ring.fv && ring.style !== 'none' && parseFloat(ring.width) >= 1,
  'keyboard focus draws a visible focus ring (' + ring.style + ' ' + ring.width + ' on ' + ring.tag + ')',
  'no visible focus ring: ' + JSON.stringify(ring));

check(consoleErrors.length === 0, 'no console errors on the gallery page', 'console errors: ' + JSON.stringify(consoleErrors));

await viewport(1440, 900);

/* =================================================== the booking page === */
await goto(BASE + '/reservation');
await shot('d-reservation');

check(await evaluate(`!!document.querySelector('#booking.is-live')`),
  'the booking interface took over the page', 'the booking UI did not mount');
check(await evaluate(`document.querySelectorAll('#booking .step').length === 5`),
  'all five booking steps are present',
  'steps found: ' + await evaluate(`document.querySelectorAll('#booking .step').length`));
check(badResponses.length === 0, 'reservation page loads every asset',
  'failed requests: ' + JSON.stringify(badResponses));

/* Every price on the page must equal the price in the data. */
const prices = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.step[data-step="2"] .item--pick')].map(b => [
    b.querySelector('.desc').textContent.trim(), b.querySelector('.value').textContent.trim()]);
  const data = SHOP.services.map(s => [s.name, BookingCore.priceLabel(s)]);
  return { rows, data };
})()`);
check(JSON.stringify(prices.rows) === JSON.stringify(prices.data),
  'all 8 services are listed with the price beside each option',
  'service list differs from the data:\n     ' + JSON.stringify(prices.rows));
check(prices.rows.length === 8, '8 services shown', prices.rows.length + ' services shown');
check(prices.rows.some(r => r[1] === 'from 160'),
  'balayage shows as a "from" price, not a fixed one',
  'balayage price label is wrong: ' + JSON.stringify(prices.rows.find(r => /Balayage/.test(r[0]))));
check(prices.rows.some(r => r[1] === '7.50'), 'the 7.50 wash keeps its cents',
  'wash price is ' + JSON.stringify(prices.rows.find(r => /Wash$/.test(r[0]))));

/* --- nothing on the page sits on top of anything else ------------------ */

/*
  The booking column is centred in the viewport while the footer is absolutely
  positioned at the bottom of it, so a short service list leaves the two free
  to occupy the same pixels. Nothing overflows and nothing is clipped when that
  happens - the text simply prints over the address - which is why neither of
  those checks caught it when the list went from twelve rows to eight.
*/
async function overlaps(a, b) {
  return await evaluate(`(() => {
    const A = document.querySelector(${JSON.stringify(a)});
    const B = document.querySelector(${JSON.stringify(b)});
    if (!A || !B) return { missing: true };
    const x = A.getBoundingClientRect(), y = B.getBoundingClientRect();
    const hit = x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
    return { hit, a: [Math.round(x.top), Math.round(x.bottom)],
             b: [Math.round(y.top), Math.round(y.bottom)] };
  })()`);
}

for (const [a, b, label] of [
  ['#reservation-box', '#main-footer', 'the booking column and the footer'],
  ['.reserve-fallback', '#main-footer', 'the fallback line and the footer'],
  ['#reservation-box', '.head', 'the booking column and the wordmark']
]) {
  const r = await overlaps(a, b);
  check(!r.missing && r.hit === false,
    label + ' do not overlap',
    label + ' overlap: ' + JSON.stringify(r));
}

/* --- the exclusion, both directions, in the live DOM ------------------- */
/* Donovan does everything; Labi does the cut, the wash and the blow-dry. */
const DONOVAN_ONLY = ['highlights', 'balayage', 'roots', 'kleuring', 'toner'];

/* Direction 1: choose Labi, the four colour services must go dead. */
await click('.step[data-step="1"] .item--pick:nth-of-type(1)');
const afterLabi = await evaluate(`(() => {
  const out = {};
  SHOP.services.forEach((s, i) => {
    const b = document.querySelectorAll('.step[data-step="2"] .item--pick')[i];
    out[s.id] = { off: b.classList.contains('is-off'), disabled: b.disabled };
  });
  return { services: out, picked: document.querySelector('.step[data-step="1"] .is-picked')
    ?.querySelector('.desc').textContent.trim() };
})()`);
check(afterLabi.picked === 'LABI', 'LABI can be selected', 'LABI did not select');
check(DONOVAN_ONLY.every(id => afterLabi.services[id].off && afterLabi.services[id].disabled),
  'choosing LABI disables the four colour processes and the toner',
  'exclusion failed: ' + JSON.stringify(DONOVAN_ONLY.map(id => [id, afterLabi.services[id]])));
check(Object.entries(afterLabi.services)
  .filter(([id]) => !DONOVAN_ONLY.includes(id)).every(([, v]) => !v.off),
  'choosing LABI leaves the cut, the wash and the blow-dry selectable',
  'too much was disabled: ' + JSON.stringify(afterLabi.services));
await shot('d-booking-labi');

/* A disabled row must actually refuse the click, not merely look grey. */
const balayageIdx = await evaluate(`SHOP.services.findIndex(s => s.id === 'balayage')`);
await click(`.step[data-step="2"] .item--pick:nth-of-type(${balayageIdx + 1})`, 300);
check(await evaluate(`!document.querySelector('.step[data-step="2"] .is-picked')`),
  'a disabled service cannot be clicked into selection',
  'a disabled service was selectable');

/* Direction 2: clear Labi, pick balayage, Labi must go dead. */
await click('.step[data-step="1"] .item--pick:nth-of-type(1)');   // deselect
await click(`.step[data-step="2"] .item--pick:nth-of-type(${balayageIdx + 1})`);
const afterBalayage = await evaluate(`(() => {
  const st = [...document.querySelectorAll('.step[data-step="1"] .item--pick')];
  return { labiOff: st[0].classList.contains('is-off') && st[0].disabled,
           donovanOff: st[1].classList.contains('is-off'),
           donovanPicked: st[1].classList.contains('is-picked'),
           servicePicked: document.querySelector('.step[data-step="2"] .is-picked')
             ?.querySelector('.desc').textContent.trim() };
})()`);
check(afterBalayage.servicePicked === 'Balayage', 'balayage can be selected',
  'balayage did not select: ' + JSON.stringify(afterBalayage));
check(afterBalayage.labiOff, 'choosing balayage disables LABI',
  'LABI was not disabled by balayage: ' + JSON.stringify(afterBalayage));
check(!afterBalayage.donovanOff, 'DONOVAN stays available for balayage',
  'DONOVAN was wrongly disabled');
check(afterBalayage.donovanPicked,
  'the only stylist who can do it is selected automatically',
  'DONOVAN was not auto-selected for a Donovan-only service');

/* --- several services in one booking ----------------------------------- */

/*
  With balayage already chosen (Donovan, 180 min), add a cut. They are in
  different groups so they combine; both are Donovan's so he stays valid.
*/
const cutIdx = await evaluate(`SHOP.services.findIndex(s => s.id === 'knippen')`);
await click(`.step[data-step="2"] .item--pick:nth-of-type(${cutIdx + 1})`);
const multi = await evaluate(`(() => {
  const picked = [...document.querySelectorAll('.step[data-step="2"] .is-picked')]
    .map(b => b.querySelector('.desc').textContent.trim());
  const off = [...document.querySelectorAll('.step[data-step="2"] .item--pick')]
    .filter(b => b.classList.contains('is-off'))
    .map(b => b.querySelector('.desc').textContent.trim());
  return { picked, off, total: document.getElementById('svc-total').textContent.trim(),
    times: [...document.querySelectorAll('.step[data-step="4"] .chip--time')].length };
})()`);
check(multi.picked.length === 2 && multi.picked.includes('Balayage')
      && multi.picked.includes('Cuts'),
  'a cut and a colour can be booked together',
  'selection is ' + JSON.stringify(multi.picked));
check(multi.off.includes('Highlights') && multi.off.includes('Roots')
      && multi.off.includes('Colour'),
  'the other three colour processes go dead — one colour per visit',
  'other colour services were not excluded: ' + JSON.stringify(multi.off));
check(!multi.off.includes('Wash') && !multi.off.includes('Blow dry')
      && !multi.off.includes('Toner'),
  'the wash, the blow-dry and the toner remain addable on top',
  'something combinable was wrongly excluded: ' + JSON.stringify(multi.off));
/* 160 (from) + 35 (from) = 195, quoted as a floor because both halves can move. */
check(/from 195/.test(multi.total) && /225 minutes/.test(multi.total),
  'the running total sums the prices and the time (' + multi.total + ')',
  'total reads: ' + multi.total);
await shot('d-booking-multi');

/* Removing the cut must restore what it excluded. */
await click(`.step[data-step="2"] .item--pick:nth-of-type(${cutIdx + 1})`);
const afterRemove = await evaluate(`(() => ({
  picked: [...document.querySelectorAll('.step[data-step="2"] .is-picked')]
    .map(b => b.querySelector('.desc').textContent.trim()),
  off: [...document.querySelectorAll('.step[data-step="2"] .item--pick')]
    .filter(b => b.classList.contains('is-off'))
    .map(b => b.querySelector('.desc').textContent.trim())
}))()`);
/* Balayage alone: the three other colour processes stay excluded, the cut does
   not — removing the cut has to give the cut back. */
check(JSON.stringify(afterRemove.picked) === JSON.stringify(['Balayage'])
      && !afterRemove.off.includes('Cuts'),
  'removing a service releases everything it was excluding',
  'after removal: ' + JSON.stringify(afterRemove));

/* --- days and times ---------------------------------------------------- */
const step3 = await evaluate(`(() => {
  const s = document.querySelector('.step[data-step="3"]');
  const chips = [...s.querySelectorAll('.chip--day')].map(c => c.textContent.trim());
  return { open: s.classList.contains('is-open'), chips,
           dows: [...s.querySelectorAll('.chip__dow')].map(n => n.textContent) };
})()`);
check(step3.open, 'choosing a service opens the day step', 'the day step stayed shut');
check(step3.chips.length > 0, step3.chips.length + ' bookable days offered', 'no days offered');
check(!step3.dows.includes('SAT') && !step3.dows.includes('SUN'),
  'no Saturday or Sunday is ever offered',
  'a weekend day was offered: ' + JSON.stringify(step3.dows));

await click('.step[data-step="3"] .chip--day:nth-of-type(1)', 500);
const step4 = await evaluate(`(() => {
  const s = document.querySelector('.step[data-step="4"]');
  const times = [...s.querySelectorAll('.chip--time')].map(c => c.textContent.trim());
  const sv = SHOP.services.find(x => x.id === 'balayage');
  return { open: s.classList.contains('is-open'), times, minutes: sv.minutes };
})()`);
check(step4.open, 'choosing a day opens the time step', 'the time step stayed shut');
check(step4.times.length > 0, step4.times.length + ' start times offered for a 180-minute balayage',
  'no times offered');
/* The break and the closing time, checked on what is actually on screen. */
const bad = step4.times.filter(t => {
  const [h, m] = t.split(':').map(Number); const s = h * 60 + m;
  return (s < 900 && s + step4.minutes > 840) || (s + step4.minutes > 1320) || (s < 600);
});
check(bad.length === 0,
  'every offered time respects the 14:00-15:00 break and the 22:00 close',
  'these offered times are impossible: ' + JSON.stringify(bad));
check(!step4.times.includes('13:00'),
  'a 180-minute service is not offered at 13:00, which would run through the break',
  '13:00 was offered for a 3-hour service');

await click('.step[data-step="4"] .chip--time:nth-of-type(1)', 500);
const step5 = await evaluate(`(() => {
  const s = document.querySelector('.step[data-step="5"]');
  return { open: s.classList.contains('is-open'),
           summary: s.querySelector('.bsummary').textContent.trim(),
           fields: [...s.querySelectorAll('.bfield input, .bfield textarea')].map(i => i.name),
           note: s.querySelector('.bnote').textContent.trim() };
})()`);
check(step5.open, 'choosing a time opens the details step', 'the details step stayed shut');
check(JSON.stringify(step5.fields) === JSON.stringify(['name', 'email', 'phone', 'notes']),
  'the details form asks for name, e-mail, phone and notes',
  'form fields are ' + JSON.stringify(step5.fields));
check(/Balayage/.test(step5.summary) && /from 160/.test(step5.summary)
      && /DONOVAN/.test(step5.summary),
  'the summary states the service, the price and the stylist',
  'summary reads: ' + step5.summary);
check(step5.note.length > 20, 'the form says what pressing the button will do',
  'no explanatory note under the submit button');
await shot('d-booking-full');

/* --- nothing on the rendered page names a gender ----------------------- */

/*
  The unit suite greps the source files. This checks what a visitor actually
  sees: the full rendered text of the booking page, every button label, and the
  title attributes that explain a disabled row - a place a gendered word could
  hide without ever appearing in the visible copy.
*/
const genderless = await evaluate(`(() => {
  const banned = /\\b(heren|dames|men'?s|women'?s|men|women|man|woman|ladies|gents|male|female)\\b/i;
  const hits = [];
  if (banned.test(document.body.innerText)) {
    document.body.innerText.split('\\n').forEach(l => { if (banned.test(l)) hits.push('text: ' + l.trim()); });
  }
  document.querySelectorAll('[title]').forEach(n => {
    if (banned.test(n.title)) hits.push('title: ' + n.title);
  });
  document.querySelectorAll('img[alt], [aria-label]').forEach(n => {
    const v = n.getAttribute('alt') || n.getAttribute('aria-label') || '';
    if (banned.test(v)) hits.push('label: ' + v);
  });
  return hits;
})()`);
check(genderless.length === 0,
  'nothing on the rendered booking page names a gender',
  'gendered wording on the page: ' + JSON.stringify(genderless));

const cutRows = await evaluate(`[...document.querySelectorAll('.step[data-step="2"] .item--pick')]
  .map(b => [b.querySelector('.desc').textContent.trim(), b.querySelector('.value').textContent.trim()])
  .filter(r => /^Cut/.test(r[0]))`);
check(JSON.stringify(cutRows) === JSON.stringify([['Cuts', 'from 35']]),
  'there is one cutting row and it reads Cuts / from 35',
  'cutting rows are ' + JSON.stringify(cutRows));

/* The whole list, against the data, in order. */
const wholeList = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.step[data-step="2"] .item--pick')]
    .map(b => [b.querySelector('.desc').textContent.trim(),
               b.querySelector('.value').textContent.trim()]);
  return { rows, data: SHOP.services.map(s => [s.name, BookingCore.priceLabel(s)]) };
})()`);
check(JSON.stringify(wholeList.rows) === JSON.stringify([
        ['Cuts', 'from 35'], ['Blow dry', 'from 35'], ['Wash', '7.50'],
        ['Highlights', 'from 60'], ['Balayage', 'from 160'], ['Roots', 'from 50'],
        ['Colour', 'from 50'], ['Toner', 'from 45']]),
  'the eight prices on the page are the eight the owner gave',
  'the list reads ' + JSON.stringify(wholeList.rows));

/* Both stylists are titled the same, with no hierarchy implied. */
const roles = await evaluate(`[...document.querySelectorAll('.step[data-step="1"] .item--pick')]
  .map(b => [b.querySelector('.desc').textContent.trim(),
             b.querySelector('.value').textContent.trim()])`);
check(JSON.stringify(roles) === JSON.stringify([['LABI', 'Hairstylist'], ['DONOVAN', 'Hairstylist']]),
  'both stylists are listed as Hairstylist',
  'stylist rows are ' + JSON.stringify(roles));

/* The form must refuse to submit empty. */
const guarded = await evaluate(`(() => {
  const f = document.querySelector('.bform');
  f.querySelector('[name=name]').value = '';
  return f.checkValidity() === false;
})()`);
check(guarded, 'the form will not submit without a name', 'the form submits empty');

check(consoleErrors.length === 0, 'no console errors through the whole booking flow',
  'console errors: ' + JSON.stringify(consoleErrors));

/* ------------------------------------------------------------ mobile ---- */
await viewport(390, 844, true);
await goto(BASE + '/home');

for (const id of ['home', 'intro', 'contact']) {
  await click('#ico-nav', 700);
  await click(`#main-navigation-mobile [data-sec="${id}"]`, 1300);
  const s = await evaluate(`(() => {
    const n = document.getElementById(${JSON.stringify(id)});
    return { active: n.classList.contains('is-active'),
             h: Math.round(n.getBoundingClientRect().height),
             menuOpen: document.documentElement.classList.contains('menu-open'),
             overflow: document.documentElement.scrollWidth - 390 };
  })()`);
  check(s.active && s.h > 40, `mobile #${id} renders (${s.h}px)`,
    `mobile #${id} failed: ${JSON.stringify(s)}`);
  check(!s.menuOpen, `mobile menu closes after choosing ${id}`, `menu stayed open on ${id}`);
  check(s.overflow <= 0, `mobile #${id} has no horizontal overflow`,
    `mobile #${id} overflows by ${s.overflow}px`);
}
await shot('m-contact');

/*
  On a phone the contact box is full width, so anything centred in it sits on
  the rule. The break legend did exactly that - the rule struck through the
  middle of the sentence - and no overflow or clipping check notices a line
  drawn through text.
*/
const legendHit = await evaluate(`(() => {
  const l = document.getElementById('hours-break'), r = document.querySelector('#contact .rule');
  const a = l.getBoundingClientRect(), b = r.getBoundingClientRect();
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
})()`);
check(!legendHit, 'on a phone the centre rule does not run through the break legend',
  'the centre rule strikes through the break legend on mobile');

/* The longest value on the site is @DONOVANHAIRDRESSER. Check it on the
   narrowest common phone width too, not just 390. */
for (const w of [390, 360]) {
  await viewport(w, 780, true);
  await goto(BASE + '/home#contact');
  const fit = await evaluate(`(() => {
    const vw = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('#contact .value, #contact .desc, #contact .legend, #contact a')]
      .filter(n => n.getBoundingClientRect().right > vw + 0.5)
      .map(n => n.textContent.trim().slice(0, 30));
    return { out, overflow: document.documentElement.scrollWidth - vw };
  })()`);
  check(fit.out.length === 0 && fit.overflow <= 0,
    'every contact line, including @DONOVANHAIRDRESSER, fits at ' + w + 'px',
    'contact overflows at ' + w + 'px: ' + JSON.stringify(fit));
}
await viewport(390, 844, true);

const mLogo = await evaluate(`(() => { const r = document.querySelector('.head__mark img')
  .getBoundingClientRect(); return { w: Math.round(r.width), right: Math.round(r.right) }; })()`);
check(mLogo.w >= 110, 'the wordmark stays legible on a phone (' + mLogo.w + 'px)',
  'wordmark is only ' + mLogo.w + 'px on mobile');
check(mLogo.right <= 390, 'the wordmark does not run off the right edge',
  'wordmark right edge is at ' + mLogo.right + ' of 390');

/* The booking page on a phone. */
await goto(BASE + '/reservation');
const mBooking = await evaluate(`(() => ({
  live: !!document.querySelector('#booking.is-live'),
  overflow: document.documentElement.scrollWidth - 390,
  rows: document.querySelectorAll('.step[data-step="2"] .item--pick').length
}))()`);
check(mBooking.live, 'the booking interface mounts on mobile', 'booking UI missing on mobile');
check(mBooking.overflow <= 0, 'the booking page has no horizontal overflow at 390px',
  'booking page overflows by ' + mBooking.overflow + 'px');
check(mBooking.rows === 8, 'all 8 services are reachable on mobile',
  mBooking.rows + ' services on mobile');

await click('.step[data-step="1"] .item--pick:nth-of-type(1)', 400);
check(await evaluate(`document.querySelectorAll('.step[data-step="2"] .item--pick.is-off').length === 5`),
  'the exclusion works on mobile as well',
  'mobile exclusion disabled '
  + await evaluate(`document.querySelectorAll('.step[data-step="2"] .item--pick.is-off').length`)
  + ' services, expected 5');
await shot('m-booking');

/* -------------------------------------------------------- no-script ----- */

/*
  With page scripts disabled, nothing in the document can resolve a promise, so
  the usual readyState wait would never return - it is the page that would have
  to answer. Wait on Page.loadEventFired, which comes from the browser rather
  than from the document. Runtime.evaluate still works: it is the protocol
  evaluating, not the page.
*/
await send('Emulation.setScriptExecutionDisabled', { value: true });
await viewport(1440, 900);

const loaded = new Promise((resolve) => {
  const onMessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Page.loadEventFired') { ws.removeEventListener('message', onMessage); resolve(); }
  };
  ws.addEventListener('message', onMessage);
});
await send('Page.navigate', { url: BASE + '/reservation' });
await Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]);

const noJs = await evaluate(`document.querySelectorAll('#booking .item').length + '|'
  + /10:00-22:00/.test(document.body.innerText) + '|'
  + /from 35/.test(document.body.innerText) + '|'
  + !!document.querySelector('#booking.is-live')`);
const [rowCount, hasHours, hasPrice, wentLive] = String(noJs).split('|');

check(Number(rowCount) === 10,
  'without JavaScript all 8 prices and the 2 hours rows are still there',
  'no-JS fallback has ' + rowCount + ' rows, expected 10');
check(hasHours === 'true' && hasPrice === 'true',
  'the no-JavaScript page still states the hours and the prices',
  'no-JS fallback lost the hours or the prices');
check(wentLive === 'false',
  'and the interactive booking correctly did not mount',
  'the booking UI claims to be live with scripts disabled');

await send('Emulation.setScriptExecutionDisabled', { value: false });

/* ====================================================================== */
ws.close(); chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});

if (fail.length) {
  console.error('\n' + fail.length + ' FAILED:\n' + fail.map(f => '  x  ' + f).join('\n'));
  process.exit(1);
}
console.log('\nall ' + pass.length + ' checks passed against ' + BASE);
