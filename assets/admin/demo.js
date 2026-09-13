/*
  UCHI admin, demo data.

  /admin?demo=1 renders every panel with invented bookings and images held in
  memory, for screenshots and checks without a real login. It never talks to
  the database: no client is created and nothing leaves the page.

  The guard is on the HOST, not on a flag anyone can type: on any address other
  than localhost / 127.0.0.1 the parameter is ignored and the normal sign-in
  screen appears. tools/admin-check.mjs tests both sides of that.
*/
(function (root) {
  'use strict';

  function demoAllowed(hostname, search) {
    var h = String(hostname || '').toLowerCase();
    var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
    if (!local) return false;
    var m = /[?&]demo=([^&#]*)/.exec(String(search || ''));
    return !!m && m[1] === '1';
  }

  if (typeof module === 'object' && module.exports) module.exports = { demoAllowed: demoAllowed };
  if (!root) return;

  var UA = root.UA = root.UA || {};
  UA.demoAllowed = demoAllowed;

  UA.demoApi = function () {
    if (!demoAllowed(location.hostname, location.search)) return null;
    var T = root.UchiTZ;
    var wait = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 120); }); };
    var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
    var fail = function (code, message) { var e = new Error(message); e.code = code; return Promise.reject(e); };

    var db = {
      settings: { id: 1, open_days: [1, 2, 3, 4, 5], open_time: '10:00:00', close_time: '22:00:00',
        break_start: '14:00:00', break_end: '15:00:00', slot_step_minutes: 15, lead_time_minutes: 60,
        booking_horizon_days: 60, updated_at: new Date().toISOString() },
      staff: [
        { id: 'labi', name: 'LABI', role: 'Hairstylist', sort: 10, active: true },
        { id: 'donovan', name: 'DONOVAN', role: 'Hairstylist', sort: 20, active: true }
      ],
      services: [],
      service_staff: [],
      bookings: [],
      time_off: [],
      gallery_images: [],
      admins: [{ email: 'owner@uchi.be' }, { email: 'donovan@uchi.be' }]
    };

    (root.SHOP ? root.SHOP.services : []).forEach(function (s, i) {
      db.services.push({ id: s.id, name: s.name, nl: s.nl, price: s.price, is_from: s.from,
        minutes: s.minutes, grp: s.group, sort: (i + 1) * 10, active: true });
      s.staff.forEach(function (st) { db.service_staff.push({ service_id: s.id, staff_id: st }); });
    });
    var svc = function (id) { return db.services.filter(function (s) { return s.id === id; })[0]; };

    var names = [['Sara Peeters', '+32 470 12 34 56', 'sara.peeters@example.com'],
      ['Yusuf Demir', '+32 486 22 10 09', 'yusuf@example.com'],
      ['Lotte Janssens', '0499 55 44 33', ''],
      ['Amir Haddad', '+32 478 90 12 12', 'amir.h@example.com'],
      ['Noor Van Dyck', '0468 11 22 33', 'noor.vd@example.com'],
      ['Jonas Maes', '+32 471 00 88 77', 'jonas.maes@example.com']];
    var plan = [
      [0, '10:00', 'labi', ['knippen', 'wassen'], 'completed', 'online', null],
      [0, '11:15', 'donovan', ['balayage'], 'confirmed', 'online', 'Wants to keep the length'],
      [0, '15:00', 'labi', ['knippen'], 'confirmed', 'admin', 'Walk-in'],
      [0, '16:30', 'donovan', ['roots', 'toner'], 'confirmed', 'online', null],
      [0, '18:00', 'labi', ['blowdry'], 'cancelled', 'online', null],
      [1, '10:30', 'donovan', ['highlights', 'knippen'], 'confirmed', 'online', null],
      [1, '13:00', 'labi', ['knippen', 'blowdry'], 'confirmed', 'admin', null],
      [2, '17:00', 'donovan', ['kleuring'], 'confirmed', 'online', 'Allergic to ammonia, patch test done'],
      [4, '12:00', 'labi', ['wassen', 'blowdry'], 'confirmed', 'online', null],
      [-1, '10:00', 'donovan', ['balayage', 'toner'], 'completed', 'online', null],
      [-1, '19:00', 'labi', ['knippen'], 'no_show', 'online', null],
      [-3, '11:00', 'donovan', ['knippen'], 'completed', 'admin', null]
    ];
    var today = T.today();
    plan.forEach(function (p, i) {
      var date = T.addDays(today, p[0]);
      var list = p[3].map(svc).filter(Boolean);
      var minutes = list.reduce(function (a, s) { return a + s.minutes; }, 0);
      var start = T.toInstant(date, p[1]);
      var who = names[i % names.length];
      db.bookings.push({ id: 'demo-b' + i, created_at: new Date().toISOString(),
        starts_at: start.toISOString(), ends_at: new Date(start.getTime() + minutes * 60000).toISOString(),
        staff_id: p[2], service_ids: p[3],
        total_price: list.reduce(function (a, s) { return a + s.price; }, 0),
        price_is_from: list.some(function (s) { return s.is_from; }), total_minutes: minutes,
        customer_name: who[0], customer_phone: who[1], customer_email: who[2],
        notes: p[6], status: p[4], source: p[5] });
    });
    db.time_off.push({ id: 'demo-t1', staff_id: null, starts_at: T.toInstant(T.addDays(today, 20), '00:00').toISOString(),
      ends_at: T.toInstant(T.addDays(today, 23), '00:00').toISOString(), reason: 'Salon closed for renovation' });
    db.time_off.push({ id: 'demo-t2', staff_id: 'labi', starts_at: T.toInstant(T.addDays(today, 6), '10:00').toISOString(),
      ends_at: T.toInstant(T.addDays(today, 6), '14:00').toISOString(), reason: 'Training' });

    /* Placeholder photographs drawn on a canvas: grey fields with a black rule. */
    var urls = {};
    function placeholder(n, w, h) {
      var cv = document.createElement('canvas'); cv.width = w / 4; cv.height = h / 4;
      var x = cv.getContext('2d');
      var g = x.createLinearGradient(0, 0, cv.width, cv.height);
      g.addColorStop(0, ['#d9d9d9', '#bdbdbd', '#e8e8e8', '#9e9e9e', '#cfcfcf', '#b0b0b0', '#dedede'][n % 7]);
      g.addColorStop(1, '#5a5a5a');
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#000'; x.fillRect(cv.width * 0.1, cv.height * 0.8, cv.width * 0.3, 3);
      return cv.toDataURL('image/png');
    }
    var captions = ['Short textured crop', 'Soft balayage', null, 'Blunt bob', 'Copper roots', 'Fade and wash', 'Toner, cool finish'];
    captions.forEach(function (cap, i) {
      var w = i % 2 ? 1600 : 1500, h = i % 2 ? 2000 : 2000;
      var path = '2026/08/demo-' + i + '.webp';
      urls[path] = placeholder(i, w, h);
      db.gallery_images.push({ id: 'demo-g' + i, created_at: new Date().toISOString(), path: path,
        caption: cap, alt: cap ? cap + ', black and white photograph' : null, sort: (i + 1) * 10,
        published: i !== 2, width: w, height: h });
    });

    function find(table, key, val) {
      return db[table].filter(function (r) { return r[key] === val; })[0];
    }
    function overlaps(b, ignoreId) {
      return db.bookings.some(function (o) {
        return o.id !== ignoreId && o.status === 'confirmed' && o.staff_id === b.staff_id
          && new Date(o.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(o.ends_at);
      });
    }

    var session = { user: { email: 'owner@uchi.be' } };
    return {
      demo: true,
      auth: {
        session: function () { return wait(session); },
        signIn: function () { return wait(session); },
        signUp: function () { return wait({}); },
        signOut: function () { return wait(null); },
        resetPassword: function () { return wait(); },
        updatePassword: function () { return wait(); },
        onChange: function () {},
        consumeRedirect: function () { return Promise.resolve(null); }
      },
      checkAccess: function () { return wait(true); },
      getSettings: function () { return wait(copy(db.settings)); },
      updateSettings: function (patch) { Object.assign(db.settings, patch); return wait(copy(db.settings)); },
      listStaff: function () { return wait(copy(db.staff).sort(function (a, b) { return a.sort - b.sort; })); },
      updateStaff: function (id, patch) { var r = find('staff', 'id', id); Object.assign(r, patch); return wait(copy(r)); },
      listServices: function () { return wait(copy(db.services).sort(function (a, b) { return a.sort - b.sort; })); },
      updateService: function (id, patch) { var r = find('services', 'id', id); Object.assign(r, patch); return wait(copy(r)); },
      listServiceStaff: function () { return wait(copy(db.service_staff)); },
      setServiceStaff: function (serviceId, ids) {
        db.service_staff = db.service_staff.filter(function (r) { return r.service_id !== serviceId; })
          .concat(ids.map(function (s) { return { service_id: serviceId, staff_id: s }; }));
        return wait();
      },
      listBookings: function (from, to, asc) {
        var rows = db.bookings.filter(function (b) {
          return new Date(b.starts_at) >= new Date(from) && new Date(b.starts_at) < new Date(to);
        }).sort(function (a, b) { return (new Date(a.starts_at) - new Date(b.starts_at)) * (asc === false ? -1 : 1); });
        return wait(copy(rows));
      },
      updateBooking: function (id, patch) {
        var r = find('bookings', 'id', id);
        if (patch.status === 'confirmed' && overlaps(r, id))
          return fail('23P01', 'conflicting key value violates exclusion constraint');
        Object.assign(r, patch); return wait(copy(r));
      },
      insertBooking: function (row) {
        if (overlaps(row)) return fail('23P01', 'conflicting key value violates exclusion constraint');
        var r = Object.assign({ id: 'demo-b' + Date.now(), created_at: new Date().toISOString() }, row);
        db.bookings.push(r); return wait(copy(r));
      },
      listTimeOff: function () { return wait(copy(db.time_off).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); })); },
      insertTimeOff: function (row) { var r = Object.assign({ id: 'demo-t' + Date.now() }, row); db.time_off.push(r); return wait(copy(r)); },
      deleteTimeOff: function (id) { db.time_off = db.time_off.filter(function (r) { return r.id !== id; }); return wait({ id: id }); },
      listGallery: function () { return wait(copy(db.gallery_images).sort(function (a, b) { return a.sort - b.sort; })); },
      insertGallery: function (row) { var r = Object.assign({ id: 'demo-g' + Date.now() + Math.random(), created_at: new Date().toISOString() }, row); db.gallery_images.push(r); return wait(copy(r)); },
      updateGallery: function (id, patch) { var r = find('gallery_images', 'id', id); Object.assign(r, patch); return wait(copy(r)); },
      deleteGallery: function (row) { db.gallery_images = db.gallery_images.filter(function (r) { return r.id !== row.id; }); return wait(row); },
      uploadImage: function (path, blob) { urls[path] = URL.createObjectURL(blob); return wait({ path: path }); },
      removeObject: function () { return wait(); },
      imageUrl: function (path) { return urls[path] || ''; },
      listAdmins: function () { return wait(copy(db.admins)); },
      addAdmin: function (email) {
        if (find('admins', 'email', email)) return fail('23505', 'duplicate key');
        db.admins.push({ email: email }); return wait({ email: email });
      },
      removeAdmin: function (email) {
        if (db.admins.length < 2) return fail('P0001', 'cannot delete the last admin');
        db.admins = db.admins.filter(function (a) { return a.email !== email; }); return wait({ email: email });
      }
    };
  };
})(typeof window !== 'undefined' ? window : null);
