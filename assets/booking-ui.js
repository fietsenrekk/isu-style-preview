/*
  UCHI - booking UI
  =================

  Renders the four choices (stylist, services, day, time) and the details form,
  then hands the finished booking to assets/booking-provider.js, which books it
  through the database.

  All decision-making lives in booking-core.js. This file only draws what the
  core says is possible and reports what the visitor picked, which is why the
  two awkward parts need no special-casing here:

    - a booking is a SET of services, so the page asks the core which stylists
      can take the whole set and which services can still be added to it;
    - the exclusions run in both directions off one list, so choosing Labi
      greys the colour work and choosing colour work greys Labi, without either
      rule being written twice.

  Data:
    - first paint uses the static catalogue (window.SHOP) so the page is
      usable at once; when UchiCatalog.load() brings the database catalogue it
      replaces the static one, but only if the visitor has not picked anything
      yet, so nothing moves under their finger;
    - taken time comes from rpc('busy_slots') for today..horizon, fetched once
      and again when a choice changes after it has gone a minute stale, or when
      the server says a time was just taken. Only times where the chosen
      stylist (or, with no preference, any stylist able to do the whole set)
      is free are offered. If busy_slots cannot be reached, every time on the
      grid is offered and the page says availability was not checked; the
      server still refuses a taken slot.

  Progressive enhancement: without this script the page still shows the full
  price list, the opening hours and the phone number, marked up in the HTML.
*/

