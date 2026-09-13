#!/usr/bin/env node
/*
  Unit tests for assets/booking-core.js.

  The slot calculator is the one piece of this site that can be quietly,
  plausibly wrong: it will always render *a* list of times, and a list of times
  looks correct no matter which ones are missing. So every case below was
  worked out by hand first and the expected count written down before the code
  was run.

  Run: node tools/booking-test.mjs
*/

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);

const Core = require(path.join(root, 'assets', 'booking-core.js'));

/* booking-data.js assigns to `window`, so give it one. */
const window = {};
new Function('window', readFileSync(path.join(root, 'assets', 'booking-data.js'), 'utf8'))(window);
const SHOP = window.SHOP;

let failed = 0, passed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.error('  FAIL ' + label + '\n         expected ' + e + '\n         actual   ' + a); }
}
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.error('  FAIL ' + label + (detail ? '\n         ' + detail : '')); }
}

/* Fixed reference dates. 2026-09-09 is a Wednesday; 12th Sat, 13th Sun. */
const WED = new Date(2026, 8, 9);
const SAT = new Date(2026, 8, 12);
const SUN = new Date(2026, 8, 13);
const MON = new Date(2026, 8, 14);

console.log('\ntime + money');
check('parseHM 10:00', Core.parseHM('10:00'), 600);
check('parseHM 22:00', Core.parseHM('22:00'), 1320);
ok('parseHM rejects junk', Number.isNaN(Core.parseHM('25:00')) && Number.isNaN(Core.parseHM('abc')));
check('formatHM 600', Core.formatHM(600), '10:00');
check('formatHM 1305', Core.formatHM(1305), '21:45');
check('money whole', Core.money(45), '45');
check('money fractional', Core.money(7.5), '7.50');
check('priceLabel from', Core.priceLabel({ price: 160, from: true }), 'from 160');
check('priceLabel fixed', Core.priceLabel({ price: 65, from: false }), '65');

console.log('\ndays open (Mon-Fri only)');
check('Wed open', Core.isOpenOn(SHOP, WED), true);
check('Mon open', Core.isOpenOn(SHOP, MON), true);
check('Sat closed', Core.isOpenOn(SHOP, SAT), false);
check('Sun closed', Core.isOpenOn(SHOP, SUN), false);
check('no slots on Sat', Core.slotsFor(SHOP, SAT, 30, null), []);
check('no slots on Sun', Core.slotsFor(SHOP, SUN, 30, null), []);

console.log('\nslots — 30 min service on a Wednesday');
/* Hand-worked: 10:00..21:30 at 15 min = 47 starts. The 14:00-15:00 break kills
   every start that would still be running at 14:00, i.e. 13:45 down to 13:30...
   precisely: t < 900 and t+30 > 840  =>  810 < t < 900  =>  13:45,14:00,14:15,
   14:30,14:45 = 5. 47 - 5 = 42. */
const s30 = Core.slotsFor(SHOP, WED, 30, null);
check('30min slot count', s30.length, 42);
check('30min first', s30[0], '10:00');
check('30min last', s30[s30.length - 1], '21:30');
ok('30min excludes the break window', !s30.includes('14:00') && !s30.includes('14:45') && !s30.includes('13:45'),
   'got ' + s30.slice(14, 22).join(','));
ok('30min keeps 13:30 (ends exactly at 14:00)', s30.includes('13:30'));
ok('30min keeps 15:00 (starts exactly at break end)', s30.includes('15:00'));

console.log('\nslots — 180 min balayage on a Wednesday');
/* Hand-worked: 10:00..19:00 = 37 starts. Overlap kills 660 < t < 900, i.e.
   11:15..14:45 = 15. 37 - 15 = 22, being 10:00-11:00 (5) and 15:00-19:00 (17). */
const s180 = Core.slotsFor(SHOP, WED, 180, null);
check('180min slot count', s180.length, 22);
check('180min first', s180[0], '10:00');
check('180min last', s180[s180.length - 1], '19:00');
ok('180min keeps 11:00 (ends exactly at 14:00)', s180.includes('11:00'));
ok('180min drops 11:15 (would run through the break)', !s180.includes('11:15'));
ok('180min drops 13:00 (straddles the break)', !s180.includes('13:00'));
ok('180min resumes at 15:00', s180.includes('15:00'));
ok('180min never starts after 19:00', s180.every(t => Core.parseHM(t) <= 1140));

console.log('\nslots — closing time is respected per duration');
ok('a 120min service stops at 20:00',
   Core.slotsFor(SHOP, WED, 120, null).slice(-1)[0] === '20:00');
ok('a 15min wash runs to 21:45',
   Core.slotsFor(SHOP, WED, 15, null).slice(-1)[0] === '21:45');
ok('every 180min slot ends by close',
   Core.slotsFor(SHOP, WED, 180, null).every(t => Core.parseHM(t) + 180 <= 1320));
ok('no slot overlaps the break, any duration',
   [15, 30, 45, 60, 90, 120, 180].every(d =>
     Core.slotsFor(SHOP, WED, d, null).every(t => {
       const s = Core.parseHM(t);
       return !(s < 900 && s + d > 840);
     })));

console.log('\nsame-day lead time');
/* 11:02 on the Wednesday, 60 min lead => earliest real start 12:02, rounded up
   onto the 15-min grid = 12:15. */
const now = new Date(2026, 8, 9, 11, 2);
const today = Core.slotsFor(SHOP, WED, 30, now);
check('first same-day slot is rounded up past the lead time', today[0], '12:15');
ok('no same-day slot is in the past', today.every(t => Core.parseHM(t) >= 11 * 60 + 2));
/* Late enough and the day is simply over. */
const late = Core.slotsFor(SHOP, WED, 30, new Date(2026, 8, 9, 21, 30));
check('a finished day offers nothing', late, []);
/* Lead time must not leak into other days. */
ok('tomorrow is unaffected by today\'s clock',
   Core.slotsFor(SHOP, new Date(2026, 8, 10), 30, now)[0] === '10:00');

