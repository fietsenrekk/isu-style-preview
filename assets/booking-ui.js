/*
  UCHI — booking UI
  =================

  Renders the four choices (stylist, services, day, time) and the details form,
  then hands the finished booking to whatever provider is configured in
  assets/booking-provider.js.

  All decision-making lives in booking-core.js. This file only draws what the
  core says is possible and reports what the visitor picked, which is why the
  two awkward parts need no special-casing here:

    - a booking is a SET of services, so the page asks the core which stylists
      can take the whole set and which services can still be added to it;
    - the exclusions run in both directions off one list, so choosing Labi
      greys the colour work and choosing colour work greys Labi, without either
      rule being written twice.

  Progressive enhancement: without this script the page still shows the full
  price list, the opening hours and the phone number, marked up in the HTML.
  This script replaces that static block with the interactive one. Nothing the
  visitor needs is created by JavaScript alone.
*/

(function () {
  'use strict';

  var SHOP = window.SHOP;
  var Core = window.BookingCore;
  var mount = document.getElementById('booking');
  if (!SHOP || !Core || !mount) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The whole of the visitor's progress. Nothing else holds state. */
  var pick = { staff: null, services: [], date: null, time: null };

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
  function chosen() { return pick.services.slice(); }

  /* Anything that changes what is being booked invalidates the day and time,
     because both were calculated from a duration that has just changed. */
  function resetWhen() { pick.date = null; pick.time = null; }

  /* ------------------------------------------------------------ sections -- */

  /*
    Each step is a <section> that is present from the start but inert until it
    has something to show. Revealing by class rather than by building nodes on
    demand keeps the page height honest as you go and lets the transition be
    pure CSS.
  */
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

  /*
    One row of the price-list lockup: label right-aligned against the centre
    rule, value left-aligned after it. The same geometry the contact section
    uses, so the booking page reads as part of the same object rather than a
    form bolted onto it.
  */
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
  (function buildStaff() {
    var body = stepStaff.querySelector('.step__body');
    var wrap = el('div', 'box');
    wrap.appendChild(el('span', 'rule'));
    SHOP.staff.forEach(function (person) {
      var b = row(person.name, person.role);
      b.addEventListener('click', function () {
        pick.staff = (pick.staff === person.id) ? null : person.id;
        /*
          Drop anything the newly chosen stylist cannot do. The disabled state
          normally makes this unreachable, but state that stays valid only
          because the UI refuses to be clicked is state waiting to go wrong.
        */
        if (pick.staff) {
          var keep = pick.services.filter(function (id) {
            return Core.canDo(SHOP, pick.staff, id);
          });
          if (keep.length !== pick.services.length) { pick.services = keep; resetWhen(); }
        }
        render();
      });
      staffNodes[person.id] = b;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.appendChild(el('p', 'step__hint',
      'Either stylist, or skip and let the services decide.'));
  })();

  /* ------------------------------------------------------------- step 2 --- */

  var serviceNodes = {};
  (function buildServices() {
    var body = stepService.querySelector('.step__body');
    var wrap = el('div', 'box');
    wrap.appendChild(el('span', 'rule'));
    SHOP.services.forEach(function (sv) {
      var b = row(sv.name, Core.priceLabel(sv));
      b.addEventListener('click', function () {
        var at = pick.services.indexOf(sv.id);
        if (at === -1) pick.services.push(sv.id);
        else pick.services.splice(at, 1);
        resetWhen();
        /*
          If only one stylist can take everything now selected, select them.
          Asking someone to choose balayage and then choose the only person who
          does balayage is a question with one possible answer.

          If a stylist was already chosen and the set has moved beyond them,
          they are cleared rather than left standing as a contradiction that
          the greyed-out row is quietly hiding.
        */
        var able = Core.staffForSet(SHOP, pick.services);
        if (pick.services.length && able.length === 1) pick.staff = able[0].id;
        else if (pick.staff && !Core.canDoAll(SHOP, pick.staff, pick.services)) pick.staff = null;
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
      'Pick as many as go together — a cut, a colour and a wash are one visit. '
      + 'One list for everyone: prices are in euro and follow the length of your '
      + 'hair and the work it takes.'));
  })();

  /* ------------------------------------------------------------- step 3 --- */

  var dateStrip = el('div', 'strip');
  stepDate.querySelector('.step__body').appendChild(dateStrip);

  function buildDates() {
    dateStrip.textContent = '';
    var mins = Core.totalMinutes(SHOP, pick.services);
    if (!mins) return;
    var days = Core.bookableDays(SHOP, mins, new Date(), 10);
    if (!days.length) {
      dateStrip.appendChild(el('p', 'step__hint',
        'That combination is longer than a single day allows — please call the salon.'));
      return;
    }
    days.forEach(function (d) {
      var b = el('button', 'chip chip--day');
      b.type = 'button';
      b.appendChild(el('span', 'chip__dow', DAYS[d.getDay()]));
      b.appendChild(el('span', 'chip__num', String(d.getDate())));
      b.appendChild(el('span', 'chip__mon', MONTHS[d.getMonth()]));
      setPicked(b, pick.date && dateKey(pick.date) === dateKey(d));
      b.addEventListener('click', function () {
        var same = pick.date && dateKey(pick.date) === dateKey(d);
        pick.date = same ? null : d;
        pick.time = null;
        render();
      });
      dateStrip.appendChild(b);
    });
  }

  /* ------------------------------------------------------------- step 4 --- */

  var timeGrid = el('div', 'grid');
  var timeNote = el('p', 'step__hint');
  stepTime.querySelector('.step__body').appendChild(timeGrid);
  stepTime.querySelector('.step__body').appendChild(timeNote);

  function buildTimes() {
    timeGrid.textContent = '';
    timeNote.textContent = '';
    var mins = Core.totalMinutes(SHOP, pick.services);
    if (!mins || !pick.date) return;
    var slots = Core.slotsFor(SHOP, pick.date, mins, new Date());
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
        render();
      });
      timeGrid.appendChild(b);
    });
    var br = Core.breakLabel(SHOP);
    timeNote.textContent = (br ? 'Closed for a break ' + br + '. ' : '')
      + 'Your booking takes about ' + mins + ' minutes.';
  }

  /* ------------------------------------------------------------- step 5 --- */

  var form, summary;
  (function buildDetails() {
    var body = stepDetails.querySelector('.step__body');
    form = el('form', 'bform');

    [['name', 'NAME', 'text', true, 'name'],
     ['email', 'E-MAIL', 'email', true, 'email'],
     ['phone', 'PHONE', 'tel', true, 'tel'],
     ['notes', 'ANYTHING WE SHOULD KNOW', 'textarea', false, 'off']
    ].forEach(function (f) {
      var wrap = el('label', 'bfield');
      wrap.appendChild(el('span', 'bfield__l', f[1] + (f[3] ? '' : ' (optional)')));
      var input = f[2] === 'textarea' ? el('textarea') : el('input');
      if (f[2] !== 'textarea') input.type = f[2];
      input.name = f[0];
      input.required = f[3];
      input.autocomplete = f[4];
      if (f[2] === 'textarea') input.rows = 3;
      wrap.appendChild(input);
      form.appendChild(wrap);
    });

    summary = el('p', 'bsummary');
    form.appendChild(summary);

    var submit = el('button', 'bsubmit', 'REQUEST THIS APPOINTMENT');
    submit.type = 'submit';
    form.appendChild(submit);

    form.appendChild(el('p', 'step__hint bnote', ''));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var set = Core.servicesIn(SHOP, pick.services);
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff) : null;
      window.BookingProvider.submit({
        shop: SHOP.name,
        staffId: pick.staff,
        staffName: who ? who.name : 'No preference',
        services: set.map(function (s) {
          return { id: s.id, name: s.name, nl: s.nl,
                   price: Core.priceLabel(s), minutes: s.minutes };
        }),
        serviceName: set.map(function (s) { return s.name; }).join(' + '),
        serviceNl: set.map(function (s) { return s.nl; }).join(' + '),
        price: Core.totalPriceLabel(SHOP, pick.services),
        minutes: Core.totalMinutes(SHOP, pick.services),
        date: pick.date,
        dateLabel: longDate(pick.date),
        time: pick.time,
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        notes: form.notes.value.trim()
      }, form);
    });

    body.appendChild(form);
  })();

  /* -------------------------------------------------------------- render -- */

  function render() {
    var set = pick.services;

    /* Step 1 — a stylist goes dead when they cannot take the whole set. */
    SHOP.staff.forEach(function (p) {
      var node = staffNodes[p.id];
      var blocked = set.length && !Core.canDoAll(SHOP, p.id, set);
      var cannot = Core.servicesIn(SHOP, set).filter(function (s) {
        return s.staff.indexOf(p.id) === -1;
      });
      setDisabled(node, !!blocked, blocked
        ? p.name + ' does not do ' + cannot.map(function (s) { return s.name; }).join(' or ')
        : '');
      setPicked(node, pick.staff === p.id);
    });

    /* Step 2 — a service goes dead when the chosen stylist does not offer it,
       or when something already chosen is an alternative to it. */
    SHOP.services.forEach(function (sv) {
      var node = serviceNodes[sv.id];
      var picked = set.indexOf(sv.id) !== -1;
      var byStaff = pick.staff && !Core.canDo(SHOP, pick.staff, sv.id);
      var byGroup = !picked && Core.clashes(SHOP, set, sv.id);
      var other = byGroup ? Core.servicesIn(SHOP, set).filter(function (s) {
        return s.group === sv.group;
      })[0] : null;
      setDisabled(node, !!(byStaff || byGroup),
        byStaff ? Core.staffMember(SHOP, pick.staff).name + ' does not do ' + sv.name
        : byGroup ? 'Already booking ' + other.name + ' — choose one or the other'
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

    /* Later steps stay closed until the step before them is answered. */
    stepDate.classList.toggle('is-open', set.length > 0);
    stepTime.classList.toggle('is-open', !!(set.length && pick.date));
    stepDetails.classList.toggle('is-open', !!(set.length && pick.date && pick.time));

    if (set.length && pick.date && pick.time) {
      var names = Core.servicesIn(SHOP, set).map(function (s) { return s.name; }).join(' + ');
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff).name : 'first available stylist';
      summary.textContent = names + ' · ' + Core.totalPriceLabel(SHOP, set)
        + ' euro · with ' + who + ' · ' + longDate(pick.date) + ' at ' + pick.time;
    }

    var note = form.querySelector('.bnote');
    if (note) note.textContent = window.BookingProvider.note || '';
  }

  /* --------------------------------------------------------------- boot --- */

  mount.textContent = '';
  mount.appendChild(stepStaff);
  mount.appendChild(stepService);
  mount.appendChild(stepDate);
  mount.appendChild(stepTime);
  mount.appendChild(stepDetails);
  mount.classList.add('is-live');
  if (reduce) mount.classList.add('no-motion');
  render();
})();
