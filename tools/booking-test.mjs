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

import { readFileSync } from 'node:fs';
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
check('the weekday row', [sum[0].label, sum[0].value], ['MON — FRI', '10:00-22:00']);
check('the weekend row', [sum[1].label, sum[1].value], ['SAT — SUN', '/']);
ok('the collapsed rows describe exactly the same week as the full ones', (() => {
  const expand = [];
  Core.hoursSummary(SHOP).forEach(g => {
    const [a, b] = g.label.split(' — ');
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
const SHIPPED = ['index.html', 'reservation.html', 'README.md',
                 'assets/booking-data.js', 'assets/booking-core.js',
                 'assets/booking-provider.js', 'assets/booking-ui.js',
                 'assets/site.css'];
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