console.log('\nstaff <-> service exclusion');
/* Donovan does everything. Labi does the three that need no colour. */
const donovanOnly = ['highlights', 'balayage', 'roots', 'kleuring', 'toner'];
for (const id of donovanOnly) {
  ok('Labi cannot do ' + id, Core.canDo(SHOP, 'labi', id) === false);
  ok('Donovan can do ' + id, Core.canDo(SHOP, 'donovan', id) === true);
}
check('Labi offers 3 of the 8 services', Core.servicesFor(SHOP, 'labi').length, 3);
check('Labi has exactly the cut, the wash and the blow-dry',
      Core.servicesFor(SHOP, 'labi').map(s => s.id).sort(),
      ['blowdry', 'knippen', 'wassen']);
check('Donovan offers all 8', Core.servicesFor(SHOP, 'donovan').length, 8);
check('no stylist chosen shows all 8', Core.servicesFor(SHOP, null).length, 8);
check('a cut is both', Core.staffFor(SHOP, 'knippen').map(s => s.id), ['labi', 'donovan']);
check('a blow-dry is both', Core.staffFor(SHOP, 'blowdry').map(s => s.id), ['labi', 'donovan']);
check('a wash is both', Core.staffFor(SHOP, 'wassen').map(s => s.id), ['labi', 'donovan']);
check('balayage is Donovan only', Core.staffFor(SHOP, 'balayage').map(s => s.id), ['donovan']);
check('roots is Donovan only', Core.staffFor(SHOP, 'roots').map(s => s.id), ['donovan']);
check('colour is Donovan only', Core.staffFor(SHOP, 'kleuring').map(s => s.id), ['donovan']);
check('no service chosen shows both', Core.staffFor(SHOP, null).length, 2);
ok('every service Labi cannot do is a colour service or the toner',
   SHOP.services.filter(s => !s.staff.includes('labi'))
     .every(s => s.group === 'colour' || s.group === 'toner'));
ok('the two directions agree for every pair',
   SHOP.services.every(sv =>
     SHOP.staff.every(st =>
       Core.canDo(SHOP, st.id, sv.id)
         === (Core.servicesFor(SHOP, st.id).some(x => x.id === sv.id))
         && Core.canDo(SHOP, st.id, sv.id)
         === (Core.staffFor(SHOP, sv.id).some(x => x.id === st.id)))));
check('both stylists carry the same title',
      SHOP.staff.map(s => s.role), ['Hairstylist', 'Hairstylist']);
ok('no title implies a hierarchy between them',
   !SHOP.staff.some(s => /partner|senior|junior|owner|assistant/i.test(s.role)));

console.log('\nbookable days');
const days = Core.bookableDays(SHOP, 30, WED, 5);
check('5 bookable days from a Wednesday', days.length, 5);
ok('none of them is a weekend', days.every(d => d.getDay() !== 0 && d.getDay() !== 6),
   days.map(d => d.toDateString()).join(' | '));
check('the Wed/Thu/Fri then Mon/Tue run', days.map(d => d.getDate()), [9, 10, 11, 14, 15]);
ok('a shop with no open days terminates instead of hanging', (() => {
  const dead = JSON.parse(JSON.stringify({ hours: SHOP.hours, staff: [], services: [] }));
  dead.hours.openDays = [];
  return Core.bookableDays(dead, 30, WED, 5).length === 0;
})());

