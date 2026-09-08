/*
  JILL SCUTT — booking UI
  =======================

  Renders the four choices (stylist, service, day, time) and the details form,
  then hands the finished booking to whatever provider is configured in
  assets/booking-provider.js.

  All decision-making lives in booking-core.js. This file only draws what the
  core says is possible and reports what the visitor picked, which is why the
  awkward part — the exclusion between Labi and the colour services — needs no
  special-casing here: it asks `canDo` in both directions and paints the answer.

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
  var pick = { staff: null, service: null, date: null, time: null };

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
  var stepService = step(2, 'SERVICE');
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
        /* Choosing a stylist who cannot do the chosen service clears the
           service rather than leaving an impossible pair on screen. In
           practice the disabled state makes this unreachable, but state that
           can only be kept valid by the UI refusing to be clicked is state
           waiting to go wrong. */
        if (pick.staff && pick.service && !Core.canDo(SHOP, pick.staff, pick.service)) {
          pick.service = null; pick.date = null; pick.time = null;
        }
        render();
      });
      staffNodes[person.id] = b;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.appendChild(el('p', 'step__hint',
      'Either stylist, or skip and choose by service.'));
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
        pick.service = (pick.service === sv.id) ? null : sv.id;
        pick.date = null; pick.time = null;
        /*
          Symmetric to the stylist step, and one step further. If the chosen
          service can only be done by one person, choose them — whether or not
          a stylist was already picked. Asking someone to select balayage and
          then select the only stylist who does balayage is a question with one
          possible answer, and a form that asks those is a form that wastes
          people's time.

          If a stylist WAS picked and cannot do this service, they are replaced
          rather than left standing as a contradiction the disabled state is
          quietly hiding.
        */
        if (pick.service) {
          var able = Core.staffFor(SHOP, pick.service);
          if (able.length === 1) pick.staff = able[0].id;
          else if (pick.staff && !Core.canDo(SHOP, pick.staff, pick.service)) pick.staff = null;
        }
        render();
      });
      serviceNodes[sv.id] = b;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.appendChild(el('p', 'step__hint legend',
      'All prices in euro. "From" prices depend on hair length and the work it takes.'));
  })();

  /* ------------------------------------------------------------- step 3 --- */

  var dateStrip = el('div', 'strip');
  stepDate.querySelector('.step__body').appendChild(dateStrip);

  function buildDates() {
    dateStrip.textContent = '';
    var sv = Core.service(SHOP, pick.service);
    if (!sv) return;
    var days = Core.bookableDays(SHOP, sv.minutes, new Date(), 10);
    if (!days.length) {
      dateStrip.appendChild(el('p', 'step__hint', 'No days available — please call the salon.'));
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
  stepTime.querySelector('.step__body').appendChild(timeGrid);

  function buildTimes() {
    timeGrid.textContent = '';
    var sv = Core.service(SHOP, pick.service);
    if (!sv || !pick.date) return;
    var slots = Core.slotsFor(SHOP, pick.date, sv.minutes, new Date());
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
    if (br) {
      timeGrid.parentNode.appendChild(
        el('p', 'step__hint', 'Closed for a break ' + br + '. '
          + sv.name + ' takes about ' + sv.minutes + ' minutes.'));
    }
  }

  /* ------------------------------------------------------------- step 5 --- */

  var form, summary;
  (function buildDetails() {
    var body = stepDetails.querySelector('.step__body');
    form = el('form', 'bform');
    form.noValidate = false;

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
      var sv = Core.service(SHOP, pick.service);
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff) : null;
      window.BookingProvider.submit({
        shop: SHOP.name,
        staffId: pick.staff,
        staffName: who ? who.name : 'No preference',
        serviceId: sv.id,
        serviceName: sv.name,
        serviceNl: sv.nl,
        price: Core.priceLabel(sv),
        minutes: sv.minutes,
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
    /* Step 1 — a stylist goes dead when the chosen service excludes them. */
    SHOP.staff.forEach(function (p) {
      var node = staffNodes[p.id];
      var blocked = pick.service && !Core.canDo(SHOP, p.id, pick.service);
      setDisabled(node, !!blocked,
        blocked ? p.name + ' does not do ' + Core.service(SHOP, pick.service).name : '');
      setPicked(node, pick.staff === p.id);
    });

    /* Step 2 — a service goes dead when the chosen stylist does not offer it. */
    SHOP.services.forEach(function (sv) {
      var node = serviceNodes[sv.id];
      var blocked = pick.staff && !Core.canDo(SHOP, pick.staff, sv.id);
      setDisabled(node, !!blocked,
        blocked ? Core.staffMember(SHOP, pick.staff).name + ' does not do ' + sv.name : '');
      setPicked(node, pick.service === sv.id);
    });

    buildDates();
    buildTimes();

    /* Later steps stay closed until the step before them is answered. */
    stepDate.classList.toggle('is-open', !!pick.service);
    stepTime.classList.toggle('is-open', !!(pick.service && pick.date));
    stepDetails.classList.toggle('is-open', !!(pick.service && pick.date && pick.time));

    if (pick.service && pick.date && pick.time) {
      var sv = Core.service(SHOP, pick.service);
      var who = pick.staff ? Core.staffMember(SHOP, pick.staff).name : 'first available stylist';
      summary.textContent = sv.name + ' · ' + Core.priceLabel(sv) + ' euro · with '
        + who + ' · ' + longDate(pick.date) + ' at ' + pick.time;
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
