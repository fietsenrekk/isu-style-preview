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
/* All colour work is Donovan's: both highlights, balayage, toner and both
   regrowth services. Labi has the cuts, the washes and the blow-dries. */
const donovanOnly = ['half-head-highlights', 'full-head-highlights', 'balayage',
                     'toner', 'uitgroei', 'uitgroei-lengtes'];
for (const id of donovanOnly) {
  ok('Labi cannot do ' + id, Core.canDo(SHOP, 'labi', id) === false);
  ok('Donovan can do ' + id, Core.canDo(SHOP, 'donovan', id) === true);
}
check('Labi offers 6 of the 12 services', Core.servicesFor(SHOP, 'labi').length, 6);
check('Labi has the cuts and the washes and nothing else',
      Core.servicesFor(SHOP, 'labi').map(s => s.group).sort(),
      ['cut', 'cut', 'cut', 'cut', 'wash', 'wash']);
check('Donovan offers all 12', Core.servicesFor(SHOP, 'donovan').length, 12);
check('no stylist chosen shows all 12', Core.servicesFor(SHOP, null).length, 12);
check('balayage is Donovan only', Core.staffFor(SHOP, 'balayage').map(s => s.id), ['donovan']);
check("men's cut is both", Core.staffFor(SHOP, 'heren-knippen').map(s => s.id), ['labi', 'donovan']);
check('regrowth is Donovan only', Core.staffFor(SHOP, 'uitgroei').map(s => s.id), ['donovan']);
check('regrowth + lengths is Donovan only',
      Core.staffFor(SHOP, 'uitgroei-lengtes').map(s => s.id), ['donovan']);
check('no service chosen shows both', Core.staffFor(SHOP, null).length, 2);
ok('the two directions agree for every pair',
   SHOP.services.every(sv =>
     SHOP.staff.every(st =>
       Core.canDo(SHOP, st.id, sv.id)
         === (Core.servicesFor(SHOP, st.id).some(x => x.id === sv.id))
         && Core.canDo(SHOP, st.id, sv.id)
         === (Core.staffFor(SHOP, sv.id).some(x => x.id === st.id)))));

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
     let probe = new Date(2026, 8, 7);                   // a Monday
     while (probe.getDay() !== r.dow) probe = Core.addDays(probe, 1);
     return Core.slotsFor(SHOP, probe, 30, null).length > 0;
   }));
ok('every published closed day yields none',
   rows.filter(r => !r.open).every(r => {
     let probe = new Date(2026, 8, 7);
     while (probe.getDay() !== r.dow) probe = Core.addDays(probe, 1);
     return Core.slotsFor(SHOP, probe, 30, null).length === 0;
   }));

console.log('\nprice list matches the owner\'s written list');
const expectedPrices = {
  'heren-knippen': [45, true], 'dames-knippen': [45, false],
  'dames-knippen-drogen': [55, false], 'dames-knippen-blowdry': [65, false],
  'half-head-highlights': [70, false], 'full-head-highlights': [100, false],
  'uitgroei': [50, false], 'uitgroei-lengtes': [70, false],
  'balayage': [160, true], 'toner': [45, true],
  'wassen': [7.5, false], 'wassen-blowdry': [40, true]
};
check('all 12 services present', SHOP.services.length, 12);
for (const [id, [price, from]] of Object.entries(expectedPrices)) {
  const sv = Core.service(SHOP, id);
  ok(id + ' = ' + price + (from ? ' (from)' : ''),
     sv && sv.price === price && sv.from === from,
     sv ? 'got ' + sv.price + ' from=' + sv.from : 'service missing');
}
ok('every service has a positive duration',
   SHOP.services.every(s => s.minutes > 0 && s.minutes <= 240));
ok('every service is doable by at least one stylist',
   SHOP.services.every(s => s.staff.length > 0));
ok('every service duration fits inside a working day',
   SHOP.services.every(s => Core.slotsFor(SHOP, WED, s.minutes, null).length > 0));