console.log('\npublished hours match the bookable hours');
const rows = Core.hoursRows(SHOP);
check('7 rows, Monday first', rows.map(r => r.label), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
check('weekdays read 10:00-22:00', rows.filter(r => r.open).map(r => r.value),
      ['10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00']);
check('weekend rows are closed', rows.filter(r => !r.open).map(r => r.label), ['SAT', 'SUN']);
check('break label', Core.breakLabel(SHOP), '14:00-15:00');
ok('every published open day actually yields slots',
   rows.filter(r => r.open).every(r => {
     let probe = new Date(2026, 8, 7);
     while (probe.getDay() !== r.dow) probe = Core.addDays(probe, 1);
     return Core.slotsFor(SHOP, probe, 30, null).length > 0;
   }));
ok('every published closed day yields none',
   rows.filter(r => !r.open).every(r => {
     let probe = new Date(2026, 8, 7);
     while (probe.getDay() !== r.dow) probe = Core.addDays(probe, 1);
     return Core.slotsFor(SHOP, probe, 30, null).length === 0;
   }));

console.log("\nprice list matches the owner's written list");
/* Cuts 35+ · Highlights 60+ · Balayage 160+ · Wash 7,50 · Toner 45+
   Blow dry 35+ · Roots 50+ · Colour 50+ */
const expectedPrices = {
  'knippen': [35, true], 'blowdry': [35, true], 'wassen': [7.5, false],
  'highlights': [60, true], 'balayage': [160, true], 'roots': [50, true],
  'kleuring': [50, true], 'toner': [45, true]
};
check('all 8 services present', SHOP.services.length, 8);
for (const [id, [price, from]] of Object.entries(expectedPrices)) {
  const sv = Core.service(SHOP, id);
  ok(id + ' = ' + price + (from ? ' (from)' : ''),
     sv && sv.price === price && sv.from === from,
     sv ? 'got ' + sv.price + ' from=' + sv.from : 'service missing');
}
check('the wash is the only fixed price',
      SHOP.services.filter(s => !s.from).map(s => s.id), ['wassen']);
ok('every service has a positive duration',
   SHOP.services.every(s => s.minutes > 0 && s.minutes <= 240));
ok('every service is doable by at least one stylist',
   SHOP.services.every(s => s.staff.length > 0));
ok('every service duration fits inside a working day',
   SHOP.services.every(s => Core.slotsFor(SHOP, WED, s.minutes, null).length > 0));

console.log('\ncombining services');
check('every service has a group', SHOP.services.every(s => !!s.group), true);
check('the four colour processes share one group',
      SHOP.services.filter(s => s.group === 'colour').map(s => s.id),
      ['highlights', 'balayage', 'roots', 'kleuring']);
ok('highlights and balayage cannot both be booked',
   Core.clashes(SHOP, ['highlights'], 'balayage'));
ok('roots and a full colour cannot both be booked',
   Core.clashes(SHOP, ['roots'], 'kleuring'));
ok('balayage and roots cannot both be booked',
   Core.clashes(SHOP, ['balayage'], 'roots'));
ok('every pair of colour processes clashes', (() => {
  const col = SHOP.services.filter(s => s.group === 'colour').map(s => s.id);
  return col.every(a => col.filter(b => b !== a).every(b => Core.clashes(SHOP, [a], b)));
})());
/* The three colourless services are independent of each other and of colour. */
ok('a cut and a wash go together', !Core.clashes(SHOP, ['knippen'], 'wassen'));
ok('a cut and a blow-dry go together', !Core.clashes(SHOP, ['knippen'], 'blowdry'));
ok('a wash and a blow-dry go together', !Core.clashes(SHOP, ['wassen'], 'blowdry'));
ok('a cut and a colour go together', !Core.clashes(SHOP, ['knippen'], 'balayage'));
ok('a whole visit goes together: cut, wash, blow-dry, colour, toner',
   !Core.clashes(SHOP, ['knippen', 'wassen', 'blowdry', 'balayage'], 'toner'));
ok('a toner sits on top of any colour process',
   SHOP.services.filter(s => s.group === 'colour')
     .every(s => !Core.clashes(SHOP, [s.id], 'toner')));
ok('a service never clashes with itself (so it stays removable)',
   Core.canAdd(SHOP, ['balayage'], 'balayage'));
ok('nothing clashes with an empty set',
   SHOP.services.every(s => Core.canAdd(SHOP, [], s.id)));
ok('clashing is symmetric', SHOP.services.every(a => SHOP.services.every(b =>
   Core.clashes(SHOP, [a.id], b.id) === Core.clashes(SHOP, [b.id], a.id))));

console.log('\nwho can take a whole set');
check('a cut alone: both stylists', Core.staffForSet(SHOP, ['knippen']).map(s => s.id),
      ['labi', 'donovan']);
check('cut + wash + blow-dry: still both',
      Core.staffForSet(SHOP, ['knippen', 'wassen', 'blowdry']).map(s => s.id),
      ['labi', 'donovan']);
check('cut + balayage: Donovan only',
      Core.staffForSet(SHOP, ['knippen', 'balayage']).map(s => s.id), ['donovan']);
check('a toner pulls the booking to Donovan',
      Core.staffForSet(SHOP, ['wassen', 'toner']).map(s => s.id), ['donovan']);
check('the empty set rules nobody out', Core.staffForSet(SHOP, []).length, 2);
ok('every combinable set has at least one stylist who can take it',
   SHOP.services.every(a => SHOP.services.every(b =>
     Core.clashes(SHOP, [a.id], b.id) || Core.staffForSet(SHOP, [a.id, b.id]).length > 0)));
ok('canDoAll agrees with staffForSet for every pair',
   SHOP.services.every(a => SHOP.services.every(b => SHOP.staff.every(p =>
     Core.canDoAll(SHOP, p.id, [a.id, b.id])
       === Core.staffForSet(SHOP, [a.id, b.id]).some(x => x.id === p.id)))));
ok("Labi can take every set drawn only from Labi's own services", (() => {
  const his = Core.servicesFor(SHOP, 'labi').map(s => s.id);
  return Core.canDoAll(SHOP, 'labi', his);
})());

console.log('\ntotals for a set');
check('duration sums', Core.totalMinutes(SHOP, ['knippen', 'wassen']), 60);
check('an empty set is zero minutes', Core.totalMinutes(SHOP, []), 0);
/* 35 (a floor) + 7.50 = 42.50, and the floor carries into the total. */
check('price sums', Core.totalPriceLabel(SHOP, ['knippen', 'wassen']), 'from 42.50');
check('one "from" makes the total a "from"',
      Core.totalPriceLabel(SHOP, ['balayage', 'knippen']), 'from 195');
/* The wash is the only fixed price on the list, so it is the only set that can
   be quoted exactly. */
check('the one fixed price stays fixed', Core.totalPriceLabel(SHOP, ['wassen']), '7.50');
check('an empty set has no price', Core.totalPriceLabel(SHOP, []), '');
ok('any set containing a floor price is quoted as a floor',
   SHOP.services.filter(s => s.from)
     .every(s => Core.totalPriceLabel(SHOP, [s.id, 'wassen']).startsWith('from ')));

console.log('\nlong combinations still fit a day');
/* The longest legal booking: everything that can be held at once, with the
   longest colour process. */
const longest = ['knippen', 'blowdry', 'wassen', 'balayage', 'toner'];
ok('the longest legal combination is internally consistent',
   longest.every((id, i) => !Core.clashes(SHOP, longest.slice(0, i), id)));
const longMins = Core.totalMinutes(SHOP, longest);
ok('the longest combination is ' + longMins + ' minutes', longMins > 0);
ok('one stylist can take all of it', Core.staffForSet(SHOP, longest).length >= 1);
ok('and it still has slots on a working day',
   Core.slotsFor(SHOP, WED, longMins, null).length > 0,
   'no slot fits ' + longMins + ' minutes');
ok('every one of those slots clears the break and the close',
   Core.slotsFor(SHOP, WED, longMins, null).every(t => {
     const s = Core.parseHM(t);
     return s + longMins <= 1320 && !(s < 900 && s + longMins > 840);
   }));

console.log('\nhours, collapsed');
const sum = Core.hoursSummary(SHOP);
check('five identical weekdays collapse to one row', sum.length, 2);
check('the weekday row', [sum[0].label, sum[0].value], ['MON-FRI', '10:00-22:00']);
check('the weekend row', [sum[1].label, sum[1].value], ['SAT-SUN', '/']);
ok('the collapsed rows describe exactly the same week as the full ones', (() => {
  const expand = [];
  Core.hoursSummary(SHOP).forEach(g => {
    const [a, b] = g.label.split('-');
    const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const from = order.indexOf(a), to = b ? order.indexOf(b) : order.indexOf(a);
    for (let i = from; i <= to; i++) expand.push([order[i], g.value]);
  });
  return JSON.stringify(expand) === JSON.stringify(rows.map(r => [r.label, r.value]));
})());
ok('a single open day would not be written as a range', (() => {
  const one = JSON.parse(JSON.stringify({ hours: SHOP.hours, staff: [], services: [] }));
  one.hours.openDays = [3];
  const s = Core.hoursSummary(one);
  return s.some(g => g.label === 'WED' && g.value === '10:00-22:00');
})());

console.log('\nthe price list is genderless');
/*
  The owner's instruction is that nothing on this site names a gender. That is
  a property of every shipped file, not of one label, so it is checked as one:
  every file the site actually serves is read and searched. A label, an `nl`
  string, a fallback row in the HTML or a line of copy that reintroduced the
  split would all fail here.

  tools/ is excluded because this file necessarily contains the very words it
  is searching for.
*/
const SHIPPED = ['home.html', 'reservation.html', 'index.html', 'README.md',
                 'assets/booking-data.js', 'assets/booking-core.js',
                 'assets/booking-provider.js', 'assets/booking-ui.js',
                 'assets/catalog.js', 'assets/site.css'];
const BANNED = [/\bheren\b/i, /\bdames\b/i, /\bmen'?s\b/i, /\bwomen'?s\b/i,
                /\bmen\b/i, /\bwomen\b/i, /\bman\b/i, /\bwoman\b/i,
                /\bladies\b/i, /\bgents\b/i, /\bmale\b/i, /\bfemale\b/i];
for (const file of SHIPPED) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const hits = [];
  text.split('\n').forEach((line, i) => {
    BANNED.forEach(re => { if (re.test(line)) hits.push((i + 1) + ': ' + line.trim().slice(0, 70)); });
  });
  ok('no gendered wording in ' + file, hits.length === 0, hits.join('\n         '));
}
check('one cutting entry, and it names no gender',
      SHOP.services.filter(s => s.group === 'cut').map(s => s.name), ['Cuts']);
