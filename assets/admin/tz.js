/*
  UCHI admin, Europe/Brussels time.

  Everything the owner sees or types is salon-local time, whatever timezone the
  phone or laptop happens to be set to. The browser's own Date local methods are
  never used for display or input; the offset is read from Intl for the exact
  instant in question, so the DST switch days come out right.

  Loaded in the browser (window.UchiTZ) and required by tools/admin-check.mjs.
*/
(function (root) {
  'use strict';

  var ZONE = 'Europe/Brussels';
  var fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Wall-clock parts of an instant, in Brussels. */
  function parts(instant) {
    var d = instant instanceof Date ? instant : new Date(instant);
    var out = {};
    fmt.formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
    return {
      y: +out.year, m: +out.month, d: +out.day,
      h: +out.hour, mi: +out.minute, s: +out.second,
      dow: DOW[out.weekday]
    };
  }

  /* Minutes Brussels is ahead of UTC at that instant (60 in winter, 120 in summer). */
  function offsetMinutes(instant) {
    var ms = (instant instanceof Date ? instant : new Date(instant)).getTime();
    ms = Math.floor(ms / 1000) * 1000;
    var p = parts(ms);
    return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms) / 60000);
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) throw new Error('bad date ' + s);
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  function parseTime(s) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(s));
    if (!m) throw new Error('bad time ' + s);
    return { h: +m[1], mi: +m[2] };
  }

  /*
    Brussels date 'YYYY-MM-DD' + time 'HH:MM' -> Date instant.
    Two passes: guess with the offset at the naive UTC reading, then correct
    with the offset at the resulting instant. On the autumn repeat hour (02:00-03:00
    on the last Sunday of October) this picks the second, winter-time
    occurrence; a time inside the spring gap moves forward one hour.
  */
  function toInstant(dateStr, timeStr) {
    var d = parseDate(dateStr), t = parseTime(timeStr || '00:00');
    var naive = Date.UTC(d.y, d.m - 1, d.d, t.h, t.mi);
    var first = naive - offsetMinutes(naive) * 60000;
    var second = naive - offsetMinutes(first) * 60000;
    return new Date(second);
  }

  function dateOf(instant) {
    var p = parts(instant);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }
  function timeOf(instant) {
    var p = parts(instant);
    return pad(p.h) + ':' + pad(p.mi);
  }
  function today(now) { return dateOf(now || new Date()); }

  /* Calendar arithmetic on date strings, independent of any timezone. */
  function addDays(dateStr, n) {
    var d = parseDate(dateStr);
    var x = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  }
  function dowOf(dateStr) {
    var d = parseDate(dateStr);
    return new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  }
  /* Monday of the week containing dateStr. */
  function weekStart(dateStr) {
    return addDays(dateStr, -((dowOf(dateStr) + 6) % 7));
  }
  /* [start, end) instants of a Brussels calendar day. 23 h or 25 h on switch days. */
  function dayRange(dateStr) {
    return [toInstant(dateStr, '00:00'), toInstant(addDays(dateStr, 1), '00:00')];
  }

  var DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  /* 'MON 14 SEP 2026' */
  function dayLabel(dateStr) {
    var d = parseDate(dateStr);
    return DAY[dowOf(dateStr)] + ' ' + d.d + ' ' + MON[d.m - 1] + ' ' + d.y;
  }

  var api = {
    ZONE: ZONE, parts: parts, offsetMinutes: offsetMinutes, toInstant: toInstant,
    dateOf: dateOf, timeOf: timeOf, today: today, addDays: addDays, dowOf: dowOf,
    weekStart: weekStart, dayRange: dayRange, dayLabel: dayLabel, pad: pad
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UchiTZ = api;
})(typeof window !== 'undefined' ? window : null);