(function () {
  'use strict';

  var SHOP = window.SHOP;
  var Core = window.BookingCore;
  var mount = document.getElementById('booking');
  if (!SHOP || !Core || !mount) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The whole of the visitor's progress. */
  var pick = { staff: null, services: [], date: null, time: null };

  /* Taken time. status: 'loading' | 'ok' | 'failed'. ranges null = unknown. */
  var busy = { status: 'loading', ranges: null, at: 0, seq: 0 };
  var STALE_MS = 60000;

  /* ------------------------------------------------------------ helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function dateKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function longDate(d) {
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function horizon() {
    return Math.min(SHOP.hours.bookingHorizonDays || 60, 61);
  }

  /* Who could take the current set: the chosen stylist, or everyone able. */
  function candidates() {
    if (pick.staff) return [pick.staff];
    return Core.staffForSet(SHOP, pick.services).map(function (p) { return p.id; });
  }

  /* Anything that changes what is being booked invalidates the day and time. */
  function resetWhen() { pick.date = null; pick.time = null; }

  /* ------------------------------------------------------------ busy ----- */

  function fetchBusy() {
    var seq = ++busy.seq;
    var db = window.UchiDB;
    var client = null;
    try { client = db && db.client ? db.client() : null; } catch (e) { client = null; }
    if (!client) {
      busy.status = 'failed'; busy.ranges = null; busy.at = Date.now();
      render();
      return Promise.resolve();
    }
    busy.status = 'loading';
    render();
    var today = Core.brusselsToday(new Date());
    var args = { p_from: Core.isoDate(today), p_to: Core.isoDate(Core.addDays(today, horizon())) };
    return Promise.resolve()
      .then(function () { return client.rpc('busy_slots', args); })
      .then(function (r) {
        if (seq !== busy.seq) return;
        if (r.error || !Array.isArray(r.data)) { busy.status = 'failed'; busy.ranges = null; }
        else { busy.status = 'ok'; busy.ranges = r.data; }
        busy.at = Date.now();
        render();
      }, function () {
        if (seq !== busy.seq) return;
        busy.status = 'failed'; busy.ranges = null; busy.at = Date.now();
        render();
      });
  }

  function refreshIfStale() {
    if (busy.status !== 'loading' && Date.now() - busy.at > STALE_MS) fetchBusy();
  }

  /* ------------------------------------------------------------ sections -- */

  function step(n, title) {
    var s = el('section', 'step');
    s.dataset.step = n;
    var h = el('h2', 'step__head');
    h.appendChild(el('span', 'step__n', String(n)));
    h.appendChild(el('span', 'step__t', title));
    s.appendChild(h);
    s.appendChild(el('div', 'step__body'));
    return s;
  }

  var stepStaff   = step(1, 'STYLIST');
  var stepService = step(2, 'SERVICES');
  var stepDate    = step(3, 'DAY');
  var stepTime    = step(4, 'TIME');
  var stepDetails = step(5, 'YOUR DETAILS');

  /* --------------------------------------------------------------- rows --- */

  function row(labelText, valueText) {
    var b = el('button', 'item item--pick');
    b.type = 'button';
    b.appendChild(el('span', 'desc', labelText));
    b.appendChild(el('span', 'value', valueText));
    return b;
  }

  function setPicked(node, on) {
    node.classList.toggle('is-picked', on);
    node.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function setDisabled(node, on, why) {
    node.classList.toggle('is-off', on);
    node.disabled = on;
    if (on && why) node.title = why;
    else node.removeAttribute('title');
  }

  /* ------------------------------------------------------------- step 1 --- */

  var staffNodes = {};
  function buildStaff() {
    var body = stepStaff.querySelector('.step__body');
    body.textContent = '';
    staffNodes = {};
    var wrap = el('div', 'box');
    wrap.appendChild(el('span', 'rule'));
    SHOP.staff.forEach(function (person) {
      var b = row(person.name, person.role);
      b.addEventListener('click', function () {
        pick.staff = (pick.staff === person.id) ? null : person.id;
        /* Drop anything the newly chosen stylist cannot do. */
        if (pick.staff) {
          var keep = pick.services.filter(function (id) {
            return Core.canDo(SHOP, pick.staff, id);
          });
          if (keep.length !== pick.services.length) { pick.services = keep; resetWhen(); }
        }
        /* A different stylist has different free times. */
        pick.time = null;
        clearTimeAlert();
        refreshIfStale();
        render();
      });
      staffNodes[person.id] = b;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.appendChild(el('p', 'step__hint',
      'Either stylist, or skip and let the services decide.'));
  }

  /* ------------------------------------------------------------- step 2 --- */

  var serviceNodes = {};
  function buildServices() {
    var body = stepService.querySelector('.step__body');
    body.textContent = '';
    serviceNodes = {};
    var wrap = el('div', 'box');
    wrap.appendChild(el('span', 'rule'));
    SHOP.services.forEach(function (sv) {
      var b = row(sv.name, Core.priceLabel(sv));
      b.addEventListener('click', function () {
        var at = pick.services.indexOf(sv.id);
        if (at === -1) pick.services.push(sv.id);
        else pick.services.splice(at, 1);
        resetWhen();
        clearTimeAlert();
        /* One able stylist left: choose them. A stylist who can no longer
           take the set: clear them. */
        var able = Core.staffForSet(SHOP, pick.services);
        if (pick.services.length && able.length === 1) pick.staff = able[0].id;
        else if (pick.staff && !Core.canDoAll(SHOP, pick.staff, pick.services)) pick.staff = null;
        refreshIfStale();
        render();
      });
      serviceNodes[sv.id] = b;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);

    var total = el('p', 'step__total');
    total.id = 'svc-total';
    body.appendChild(total);

    body.appendChild(el('p', 'step__hint legend',
      'Choose one or more services. A cut, a colour and a wash can be booked in '
      + 'the same visit. Prices are in euro and depend on the length of your hair '
      + 'and the work involved. Everyone pays the same.'));
  }

  /* ------------------------------------------------------------- step 3 --- */

  var dateStrip = el('div', 'strip');
  stepDate.querySelector('.step__body').appendChild(dateStrip);

  function currentBusy() {
    return busy.status === 'ok' ? busy.ranges : null;
  }

  function buildDates() {
    dateStrip.textContent = '';
    var mins = Core.totalMinutes(SHOP, pick.services);
    if (!mins) return;
    if (busy.status === 'loading') {
      dateStrip.appendChild(el('p', 'step__hint', 'Checking availability'));
      return;
    }
    var days = Core.bookableDaysFree(SHOP, mins, new Date(), 10, horizon(),
                                     currentBusy(), candidates());
    if (pick.date && !days.some(function (d) { return dateKey(d) === dateKey(pick.date); })) {
      pick.date = null; pick.time = null;
    }
    if (!days.length) {
      dateStrip.appendChild(el('p', 'step__hint',
        'There is no free time for this booking online. Please call the salon on '
        + window.BookingProvider.phone + '.'));
      return;
    }
    days.forEach(function (d) {
      var b = el('button', 'chip chip--day');
      b.type = 'button';
      b.appendChild(el('span', 'chip__dow', DAYS[d.getDay()]));
      b.appendChild(el('span', 'chip__num', String(d.getDate())));
      b.appendChild(el('span', 'chip__mon', MONTHS[d.getMonth()]));
      setPicked(b, !!(pick.date && dateKey(pick.date) === dateKey(d)));
      b.addEventListener('click', function () {
        var same = pick.date && dateKey(pick.date) === dateKey(d);
        pick.date = same ? null : d;
        pick.time = null;
        clearTimeAlert();
        render();
      });
      dateStrip.appendChild(b);
    });
  }

  /* ------------------------------------------------------------- step 4 --- */

  var timeAlert = el('p', 'step__hint');
  var timeGrid = el('div', 'grid');
  var timeNote = el('p', 'step__hint');
  stepTime.querySelector('.step__body').appendChild(timeAlert);
  stepTime.querySelector('.step__body').appendChild(timeGrid);
  stepTime.querySelector('.step__body').appendChild(timeNote);

  function clearTimeAlert() {
    timeAlert.textContent = '';
    timeAlert.removeAttribute('role');
  }

  function buildTimes() {
    timeGrid.textContent = '';
    timeNote.textContent = '';
    var mins = Core.totalMinutes(SHOP, pick.services);
    if (!mins || !pick.date) return;
    if (busy.status === 'loading') {
      timeGrid.appendChild(el('p', 'step__hint', 'Checking availability'));
      return;
    }
    var slots = Core.freeSlotsFor(SHOP, pick.date, mins, new Date(),
                                  currentBusy(), candidates());
    if (pick.time && slots.indexOf(pick.time) === -1) pick.time = null;
    if (!slots.length) {
      timeGrid.appendChild(el('p', 'step__hint', 'Nothing left on this day.'));
      return;
    }
    slots.forEach(function (t) {
      var b = el('button', 'chip chip--time', t);
      b.type = 'button';
      setPicked(b, pick.time === t);
      b.addEventListener('click', function () {
        pick.time = (pick.time === t) ? null : t;
        clearTimeAlert();
        render();
      });
      timeGrid.appendChild(b);
    });
    var br = Core.breakLabel(SHOP);
    timeNote.textContent = (busy.status === 'failed'
        ? 'Availability could not be checked right now, so some of these times may '
          + 'already be taken. If yours is, you will be asked to pick another. '
        : '')
      + 'Times are salon time. '
      + (br ? 'Closed for a break ' + br + '. ' : '')
      + 'Your booking takes about ' + mins + ' minutes.';
  }

  /* ------------------------------------------------------------- step 5 --- */

  var form, summary, noteNode;
  (function buildDetails() {
    var body = stepDetails.querySelector('.step__body');
    form = el('form', 'bform');
    form.noValidate = false;

    [['name', 'NAME', 'text', true, 'name', 80],
     ['email', 'E-MAIL', 'email', true, 'email', 120],
     ['phone', 'PHONE', 'tel', true, 'tel', 30],
     ['notes', 'ANYTHING WE SHOULD KNOW', 'textarea', false, 'off', 500]
    ].forEach(function (f) {
      var wrap = el('label', 'bfield');
      wrap.appendChild(el('span', 'bfield__l', f[1] + (f[3] ? '' : ' (optional)')));
      var input = f[2] === 'textarea' ? el('textarea') : el('input');
      if (f[2] !== 'textarea') input.type = f[2];
      input.name = f[0];
      input.required = f[3];
      input.autocomplete = f[4];
      input.maxLength = f[5];
      if (f[2] === 'textarea') input.rows = 3;
      wrap.appendChild(input);
      form.appendChild(wrap);
    });

    /* Honeypot. People never see or reach it; form-filling bots tend to fill
       anything called "website". The server refuses a booking that has it. */
    var trap = el('div');
    trap.setAttribute('aria-hidden', 'true');
    trap.style.position = 'absolute';
    trap.style.left = '-10000px';
    trap.style.top = 'auto';
    trap.style.width = '1px';
    trap.style.height = '1px';
    trap.style.overflow = 'hidden';
    var hp = el('input');
    hp.type = 'text';
    hp.name = 'website';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    trap.appendChild(hp);
    form.appendChild(trap);

    summary = el('p', 'bsummary');
    form.appendChild(summary);

    var submit = el('button', 'bsubmit', 'BOOK THIS APPOINTMENT');
    submit.type = 'submit';
    form.appendChild(submit);

    noteNode = el('p', 'step__hint bnote', '');
    form.appendChild(noteNode);

    var sending = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      if (!form.reportValidity()) return;
      if (!pick.services.length || !pick.date || !pick.time) return;
      var field = function (n) { return form.elements.namedItem(n).value.trim(); };
      var set = Core.servicesIn(SHOP, pick.services);
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff) : null;
      sending = true;
      window.BookingProvider.submit({
        shop: SHOP.name,
        staffId: pick.staff,
        staffName: who ? who.name : 'First available stylist',
        services: set.map(function (s) {
          return { id: s.id, name: s.name, nl: s.nl,
                   price: Core.priceLabel(s), minutes: s.minutes };
        }),
        price: Core.totalPriceLabel(SHOP, pick.services),
        minutes: Core.totalMinutes(SHOP, pick.services),
        date: pick.date,
        isoDate: Core.isoDate(pick.date),
        dateLabel: longDate(pick.date),
        time: pick.time,
        name: field('name'),
        email: field('email'),
        phone: field('phone'),
        notes: field('notes'),
        hp: form.elements.namedItem('website').value
      }, form, {
        onRetime: function (code) {
          timeAlert.setAttribute('role', 'alert');
          timeAlert.textContent = window.BookingProvider.message(code);
          noteNode.removeAttribute('role');
          noteNode.textContent = '';
          pick.time = null;
          fetchBusy();
          stepTime.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        },
        onBooked: function () { booked = true; }
      }).then(function () { sending = false; });
    });

    body.appendChild(form);
  })();

  var booked = false;

  /* -------------------------------------------------------------- render -- */

  function render() {
    if (booked) return;
    var set = pick.services;

    SHOP.staff.forEach(function (p) {
      var node = staffNodes[p.id];
      if (!node) return;
      var blocked = set.length && !Core.canDoAll(SHOP, p.id, set);
      var cannot = Core.servicesIn(SHOP, set).filter(function (s) {
        return s.staff.indexOf(p.id) === -1;
      });
      setDisabled(node, !!blocked, blocked
        ? p.name + ' does not do ' + cannot.map(function (s) { return s.name; }).join(' or ')
        : '');
      setPicked(node, pick.staff === p.id);
    });

    SHOP.services.forEach(function (sv) {
      var node = serviceNodes[sv.id];
      if (!node) return;
      var picked = set.indexOf(sv.id) !== -1;
      var byStaff = pick.staff && !Core.canDo(SHOP, pick.staff, sv.id);
      var byGroup = !picked && Core.clashes(SHOP, set, sv.id);
      var other = byGroup ? Core.servicesIn(SHOP, set).filter(function (s) {
        return s.group === sv.group;
      })[0] : null;
      setDisabled(node, !!(byStaff || byGroup),
        byStaff ? Core.staffMember(SHOP, pick.staff).name + ' does not do ' + sv.name
        : byGroup ? 'You already chose ' + other.name + '. Pick one of the two.'
        : '');
      setPicked(node, picked);
    });

    var totalNode = document.getElementById('svc-total');
    if (totalNode) {
      totalNode.textContent = set.length
        ? set.length + (set.length === 1 ? ' service · ' : ' services · ')
          + Core.totalPriceLabel(SHOP, set) + ' euro · about '
          + Core.totalMinutes(SHOP, set) + ' minutes'
        : '';
    }

    buildDates();
    buildTimes();

    stepDate.classList.toggle('is-open', set.length > 0);
    stepTime.classList.toggle('is-open', !!(set.length && pick.date));
    stepDetails.classList.toggle('is-open', !!(set.length && pick.date && pick.time));

    if (set.length && pick.date && pick.time) {
      var names = Core.servicesIn(SHOP, set).map(function (s) { return s.name; }).join(' + ');
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff).name : 'first available stylist';
      summary.textContent = names + ' · ' + Core.totalPriceLabel(SHOP, set)
        + ' euro · with ' + who + ' · ' + longDate(pick.date) + ' at ' + pick.time;
    }

    if (noteNode && !noteNode.getAttribute('role')) {
      noteNode.textContent = window.BookingProvider.note || '';
    }
  }

  /* --------------------------------------------------------------- boot --- */

  buildStaff();
  buildServices();
  mount.textContent = '';
  mount.appendChild(stepStaff);
  mount.appendChild(stepService);
  mount.appendChild(stepDate);
  mount.appendChild(stepTime);
  mount.appendChild(stepDetails);
  mount.classList.add('is-live');
  if (reduce) mount.classList.add('no-motion');
  render();

  fetchBusy();

  if (window.UchiCatalog && window.UchiCatalog.load) {
    window.UchiCatalog.load().then(function (shop) {
      if (!shop || shop === SHOP || shop.__source !== 'db') return;
      if (pick.staff || pick.services.length) return;
      var oldHorizon = horizon();
      SHOP = shop;
      buildStaff();
      buildServices();
      render();
      if (horizon() !== oldHorizon) fetchBusy();
    });
  }
})();