check('the Dutch names are genderless too',
      SHOP.services.map(s => s.nl),
      ['Knippen', 'Blowdrogen', 'Wassen', 'Highlights', 'Balayage', 'Uitgroei',
       'Kleuring', 'Toner']);
check('a cut starts at 35', Core.priceLabel(Core.service(SHOP, 'knippen')), 'from 35');
check('a blow-dry starts at 35', Core.priceLabel(Core.service(SHOP, 'blowdry')), 'from 35');
check('highlights start at 60', Core.priceLabel(Core.service(SHOP, 'highlights')), 'from 60');
ok('every price the site can print is free of gendered wording',
   SHOP.services.every(s => !BANNED.some(re => re.test(s.name) || re.test(s.nl) || re.test(s.id))));

console.log('\nthe final brand and contact details');
const RETIRED = [/jill/i, /scutt/i, /\bkiru\b/i, /alabivof/i, /468 ?56 ?23 ?24/, /468562324/,
                 /preview-flag/, /PREVIEW MOCKUP/, /noindex/];
for (const file of SHIPPED) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const hits = [];
  text.split('\n').forEach((line, i) => {
    RETIRED.forEach(re => { if (re.test(line)) hits.push((i + 1) + ': ' + line.trim().slice(0, 70)); });
  });
  ok('no retired brand, contact detail or preview marker in ' + file, hits.length === 0,
     hits.join('\n         '));
}
check('the shop is called UCHI', SHOP.name, 'UCHI');
for (const file of ['home.html', 'reservation.html']) {
  const html = readFileSync(path.join(root, file), 'utf8');
  ok(file + ' links the phone as tel:+32498803033', html.includes('href="tel:+32498803033"'));
  ok(file + ' links info@uchi.be', html.includes('href="mailto:info@uchi.be"'));
  ok(file + " links Donovan's Instagram", html.includes('instagram.com/donovanhairdresser/'));
  ok(file + ' uses the UCHI wordmark', html.includes('assets/brand/uchi-logo.webp')
     && html.includes('width="648" height="239"'));
}
ok('the booking provider books through create_booking, not an e-mail',
   (() => {
     const src = readFileSync(path.join(root, 'assets/booking-provider.js'), 'utf8');
     return src.includes("rpc('create_booking'") && !src.includes('mailto:')
       && src.includes("var PHONE = '+32 498 80 30 33';");
   })());

