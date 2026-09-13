/*
  UCHI - catalogue loader
  =======================

  window.UchiCatalog.load() resolves to a SHOP object with the same shape as
  assets/booking-data.js, built from the database tables settings, staff,
  services and service_staff (read through the shared public client from
  assets/js/sb.js). The owner edits prices and hours in /admin; this is how
  the booking page follows.

  It never rejects. If the client is missing, a query fails, the tables come
  back empty, or nothing answers within 4 seconds, it resolves the static
  window.SHOP instead. `__source` on the result says which one it is: 'db' or
  'static'. The promise is made once per page load and reused.

  The database may carry one extra field the static file does not:
  hours.bookingHorizonDays (settings.booking_horizon_days).
*/
(function (root) {
  'use strict';

  var DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var cached = null;

  function hm(t) { return t ? String(t).slice(0, 5) : null; }
  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0); }

  /*
    Pure: four row arrays in, SHOP out, or null if the rows cannot make a
    usable catalogue. Exposed for tools/booking-test.mjs.
  */
  function build(rows, fallback) {
    var settings = rows.settings && rows.settings[0];
    if (!settings) return null;
    var staffRows = (rows.staff || []).filter(function (s) { return s.active !== false; })
                                       .slice().sort(bySort);
    if (!staffRows.length) return null;
    var staffIds = staffRows.map(function (s) { return s.id; });

    var links = rows.service_staff || [];
    var services = (rows.services || [])
      .filter(function (s) { return s.active !== false; })
      .slice().sort(bySort)
      .map(function (s) {
        var who = links.filter(function (l) { return l.service_id === s.id; })
                       .map(function (l) { return l.staff_id; })
                       .filter(function (id) { return staffIds.indexOf(id) !== -1; })
                       .sort(function (a, b) { return staffIds.indexOf(a) - staffIds.indexOf(b); });
        return {
          id: s.id,
          name: s.name,
          nl: s.nl,
          price: Number(s.price),
          from: !!s.is_from,
          minutes: Number(s.minutes),
          group: s.grp,
          staff: who
        };
      })
      .filter(function (s) { return s.staff.length > 0 && s.minutes > 0 && !isNaN(s.price); });
    if (!services.length) return null;

    var hasBreak = settings.break_start && settings.break_end;
    var shop = {
      name: (fallback && fallback.name) || 'UCHI',
      hours: {
        openDays: (settings.open_days || []).map(Number),
        open: hm(settings.open_time),
        close: hm(settings.close_time),
        break: hasBreak ? { start: hm(settings.break_start), end: hm(settings.break_end) } : null,
        slotStepMinutes: Number(settings.slot_step_minutes) || 15,
        leadTimeMinutes: Number(settings.lead_time_minutes) || 0,
        bookingHorizonDays: Number(settings.booking_horizon_days) || 60,
        dayLabels: (fallback && fallback.hours && fallback.hours.dayLabels) || DAY_LABELS
      },
      staff: staffRows.map(function (s) { return { id: s.id, name: s.name, role: s.role }; }),
      services: services
    };
    shop.__source = 'db';
    return shop;
  }

  function fallback() {
    var shop = root.SHOP;
    if (shop) shop.__source = 'static';
    return shop;
  }

  function fetchAll(client) {
    function q(table) {
      return client.from(table).select('*').then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
    }
    return Promise.all([q('settings'), q('staff'), q('services'), q('service_staff')])
      .then(function (a) {
        return build({ settings: a[0], staff: a[1], services: a[2], service_staff: a[3] }, root.SHOP);
      });
  }

  function load(opts) {
    if (cached) return cached;
    var timeoutMs = (opts && opts.timeoutMs) || 4000;
    cached = new Promise(function (resolve) {
      var done = false;
      function finish(shop) {
        if (done) return;
        done = true;
        resolve(shop || fallback());
      }
      var timer = setTimeout(function () { finish(null); }, timeoutMs);
      try {
        var db = root.UchiDB;
        var client = db && db.client ? db.client() : null;
        if (!client) { clearTimeout(timer); finish(null); return; }
        fetchAll(client).then(function (shop) { clearTimeout(timer); finish(shop); },
                              function () { clearTimeout(timer); finish(null); });
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    });
    return cached;
  }

  root.UchiCatalog = { load: load, build: build };
})(typeof window !== 'undefined' ? window : this);
