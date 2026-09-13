/*
  UCHI — booking core
  ===================

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

  /* --------------------------------------------------- sets of services --- */

  /*
    A booking is a set, not one item: a cut and a colour and a wash are one
    visit. Everything below takes an array of service ids, and every one of them
    is defined so that the empty set means "nothing chosen yet, nothing ruled
    out" rather than "nothing is possible".
  */

  function servicesIn(shop, ids) {
    return (ids || []).map(function (id) { return service(shop, id); })
                      .filter(Boolean);
  }

  /*
    Two services clash when they share a group, because a group holds
    alternatives to one another - the four ways to book a cut, the five colour
    processes. Booking two of those together would sell the same appointment
    twice. Services in different groups combine freely.
  */
  function clashes(shop, ids, candidateId) {
    var c = service(shop, candidateId);
    if (!c) return false;
    return servicesIn(shop, ids).some(function (s) {
      return s.id !== c.id && s.group === c.group;
    });
  }

  /* Can this stylist do EVERY service in the set? */
  function canDoAll(shop, staffId, ids) {
    if (!staffId) return true;
    return servicesIn(shop, ids).every(function (s) {
      return s.staff.indexOf(staffId) !== -1;
    });
  }

  /* Stylists able to take the whole set. Empty set => everyone. */
  function staffForSet(shop, ids) {
    return shop.staff.filter(function (p) { return canDoAll(shop, p.id, ids); });
  }

  /* Whether the set can be extended by this service, ignoring who does it. */
  function canAdd(shop, ids, candidateId) {
    if ((ids || []).indexOf(candidateId) !== -1) return true;   // already in: removable
    return !clashes(shop, ids, candidateId);
  }

  function totalMinutes(shop, ids) {
    return servicesIn(shop, ids).reduce(function (n, s) { return n + s.minutes; }, 0);
  }

  /*
    One "from" anywhere in the set makes the whole total a floor. Adding a
    fixed 45 to a "from 160" cannot produce a fixed 205 - the balayage half can
    still move, so the sum can only be quoted as a minimum.
  */
  function totalPriceLabel(shop, ids) {
    var set = servicesIn(shop, ids);
    if (!set.length) return '';
    var sum = set.reduce(function (n, s) { return n + s.price; }, 0);
    var floor = set.some(function (s) { return s.from; });
    return (floor ? 'from ' : '') + money(sum);
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

  /*
    The same seven rows, with consecutive days that share a value collapsed into
    one range: five identical weekday lines become "MON-FRI  10:00-22:00".
    Five rows saying the same thing is five chances to read the same fact, which
    is four more than anyone needs.

    Collapsing is computed from the values rather than hard-coded to Mon-Fri, so
    if the shop ever opens on a Saturday, or closes on a Wednesday, the summary
    re-splits itself correctly instead of quietly lying.
  */
  function hoursSummary(shop) {
    var rows = hoursRows(shop);
    var runs = [], current = null;
    rows.forEach(function (r) {
      if (current && current.value === r.value) { current.end = r; return; }
      if (current) runs.push(current);
      current = { start: r, end: r, value: r.value, open: r.open };
    });
    if (current) runs.push(current);
    return runs.map(function (g) {
      return {
        label: g.start === g.end ? g.start.label : g.start.label + '-' + g.end.label,
        value: g.value,
        open: g.open
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
    servicesIn: servicesIn,
    clashes: clashes,
    canDoAll: canDoAll,
    staffForSet: staffForSet,
    canAdd: canAdd,
    totalMinutes: totalMinutes,
    totalPriceLabel: totalPriceLabel,
    hoursSummary: hoursSummary,
    isOpenOn: isOpenOn,
    sameDay: sameDay,
    addDays: addDays,
    slotsFor: slotsFor,
    bookableDays: bookableDays,
    hoursRows: hoursRows,
    breakLabel: breakLabel
  };
});
