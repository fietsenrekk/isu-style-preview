/*
  JILL SCUTT — booking core
  =========================

  Every decision the booking page makes, as pure functions over window.SHOP:
  which stylist can do which service, which days are open, and which start
  times actually fit. No DOM in this file, on purpose — it runs unchanged
  under Node, which is how tools/booking-test.mjs checks the slot maths
  against hand-worked cases instead of me squinting at a rendered calendar.

  Times are handled as minutes-from-midnight integers. Dates are the visitor's
  local dates. A salon in Antwerp is booked by people in Antwerp, and the one
  thing that must never happen is a slot rendered in one zone and interpreted
  in another, so no UTC conversion happens anywhere: the date the visitor picks
  is the date that is sent.
*/

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookingCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------- time ----- */

  /* '10:00' -> 600. Returns NaN on anything malformed rather than guessing. */
  function parseHM(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
    if (!m) return NaN;
    var h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return NaN;
    return h * 60 + min;
  }

  /* 600 -> '10:00'. Always two digits, so slots sort as strings too. */
  function formatHM(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* ------------------------------------------------------------ money ----- */

  /*
    7.5 -> '7.50', 45 -> '45'. Whole euros stay whole — a price list that reads
    "45.00" next to "7.50" looks like a spreadsheet, not a salon. `from` prices
    are floors and must never be presented as fixed.
  */
  function money(price) {
    return price % 1 === 0 ? String(price) : price.toFixed(2);
  }
  function priceLabel(service) {
    return (service.from ? 'from ' : '') + money(service.price);
  }

  /* ------------------------------------------------- staff <-> services --- */

  function service(shop, id) {
    for (var i = 0; i < shop.services.length; i++) {
      if (shop.services[i].id === id) return shop.services[i];
    }
    return null;
  }

  function staffMember(shop, id) {
    for (var i = 0; i < shop.staff.length; i++) {
      if (shop.staff[i].id === id) return shop.staff[i];
    }
    return null;
  }

  /* Can this stylist do this service? The one predicate both directions of the
     exclusion are built on, so they cannot disagree with each other. */
  function canDo(shop, staffId, serviceId) {
    var s = service(shop, serviceId);
    if (!s) return false;
    if (!staffId) return true;            // nobody chosen yet: nothing is excluded
    return s.staff.indexOf(staffId) !== -1;
  }

  /* Services this stylist offers. With no stylist chosen, that is all of them. */
  function servicesFor(shop, staffId) {
    return shop.services.filter(function (s) {
      return !staffId || s.staff.indexOf(staffId) !== -1;
    });
  }

  /* Stylists who offer this service. With no service chosen, that is all. */
  function staffFor(shop, serviceId) {
    var s = serviceId ? service(shop, serviceId) : null;
    return shop.staff.filter(function (p) {
      return !s || s.staff.indexOf(p.id) !== -1;
    });
  }

  /* ------------------------------------------------------------- days ----- */

  function isOpenOn(shop, date) {
    return shop.hours.openDays.indexOf(date.getDay()) !== -1;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }

  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  /* ------------------------------------------------------------ slots ----- */

  /*
    Every start time on `date` at which a `durationMinutes` appointment fits.

    A slot survives four tests:
      1. it starts no earlier than opening;
      2. it ENDS no later than closing — so the last slot of the day moves
         earlier for longer services, rather than letting a 3-hour balayage
         start at 21:45;
      3. it does not overlap the rest break at any point. Not merely "does not
         start during the break" — a 90-minute colour beginning at 13:30 would
         run straight through it, so the test is a true interval overlap;
      4. on today only, it starts at least `leadTimeMinutes` from now.

    Returns [] for a closed day, an unknown duration, or a day already over.
  */
  function slotsFor(shop, date, durationMinutes, now) {
    if (!isOpenOn(shop, date)) return [];
    if (!(durationMinutes > 0)) return [];

    var h = shop.hours;
    var open = parseHM(h.open);
    var close = parseHM(h.close);
    var step = h.slotStepMinutes || 15;
    if (isNaN(open) || isNaN(close) || close <= open) return [];

    var hasBreak = h.break && h.break.start && h.break.end;
    var bStart = hasBreak ? parseHM(h.break.start) : NaN;
    var bEnd = hasBreak ? parseHM(h.break.end) : NaN;
    var breakReal = hasBreak && !isNaN(bStart) && !isNaN(bEnd) && bEnd > bStart;

    /* Same-day cutoff. `now` is injected rather than read from the clock so
       the tests can pin it. */
    var earliest = open;
    if (now && sameDay(date, now)) {
      var mins = now.getHours() * 60 + now.getMinutes() + (h.leadTimeMinutes || 0);
      /* Round up onto the grid so the first offered slot is a real one. */
      earliest = Math.max(open, Math.ceil(mins / step) * step);
    }

    var out = [];
    for (var t = earliest; t + durationMinutes <= close; t += step) {
      if (t < open) continue;
      if (breakReal && t < bEnd && t + durationMinutes > bStart) continue;
      out.push(formatHM(t));
    }
    return out;
  }

  /*
    The next `count` dates from `from` that are open AND have at least one slot
    for this duration. Used to build the date strip — a day that is open but
    already full for a 3-hour service should not be offered.

    `horizon` caps the search so a misconfigured shop (no open days at all)
    cannot spin forever.
  */
  function bookableDays(shop, durationMinutes, from, count, horizon) {
    var out = [];
    var limit = horizon || 90;
    for (var i = 0; i < limit && out.length < (count || 14); i++) {
      var d = addDays(from, i);
      if (!isOpenOn(shop, d)) continue;
      if (slotsFor(shop, d, durationMinutes, from).length === 0) continue;
      out.push(d);
    }
    return out;
  }

  /* ------------------------------------------------------------ hours ----- */

  /*
    The contact section's opening-hours rows, derived from openDays/open/close
    so the published hours cannot drift from the hours the booking page
    actually offers. Sunday first, matching how the rows were already ordered.
  */
  function hoursRows(shop) {
    var h = shop.hours;
    var order = [1, 2, 3, 4, 5, 6, 0];        // Mon..Sun
    return order.map(function (dow) {
      var open = h.openDays.indexOf(dow) !== -1;
      return {
        dow: dow,
        label: h.dayLabels[dow],
        open: open,
        value: open ? (h.open + '-' + h.close) : '/'
      };
    });
  }

  function breakLabel(shop) {
    var b = shop.hours.break;
    if (!b || !b.start || !b.end) return '';
    return b.start + '-' + b.end;
  }

  return {
    parseHM: parseHM,
    formatHM: formatHM,
    money: money,
    priceLabel: priceLabel,
    service: service,
    staffMember: staffMember,
    canDo: canDo,
    servicesFor: servicesFor,
    staffFor: staffFor,
    isOpenOn: isOpenOn,
    sameDay: sameDay,
    addDays: addDays,
    slotsFor: slotsFor,
    bookableDays: bookableDays,
    hoursRows: hoursRows,
    breakLabel: breakLabel
  };
});