console.log('\nclean page addresses and plain copy');
const home = readFileSync(path.join(root, 'home.html'), 'utf8');
const resv = readFileSync(path.join(root, 'reservation.html'), 'utf8');
const idx = readFileSync(path.join(root, 'index.html'), 'utf8');
ok('home links to /reservation, not reservation.html',
   home.includes('href="reservation"') && !/href="[^"]*\.html/.test(home));
ok('reservation links back to /home, not index.html',
   resv.includes('href="home"') && !/href="[^"]*\.html/.test(resv));
ok('the site root forwards to home',
   idx.includes('url=home') && idx.includes('data-redirect="home"') && idx.includes('assets/js/site.js')
   && /location\.replace\(redirect/.test(readFileSync(path.join(root, 'assets/js/site.js'), 'utf8')));
ok('the homepage has one photograph and no swap',
   !/hero2|figure__swap|TAP TO SWAP/.test(home) && (home.match(/<picture>/g) || []).length === 2);
ok('the second photograph files are gone',
   !['hero2-480.webp', 'hero2-720.webp', 'hero2-1080.webp', 'hero2-1440.webp', 'hero2-1080.jpg']
     .some(f => existsSync(path.join(root, 'assets/img', f))));
/* No em dash in anything a visitor reads: page text, attribute values, and
   strings the scripts put on the page or into the booking e-mail. Comments
   are not shown, so they are skipped. */
const visible = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
for (const [f, src] of [['home.html', home], ['reservation.html', resv],
  ['assets/booking-ui.js', readFileSync(path.join(root, 'assets/booking-ui.js'), 'utf8')],
  ['assets/booking-provider.js', readFileSync(path.join(root, 'assets/booking-provider.js'), 'utf8')],
  ['assets/booking-core.js', readFileSync(path.join(root, 'assets/booking-core.js'), 'utf8')],
  ['assets/catalog.js', readFileSync(path.join(root, 'assets/catalog.js'), 'utf8')]]) {
  const lines = visible(src).split('\n').filter(l => l.includes('\u2014') && !/^\s*\/\//.test(l));
  ok('no em dash in anything ' + f + ' shows', lines.length === 0, lines.map(l => l.trim().slice(0, 70)).join('\n         '));
}

/* ---------------------------------------------------------------------------
   Brussels wall-clock -> instant. Expected values worked out from the EU rule:
   CET = UTC+1, CEST = UTC+2, clocks go forward at 01:00 UTC on the last Sunday
   of March (2026-03-29) and back at 01:00 UTC on the last Sunday of October
   (2026-10-25).
--------------------------------------------------------------------------- */
console.log('\nBrussels time');
const BE = Core.brusselsEpoch;
check('winter 10:00 is 09:00 UTC', BE(2026, 1, 15, '10:00'), Date.UTC(2026, 0, 15, 9, 0));
check('summer 10:00 is 08:00 UTC', BE(2026, 7, 15, '10:00'), Date.UTC(2026, 6, 15, 8, 0));
check('day before spring change, 10:00 is 09:00 UTC', BE(2026, 3, 28, '10:00'), Date.UTC(2026, 2, 28, 9, 0));
check('spring change day, 01:30 (still CET) is 00:30 UTC', BE(2026, 3, 29, '01:30'), Date.UTC(2026, 2, 29, 0, 30));
check('spring change day, 03:30 (CEST) is 01:30 UTC', BE(2026, 3, 29, '03:30'), Date.UTC(2026, 2, 29, 1, 30));
check('spring change day, 10:00 is 08:00 UTC', BE(2026, 3, 29, '10:00'), Date.UTC(2026, 2, 29, 8, 0));
check('spring change day, 22:00 is 20:00 UTC', BE(2026, 3, 29, '22:00'), Date.UTC(2026, 2, 29, 20, 0));
check('day before autumn change, 10:00 is 08:00 UTC', BE(2026, 10, 24, '10:00'), Date.UTC(2026, 9, 24, 8, 0));
check('autumn change day, 00:30 (CEST) is 22:30 UTC the day before', BE(2026, 10, 25, '00:30'), Date.UTC(2026, 9, 24, 22, 30));
check('autumn change day, 04:00 (CET) is 03:00 UTC', BE(2026, 10, 25, '04:00'), Date.UTC(2026, 9, 25, 3, 0));
check('autumn change day, 10:00 is 09:00 UTC', BE(2026, 10, 25, '10:00'), Date.UTC(2026, 9, 25, 9, 0));
ok('autumn change day, ambiguous 02:30 is one of its two real instants',
   [Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)].includes(BE(2026, 10, 25, '02:30')));
check('slotEpoch reads only the calendar fields', Core.slotEpoch(new Date(2026, 8, 9), '10:00'),
      Date.UTC(2026, 8, 9, 8, 0));
check('brusselsLabel round-trips a summer instant', Core.brusselsLabel(Date.UTC(2026, 8, 9, 8, 0)),
      { date: '2026-09-09', time: '10:00', dow: 3, y: 2026, m: 9, d: 9 });
check('brusselsLabel on a winter instant', Core.brusselsLabel(Date.UTC(2026, 11, 31, 23, 30)).date, '2027-01-01');
check('brusselsToday is the salon date, not the UTC date',
      Core.isoDate(Core.brusselsToday(new Date(Date.UTC(2026, 8, 13, 22, 30)))), '2026-09-14');
ok('brusselsEpoch rejects a malformed time', Number.isNaN(BE(2026, 1, 1, '25:00')));
ok('every grid time on every day of 2026 round-trips through brusselsLabel', (() => {
  for (let i = 0; i < 365; i++) {
    const d = new Date(2026, 0, 1 + i);
    for (const t of ['10:00', '14:45', '21:45']) {
      const l = Core.brusselsLabel(Core.slotEpoch(d, t));
      if (l.date !== Core.isoDate(d) || l.time !== t) return false;
    }
  }
  return true;
})());

/* Same computations in child processes pinned to other zones. The probe also
   reports the child's own UTC offset, to prove the zone really was different. */
console.log('\nBrussels time does not depend on the machine zone');
{
  const { spawnSync } = await import('node:child_process');
  const probe = `
    const Core = require(${JSON.stringify(path.join(root, 'assets', 'booking-core.js'))});
    const shop = { hours: { openDays: [1,2,3,4,5], open: '10:00', close: '22:00',
      break: { start: '14:00', end: '15:00' }, slotStepMinutes: 15, leadTimeMinutes: 60 } };
    const busy = [{ staff_id: 'donovan', starts_at: '2026-10-26T09:00:00+00:00', ends_at: '2026-10-26T10:00:00+00:00' }];
    console.log(JSON.stringify({
      offset: new Date(2026, 0, 15, 12).getTimezoneOffset(),
      e: [Core.brusselsEpoch(2026,1,15,'10:00'), Core.brusselsEpoch(2026,7,15,'10:00'),
          Core.brusselsEpoch(2026,3,29,'03:30'), Core.brusselsEpoch(2026,10,25,'04:00')],
      today: Core.isoDate(Core.brusselsToday(new Date(Date.UTC(2026, 8, 13, 22, 30)))),
      lead: Core.freeSlotsFor(shop, new Date(2026, 8, 9), 30, new Date(Date.UTC(2026, 8, 9, 9, 2)), [], ['donovan'])[0],
      dst: Core.freeSlotsFor(shop, new Date(2026, 9, 26), 30, null, busy, ['donovan']).slice(0, 5),
      days: Core.bookableDaysFree(shop, 30, new Date(Date.UTC(2026, 8, 11, 21, 30)), 3, 30, [], ['donovan']).map(Core.isoDate)
    }));`;
  const run = (tz) => {
    const r = spawnSync(process.execPath, ['-e', probe], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(tz + ': ' + r.stderr);
    return JSON.parse(r.stdout);
  };
  const ny = run('America/New_York'), tokyo = run('Asia/Tokyo'), bxl = run('Europe/Brussels');
  check('the New York child really runs at UTC-5', ny.offset, 300);
  check('the Tokyo child really runs at UTC+9', tokyo.offset, -540);
  const expectE = [Date.UTC(2026, 0, 15, 9), Date.UTC(2026, 6, 15, 8), Date.UTC(2026, 2, 29, 1, 30), Date.UTC(2026, 9, 25, 3)];
  check('New York computes the same instants', ny.e, expectE);
  check('Tokyo computes the same instants', tokyo.e, expectE);
  check('Brussels computes the same instants', bxl.e, expectE);
  const { offset: _a, ...nyRest } = ny, { offset: _b, ...tkRest } = tokyo, { offset: _c, ...bxRest } = bxl;
  check('New York and Tokyo agree on today, lead time, DST slots and days', nyRest, tkRest);
  check('and agree with Brussels', nyRest, bxRest);
  check('the lead-time slot is 12:15 salon time everywhere', tokyo.lead, '12:15');
  check('the first Monday after the autumn change: 10:00-11:00 CET is taken', tokyo.dst,
        ['11:00', '11:15', '11:30', '11:45', '12:00']);
  check('Friday 23:30 in Brussels: the next open days are Mon, Tue, Wed', tokyo.days,
        ['2026-09-14', '2026-09-15', '2026-09-16']);
}

console.log('\nbusy ranges');
/* A booking 10:00-11:00 Brussels on Wednesday 9 Sep 2026 = 08:00-09:00 UTC. */
const B1 = [{ staff_id: 'donovan', starts_at: '2026-09-09T08:00:00+00:00', ends_at: '2026-09-09T09:00:00+00:00' }];
const at = (t) => Core.slotEpoch(WED, t);
check('a slot starting as the booking ends does not overlap', Core.busyOverlaps(B1, 'donovan', at('11:00'), 45), false);
check('a slot ending as the booking starts does not overlap', Core.busyOverlaps(B1, 'donovan', at('09:15'), 45), false);
check('a slot inside the booking overlaps', Core.busyOverlaps(B1, 'donovan', at('10:30'), 15), true);
check('a slot running into the booking overlaps', Core.busyOverlaps(B1, 'donovan', at('09:30'), 45), true);
check('a slot containing the booking overlaps', Core.busyOverlaps(B1, 'donovan', at('09:30'), 180), true);
check('a slot one minute into the end overlaps', Core.busyOverlaps(B1, 'donovan', at('10:59'), 30), true);
check('another stylist is not affected', Core.busyOverlaps(B1, 'labi', at('10:30'), 15), false);
check('Date objects and epoch ms are the same', Core.busyOverlaps(B1, 'donovan', new Date(at('10:30')), 15), true);
check('no busy list, no overlap', Core.busyOverlaps(null, 'donovan', at('10:30'), 15), false);

console.log('\nfree slots');
/* Donovan busy 10:00-12:00 Brussels on the Wednesday. */
const B2 = [{ staff_id: 'donovan', starts_at: '2026-09-09T08:00:00Z', ends_at: '2026-09-09T10:00:00Z' }];
const donFree = Core.freeSlotsFor(SHOP, WED, 45, null, B2, ['donovan']);
check("Donovan's first free 45 min slot is 12:00", donFree[0], '12:00');
ok('11:15 is not offered for Donovan (it starts inside the booking)', !donFree.includes('11:15'));
/* 45 min on the grid: 10:00..21:15 = 46 starts; break kills 13:30..14:45 = 6 -> 40.
   Busy kills 10:00..11:45 = 8 -> 32. */
check("Donovan's free 45 min slot count", donFree.length, 32);
const anyFree = Core.freeSlotsFor(SHOP, WED, 45, null, B2, ['labi', 'donovan']);
check('first available still offers 10:00 (Labi is free)', anyFree[0], '10:00');
check('first available offers every grid slot', anyFree.length, 40);
const bothBusy = B2.concat([{ staff_id: 'labi', starts_at: '2026-09-09T08:00:00Z', ends_at: '2026-09-09T08:30:00Z' }]);
const anyFree2 = Core.freeSlotsFor(SHOP, WED, 45, null, bothBusy, ['labi', 'donovan']);
ok('with both busy at 10:00, 10:00 is gone', !anyFree2.includes('10:00'));
check('but 10:30 is back, because Labi is free from 10:30', anyFree2[0], '10:30');
check('unknown availability (null) means every grid slot', Core.freeSlotsFor(SHOP, WED, 30, null, null, ['donovan']).length, 42);
check('nobody able means nothing free', Core.freeSlotsFor(SHOP, WED, 30, null, [], []), []);
check('lead time compares instants: 11:02 Brussels -> 12:15',
      Core.freeSlotsFor(SHOP, WED, 30, new Date(Date.UTC(2026, 8, 9, 9, 2)), [], ['donovan'])[0], '12:15');
/* The same UTC booking is a different wall-clock hour either side of the change. */
const B3 = [{ staff_id: 'donovan', starts_at: '2026-10-23T09:00:00Z', ends_at: '2026-10-23T10:00:00Z' },
            { staff_id: 'donovan', starts_at: '2026-10-26T09:00:00Z', ends_at: '2026-10-26T10:00:00Z' }];
check('Friday before the change: 09:00Z is 11:00 CEST', Core.freeSlotsFor(SHOP, new Date(2026, 9, 23), 60, null, B3, ['donovan']).slice(0, 3),
      ['10:00', '12:00', '12:15']);
check('Monday after the change: 09:00Z is 10:00 CET', Core.freeSlotsFor(SHOP, new Date(2026, 9, 26), 60, null, B3, ['donovan']).slice(0, 3),
      ['11:00', '11:15', '11:30']);

console.log('\nbookable days with bookings');
const fullWed = [{ staff_id: 'donovan', starts_at: '2026-09-09T08:00:00Z', ends_at: '2026-09-09T20:00:00Z' }];
const nowWed = new Date(Date.UTC(2026, 8, 9, 7, 0));   // 09:00 Brussels
check('a fully booked day is skipped for Donovan',
      Core.bookableDaysFree(SHOP, 180, nowWed, 4, 30, fullWed, ['donovan']).map(Core.isoDate),
      ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15']);
check('but kept for a first-available cut, because Labi is free',
      Core.bookableDaysFree(SHOP, 45, nowWed, 2, 30, fullWed, ['labi', 'donovan']).map(Core.isoDate),
      ['2026-09-09', '2026-09-10']);
check('with no bookings it matches bookableDays',
      Core.bookableDaysFree(SHOP, 30, nowWed, 5, 30, [], ['donovan']).map(d => d.getDate()), [9, 10, 11, 14, 15]);
check('a finished day is skipped: Wednesday 21:30 starts on Thursday',
      Core.isoDate(Core.bookableDaysFree(SHOP, 30, new Date(Date.UTC(2026, 8, 9, 19, 30)), 1, 30, [], ['donovan'])[0]),
      '2026-09-10');
check('the horizon caps the search', Core.bookableDaysFree(SHOP, 30, nowWed, 50, 7, [], ['donovan']).length, 5);

/* ------------------------------------------------------------- catalogue -- */
console.log('\ncatalogue');
const catalogSrc = readFileSync(path.join(root, 'assets', 'catalog.js'), 'utf8');
function freshCatalog(extra) {
  const w = Object.assign({ SHOP: JSON.parse(JSON.stringify(SHOP)) }, extra || {});
  new Function('window', catalogSrc)(w);
  return w;
}
/* Rows exactly as the contract seeds them from booking-data.js. */
const seedRows = {
  settings: [{ id: 1, open_days: [1, 2, 3, 4, 5], open_time: '10:00:00', close_time: '22:00:00',
               break_start: '14:00:00', break_end: '15:00:00', slot_step_minutes: 15,
               lead_time_minutes: 60, booking_horizon_days: 60 }],
  staff: [{ id: 'donovan', name: 'DONOVAN', role: 'Hairstylist', sort: 2, active: true },
          { id: 'labi', name: 'LABI', role: 'Hairstylist', sort: 1, active: true }],
  services: SHOP.services.map((s, i) => ({ id: s.id, name: s.name, nl: s.nl, price: s.price,
            is_from: s.from, minutes: s.minutes, grp: s.group, sort: i + 1, active: true })).reverse(),
  service_staff: SHOP.services.flatMap(s => s.staff.slice().reverse().map(id => ({ service_id: s.id, staff_id: id })))
};
const fakeClient = (rows, mode) => ({
  from: (t) => ({ select: () => mode === 'hang' ? new Promise(() => {})
    : mode === 'error' ? Promise.resolve({ data: null, error: { message: 'boom' } })
    : mode === 'reject' ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: rows[t], error: null }) })
});
{
  const w = freshCatalog();
  const shop = await w.UchiCatalog.load();
  check('no UchiDB: resolves the static SHOP', shop === w.SHOP, true);
  check('no UchiDB: marked static', shop.__source, 'static');
  ok('load is cached per page', w.UchiCatalog.load() === w.UchiCatalog.load());
}
{
  const w = freshCatalog({ UchiDB: { client: () => null } });
  check('a client that is not available: static', (await w.UchiCatalog.load()).__source, 'static');
}
{
  const w = freshCatalog({ UchiDB: { client: () => { throw new Error('no supabase'); } } });
  check('a client that throws: static, not a rejection', (await w.UchiCatalog.load()).__source, 'static');
}
for (const mode of ['error', 'reject']) {
  const w = freshCatalog({ UchiDB: { client: () => fakeClient(seedRows, mode) } });
  check('a query that ' + (mode === 'error' ? 'returns an error' : 'rejects') + ': static',
        (await w.UchiCatalog.load()).__source, 'static');
}
{
  const w = freshCatalog({ UchiDB: { client: () => fakeClient(seedRows, 'hang') } });
  const t0 = Date.now();
  const shop = await w.UchiCatalog.load({ timeoutMs: 80 });
  check('a database that never answers: static after the timeout', shop.__source, 'static');
  ok('and it did wait for the timeout', Date.now() - t0 >= 70);
  ok('the default timeout is 4 seconds', catalogSrc.includes('|| 4000'));
}
{
  const empty = { settings: [], staff: [], services: [], service_staff: [] };
  const w = freshCatalog({ UchiDB: { client: () => fakeClient(empty) } });
  check('empty tables: static', (await w.UchiCatalog.load()).__source, 'static');
}
{
  const w = freshCatalog({ UchiDB: { client: () => fakeClient(seedRows) } });
  const shop = await w.UchiCatalog.load();
  check('seeded tables: marked db', shop.__source, 'db');
  check('the horizon comes from settings', shop.hours.bookingHorizonDays, 60);
  const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.__source; delete c.hours.bookingHorizonDays; return c; };
  check('the seeded database builds exactly the static SHOP (sorted by sort)', strip(shop), strip(SHOP));
}
{
  const rows = JSON.parse(JSON.stringify(seedRows));
  rows.settings[0].break_start = null; rows.settings[0].break_end = null;
  rows.services.find(s => s.id === 'toner').active = false;
  rows.service_staff = rows.service_staff.filter(l => l.service_id !== 'roots');
  rows.services.find(s => s.id === 'wassen').price = '8.00';
  const shop = freshCatalog().UchiCatalog.build(rows, SHOP);
  check('no break in settings gives break null', shop.hours.break, null);
  ok('an inactive service is left out', !shop.services.some(s => s.id === 'toner'));
  ok('a service nobody can do is left out', !shop.services.some(s => s.id === 'roots'));
  check('numeric prices arriving as strings become numbers', shop.services.find(s => s.id === 'wassen').price, 8);
}