console.log('\ncombining services');
/* Same group = alternatives to one another, different groups = combinable. */
check('every service has a group', SHOP.services.every(s => !!s.group), true);
ok('two cuts cannot be booked together',
   Core.clashes(SHOP, ['dames-knippen'], 'dames-knippen-blowdry'));
ok('two colour processes cannot be booked together',
   Core.clashes(SHOP, ['balayage'], 'full-head-highlights'));
ok('regrowth clashes with balayage — both are colour',
   Core.clashes(SHOP, ['uitgroei'], 'balayage'));
ok('two washes cannot be booked together',
   Core.clashes(SHOP, ['wassen'], 'wassen-blowdry'));
ok('a cut and a colour DO go together',
   !Core.clashes(SHOP, ['dames-knippen'], 'balayage'));
ok('a cut, a colour, a toner and a wash all go together',
   !Core.clashes(SHOP, ['dames-knippen', 'balayage', 'toner'], 'wassen'));
ok('a service never clashes with itself (so it stays removable)',
   Core.canAdd(SHOP, ['balayage'], 'balayage'));
ok('nothing clashes with an empty set',
   SHOP.services.every(s => Core.canAdd(SHOP, [], s.id)));
ok('clashing is symmetric', SHOP.services.every(a => SHOP.services.every(b =>
   Core.clashes(SHOP, [a.id], b.id) === Core.clashes(SHOP, [b.id], a.id))));

console.log('\nwho can take a whole set');
check('a cut alone: both stylists', Core.staffForSet(SHOP, ['dames-knippen']).map(s => s.id),
      ['labi', 'donovan']);
check('cut + balayage: Donovan only',
      Core.staffForSet(SHOP, ['dames-knippen', 'balayage']).map(s => s.id), ['donovan']);
check('cut + wash: still both',
      Core.staffForSet(SHOP, ['dames-knippen', 'wassen']).map(s => s.id), ['labi', 'donovan']);
check('the empty set rules nobody out', Core.staffForSet(SHOP, []).length, 2);
ok('every combinable set has at least one stylist who can take it',
   SHOP.services.every(a => SHOP.services.every(b =>
     Core.clashes(SHOP, [a.id], b.id) || Core.staffForSet(SHOP, [a.id, b.id]).length > 0)));
ok('canDoAll agrees with staffForSet for every pair',
   SHOP.services.every(a => SHOP.services.every(b => SHOP.staff.every(p =>
     Core.canDoAll(SHOP, p.id, [a.id, b.id])
       === Core.staffForSet(SHOP, [a.id, b.id]).some(x => x.id === p.id)))));

console.log('\ntotals for a set');
check('duration sums', Core.totalMinutes(SHOP, ['dames-knippen', 'wassen']), 60);
check('an empty set is zero minutes', Core.totalMinutes(SHOP, []), 0);
check('price sums', Core.totalPriceLabel(SHOP, ['dames-knippen', 'wassen']), '52.50');
/* One floor price makes the whole total a floor: 160+ and 45 cannot add to a
   fixed 205, because the balayage half can still move. */
check('one "from" makes the total a "from"',
      Core.totalPriceLabel(SHOP, ['balayage', 'dames-knippen']), 'from 205');
check('all-fixed stays fixed',
      Core.totalPriceLabel(SHOP, ['dames-knippen', 'full-head-highlights']), '145');
check('an empty set has no price', Core.totalPriceLabel(SHOP, []), '');

console.log('\nlong combinations still fit a day');
/* The longest legal booking: one cut, one colour, a toner and a wash. */
const longest = ['dames-knippen-blowdry', 'balayage', 'toner', 'wassen-blowdry'];
ok('the longest legal combination is internally consistent',
   longest.every((id, i) => !Core.clashes(SHOP, longest.slice(0, i), id)));
const longMins = Core.totalMinutes(SHOP, longest);
ok('the longest combination is ' + longMins + ' minutes', longMins > 0);
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
