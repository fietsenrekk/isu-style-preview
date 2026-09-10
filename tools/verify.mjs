#!/usr/bin/env node
/*
  End-to-end verification for the JILL SCUTT preview.

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

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
  await new Promise(r => setTimeout(r, 2400));   // clear of the 1.55s reveal
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
await goto(BASE + '/');

check(await evaluate(`document.title.includes('JILL SCUTT')`),
  'page is branded JILL SCUTT', 'title is not JILL SCUTT');

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
check(logo && Math.abs((logo.w / logo.h) - 9.093) < 0.35,
  'wordmark keeps its 9.09:1 proportion (' + (logo && (logo.w / logo.h).toFixed(2)) + ')',
  'wordmark is distorted: ' + JSON.stringify(logo));
check(logo && logo.w >= 240, 'wordmark is legible at ' + (logo && logo.w) + 'px wide',
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
check(JSON.stringify(navText) === JSON.stringify(['INTRO', 'CONTACT', 'RESERVATION']),
  'desktop nav reads INTRO / CONTACT / RESERVATION',
  'desktop nav is ' + JSON.stringify(navText));
check(!navText.some(t => /PRICES/i.test(t)), 'PRICES is gone from the nav',
  'PRICES still in the nav');
check(!navText.some(t => /MAKE A/i.test(t)), '"MAKE A RESERVATION" is now "RESERVATION"',
  'nav still says MAKE A RESERVATION');
check(await evaluate(`!document.getElementById('prices')`),
  'the prices section is gone from the page', 'a #prices section is still present');

/* Each section renders and nothing overflows. */
for (const id of ['home', 'intro', 'contact']) {
  if (id !== 'home') await click(`#main-navigation [data-sec="${id}"]`, 900);
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
check(JSON.stringify(hours.rows[0]) === JSON.stringify(['MON — FRI', '10:00-22:00']),
  'Monday to Friday is one row reading 10:00-22:00',
  'weekday row is ' + JSON.stringify(hours.rows[0]));
check(JSON.stringify(hours.rows[1]) === JSON.stringify(['SAT — SUN', '/']),
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

/* ------------------------------------------------- the two-photo hero --- */
await click('#main-navigation [data-sec="intro"]', 900);
await goto(BASE + '/');
const swap0 = await evaluate(`(() => {
  const on = document.querySelector('.shot.is-on img');
  return { src: on.currentSrc, idx: [...document.querySelectorAll('.shot')]
    .findIndex(s => s.classList.contains('is-on')) };
})()`);
await click('.figure__swap', 1000);
const swap1 = await evaluate(`(() => {
  const on = document.querySelector('.shot.is-on img');
  const r = on.getBoundingClientRect();
  return { src: on.currentSrc, idx: [...document.querySelectorAll('.shot')]
    .findIndex(s => s.classList.contains('is-on')),
    complete: on.complete, nat: on.naturalWidth + 'x' + on.naturalHeight,
    w: Math.round(r.width), h: Math.round(r.height),
    op: getComputedStyle(on.closest('.shot')).opacity };
})()`);
check(swap1.idx === 1 && swap1.src !== swap0.src,
  'tapping the photograph swaps to the second one',
  'the photo did not swap: ' + JSON.stringify({ swap0, swap1 }));
check(swap1.complete && swap1.nat !== '0x0',
  'the second photograph loaded (' + swap1.nat + ')',
  'second photograph failed to load: ' + JSON.stringify(swap1));
check(swap1.op === '1', 'the second photograph is fully faded in',
  'second photo opacity is ' + swap1.op);
await shot('d-home-photo2');

/* The frames must be identical, or the swap would jump the layout. */
const frame0 = await evaluate(`(() => { const r = document.querySelectorAll('.shot')[0]
  .getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
check(frame0[0] === swap1.w && frame0[1] === swap1.h,
  'both photographs occupy the identical frame — no layout shift on swap',
  'frames differ: ' + JSON.stringify(frame0) + ' vs ' + JSON.stringify([swap1.w, swap1.h]));

await click('.figure__swap', 1000);
check(await evaluate(`[...document.querySelectorAll('.shot')]
  .findIndex(s => s.classList.contains('is-on')) === 0`),
  'tapping again returns to the first photograph', 'the swap does not cycle back');

check(await evaluate(`getComputedStyle(document.querySelector('.shot')).transition.includes('opacity')`),
  'the swap is an eased cross-fade, not a cut', 'the photo swap has no transition');

/* =================================================== the booking page === */
await goto(BASE + '/reservation.html');
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
  'all 11 services are listed with the price beside each option',
  'service list differs from the data:\n     ' + JSON.stringify(prices.rows));
check(prices.rows.length === 11, '11 services shown', prices.rows.length + ' services shown');
check(prices.rows.some(r => r[1] === 'from 160'),
  'balayage shows as a "from" price, not a fixed one',
  'balayage price label is wrong: ' + JSON.stringify(prices.rows.find(r => /Balayage/.test(r[0]))));
check(prices.rows.some(r => r[1] === '7.50'), 'the 7.50 wash keeps its cents',
  'wash price is ' + JSON.stringify(prices.rows.find(r => /Wash$/.test(r[0]))));

/* --- the exclusion, both directions, in the live DOM ------------------- */
const DONOVAN_ONLY = ['half-head-highlights', 'full-head-highlights', 'balayage',
                      'toner', 'uitgroei', 'uitgroei-lengtes'];

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
  'choosing LABI disables all six colour services',
  'exclusion failed: ' + JSON.stringify(DONOVAN_ONLY.map(id => [id, afterLabi.services[id]])));
check(Object.entries(afterLabi.services)
  .filter(([id]) => !DONOVAN_ONLY.includes(id)).every(([, v]) => !v.off),
  'choosing LABI leaves her other 6 services selectable',
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
      && multi.picked.includes('Cut'),
  'a cut and a colour can be booked together',
  'selection is ' + JSON.stringify(multi.picked));
check(multi.off.includes('Cut + dry') && multi.off.includes('Cut + blow-dry'),
  'the other two cutting options go dead — a cut is a cut, not three',
  'other cuts were not excluded: ' + JSON.stringify(multi.off));
check(multi.off.includes('Full-head highlights') && multi.off.includes('Regrowth colour'),
  'the other colour processes go dead too — one colour per visit',
  'other colour services were not excluded: ' + JSON.stringify(multi.off));
check(!multi.off.includes('Wash') && !multi.off.includes('Toner'),
  'a wash and a toner remain addable on top',
  'wash or toner was wrongly excluded: ' + JSON.stringify(multi.off));
/* 160 (from) + 35 (from) = 195, quoted as a floor because both halves can move. */
check(/from 195/.test(multi.total) && /225 minutes/.test(multi.total),
  'the running total sums the prices and the time (' + multi.total + ')',
  'total reads: ' + multi.total);
await shot('d-booking-multi');

/* Removing the cut must restore what it excluded. */
await click(`.step[data-step="2"] .item--pick:nth-of-type(${cutIdx + 1})`);
const afterRemove = await evaluate(`(() => ({
  picked: document.querySelectorAll('.step[data-step="2"] .is-picked').length,
  cutsOff: [...document.querySelectorAll('.step[data-step="2"] .item--pick')]
    .filter(b => b.classList.contains('is-off'))
    .map(b => b.querySelector('.desc').textContent.trim())
    .filter(t => /cut/i.test(t)).length
}))()`);
check(afterRemove.picked === 1 && afterRemove.cutsOff === 0,
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
check(JSON.stringify(cutRows) === JSON.stringify(
        [['Cut', 'from 35'], ['Cut + dry', '55'], ['Cut + blow-dry', '65']]),
  'the cutting list reads Cut from 35 / + dry 55 / + blow-dry 65',
  'cutting rows are ' + JSON.stringify(cutRows));

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
await goto(BASE + '/');

for (const id of ['home', 'intro', 'contact']) {
  await click('#ico-nav', 320);
  await click(`#main-navigation-mobile [data-sec="${id}"]`, 900);
  const s = await evaluate(`(() => {
    const n = document.getElementById(${JSON.stringify(id)});
    return { active: n.classList.contains('is-active'),
             h: Math.round(n.getBoundingClientRect().height),
             menuOpen: document.getElementById('main-navigation-mobile').classList.contains('open'),
             overflow: document.documentElement.scrollWidth - 390 };
  })()`);
  check(s.active && s.h > 40, `mobile #${id} renders (${s.h}px)`,
    `mobile #${id} failed: ${JSON.stringify(s)}`);
  check(!s.menuOpen, `mobile menu closes after choosing ${id}`, `menu stayed open on ${id}`);
  check(s.overflow <= 0, `mobile #${id} has no horizontal overflow`,
    `mobile #${id} overflows by ${s.overflow}px`);
}
await shot('m-contact');

const mLogo = await evaluate(`(() => { const r = document.querySelector('.head__mark img')
  .getBoundingClientRect(); return { w: Math.round(r.width), right: Math.round(r.right) }; })()`);
check(mLogo.w >= 150, 'the wordmark stays legible on a phone (' + mLogo.w + 'px)',
  'wordmark is only ' + mLogo.w + 'px on mobile');
check(mLogo.right <= 390, 'the wordmark does not run off the right edge',
  'wordmark right edge is at ' + mLogo.right + ' of 390');

await goto(BASE + '/');
await click('.figure__swap', 1000);
check(await evaluate(`[...document.querySelectorAll('.shot')]
  .findIndex(s => s.classList.contains('is-on')) === 1`),
  'the photo swap works on mobile too', 'the photo did not swap on mobile');
await shot('m-home-photo2');

/* The booking page on a phone. */
await goto(BASE + '/reservation.html');
const mBooking = await evaluate(`(() => ({
  live: !!document.querySelector('#booking.is-live'),
  overflow: document.documentElement.scrollWidth - 390,
  rows: document.querySelectorAll('.step[data-step="2"] .item--pick').length
}))()`);
check(mBooking.live, 'the booking interface mounts on mobile', 'booking UI missing on mobile');
check(mBooking.overflow <= 0, 'the booking page has no horizontal overflow at 390px',
  'booking page overflows by ' + mBooking.overflow + 'px');
check(mBooking.rows === 11, 'all 11 services are reachable on mobile',
  mBooking.rows + ' services on mobile');

await click('.step[data-step="1"] .item--pick:nth-of-type(1)', 400);
check(await evaluate(`document.querySelectorAll('.step[data-step="2"] .item--pick.is-off').length === 6`),
  'the exclusion works on mobile as well',
  'mobile exclusion disabled '
  + await evaluate(`document.querySelectorAll('.step[data-step="2"] .item--pick.is-off').length`)
  + ' services, expected 6');
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
await send('Page.navigate', { url: BASE + '/reservation.html' });
await Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]);

const noJs = await evaluate(`document.querySelectorAll('#booking .item').length + '|'
  + /10:00-22:00/.test(document.body.innerText) + '|'
  + /from 35/.test(document.body.innerText) + '|'
  + !!document.querySelector('#booking.is-live')`);
const [rowCount, hasHours, hasPrice, wentLive] = String(noJs).split('|');

check(Number(rowCount) === 13,
  'without JavaScript all 11 prices and the 2 hours rows are still there',
  'no-JS fallback has ' + rowCount + ' rows, expected 13');
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