/* -------------------------------------------------------------- provider -- */
console.log('\nbooking provider');
const providerSrc = readFileSync(path.join(root, 'assets', 'booking-provider.js'), 'utf8');
function freshProvider(client) {
  const w = { BookingCore: Core, UchiDB: { client: () => client } };
  new Function('window', providerSrc)(w);
  return w.BookingProvider;
}
const booking = {
  staffId: null, staffName: 'First available stylist',
  services: [{ id: 'knippen', name: 'Cuts' }, { id: 'wassen', name: 'Wash' }],
  isoDate: '2026-09-16', time: '11:00', name: 'A', email: 'a@example.com', phone: '0470', notes: '', hp: ''
};
check('params match the create_booking signature', freshProvider(null).params(booking), {
  p_service_ids: ['knippen', 'wassen'], p_staff_id: null, p_date: '2026-09-16', p_time: '11:00',
  p_name: 'A', p_email: 'a@example.com', p_phone: '0470', p_notes: null, p_hp: ''
});
{
  const P = freshProvider(null);
  const codes = ['invalid_services', 'invalid_staff', 'closed', 'outside_hours', 'in_break', 'off_grid',
                 'too_soon', 'too_far', 'slot_taken', 'invalid_contact', 'rate_limited', 'rejected'];
  ok('every contract error code has its own message',
     codes.every(c => P.codes.includes(c)) && new Set(codes.map(P.message)).size === codes.length);
  ok('rate_limited suggests calling', P.message('rate_limited').includes('+32 498 80 30 33'));
  ok('a network failure gives the phone number', P.message('network').includes('+32 498 80 30 33'));
  ok('no provider message has an em dash', P.codes.every(c => !P.message(c).includes('—')) && !P.note.includes('—'));
}
function fakeForm() {
  const button = { disabled: false, textContent: 'BOOK THIS APPOINTMENT' };
  const note = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  return { button, note, querySelector: (s) => s === '.bsubmit' ? button : s === '.bnote' ? note : null };
}
for (const [label, client, code] of [
  ['slot_taken', { rpc: () => Promise.resolve({ data: { ok: false, error: 'slot_taken' }, error: null }) }, 'slot_taken'],
  ['a network rejection', { rpc: () => Promise.reject(new TypeError('Failed to fetch')) }, 'network'],
  ['a fetch error object', { rpc: () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) }, 'network'],
  ['no client at all', null, 'network']
]) {
  const P = freshProvider(client), f = fakeForm();
  let retimed = null;
  const pr = P.submit(booking, f, { onRetime: (c) => { retimed = c; } });
  if (client) ok(label + ': the button is disabled and reads BOOKING... while sending',
                 f.button.disabled === true && f.button.textContent === 'BOOKING...');
  const res = await pr;
  check(label + ': resolves with error ' + code, res, { ok: false, error: code });
  ok(label + ': the button comes back', f.button.disabled === false && f.button.textContent === 'BOOK THIS APPOINTMENT');
  check(label + ': shows its message', f.note.textContent, P.message(code));
  check(label + ': asks the page to re-time only for slot errors', retimed, code === 'slot_taken' ? 'slot_taken' : null);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
