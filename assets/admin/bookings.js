/*
  UCHI admin, bookings.

  Today / upcoming / past, grouped by Brussels day. Status changes write
  bookings.status directly (admin RLS); the exclusion constraint on confirmed
  bookings still refuses a double booking, and that refusal is shown in plain
  words. Phone and walk-in bookings are inserted with source = 'admin'.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el, T = window.UchiTZ;

  var STATUS = { confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' };
  var UPCOMING_DAYS = 180, PAST_STEP = 30;

  UA.panels.bookings = function (root, ctx) {
    var api = ctx.api;
    var state = { tab: 'today', staff: '', status: '', q: '', pastDays: PAST_STEP,
      rows: [], week: [], loading: false, lastLoad: 0 };
    var ref = {};

    /* ------------------------------------------------------------ layout -- */
    var refreshBtn = el('button.btn', { type: 'button', text: 'Refresh', 'data-act': 'refresh' });
    var newBtn = el('button.btn.btn--ink', { type: 'button', text: 'New booking', 'aria-expanded': 'false',
      'aria-controls': 'nb-form', 'data-act': 'new-booking' });
    var updated = el('span.panel__meta', { 'aria-live': 'polite' });
    var head = el('div.panel__head',
      el('h2.panel__title', { id: 'h-bookings', text: 'Bookings' }),
      el('div.panel__tools', updated, refreshBtn, newBtn));

    ref.cToday = el('span.stat__num', { text: '0' });
    ref.cWeek = el('span.stat__num', { text: '0' });
    ref.cRev = el('span.stat__num', { text: UA.money(0) });
    ref.cRevNote = el('span.stat__note', { text: 'confirmed and completed' });
    var stats = el('div.stats',
      el('div.stat', el('span.stat__label', { text: 'Today' }), ref.cToday, el('span.stat__note', { text: 'bookings, not cancelled' })),
      el('div.stat', el('span.stat__label', { text: 'This week' }), ref.cWeek, el('span.stat__note', { text: 'Monday to Sunday' })),
      el('div.stat', el('span.stat__label', { text: 'Revenue this week' }), ref.cRev, ref.cRevNote));

    var form = buildForm();

    var tabs = el('div.tabs', { role: 'tablist', 'aria-label': 'Which bookings' });
    [['today', 'Today'], ['upcoming', 'Upcoming'], ['past', 'Past']].forEach(function (t) {
      tabs.appendChild(el('button.tab', { type: 'button', role: 'tab', id: 'bk-tab-' + t[0], 'data-tab': t[0],
        'aria-selected': String(t[0] === state.tab), 'aria-controls': 'bk-list', text: t[1],
        on: { click: function () { setTab(t[0]); } } }));
    });

    ref.fStaff = el('select', { on: { change: function () { state.staff = this.value; render(); } } });
    ref.fStatus = el('select', { on: { change: function () { state.status = this.value; render(); } } },
      el('option', { value: '', text: 'All statuses' }),
      Object.keys(STATUS).map(function (k) { return el('option', { value: k, text: STATUS[k] }); }));
    ref.fSearch = el('input', { type: 'search', placeholder: 'Name, e-mail or phone', autocomplete: 'off',
      on: { input: function () { state.q = this.value; render(); } } });
    var filters = el('div.filters',
      UA.field('Stylist', ref.fStaff).wrap,
      UA.field('Status', ref.fStatus).wrap,
      el('div.filters__grow', UA.field('Search', ref.fSearch).wrap));

    ref.listMsg = UA.msg();
    ref.list = el('div.bk-list', { id: 'bk-list', role: 'tabpanel', 'aria-labelledby': 'bk-tab-today' });
    ref.more = el('button.btn.btn--wide', { type: 'button', text: 'Show 30 more days', hidden: true,
      on: { click: function () { state.pastDays += PAST_STEP; load(); } } });

    UA.append(root, [head, stats, form.node, tabs, filters, ref.listMsg.node, ref.list, ref.more]);

    refreshBtn.addEventListener('click', function () { load(); });
    newBtn.addEventListener('click', function () { form.toggle(); });

    /* ------------------------------------------------------------- data --- */
    function range() {
      var today = T.today();
      if (state.tab === 'today') return [T.dayRange(today)[0], T.dayRange(today)[1], true];
      if (state.tab === 'upcoming') return [T.dayRange(T.addDays(today, 1))[0], T.dayRange(T.addDays(today, UPCOMING_DAYS))[0], true];
      return [T.dayRange(T.addDays(today, -state.pastDays))[0], T.dayRange(today)[0], false];
    }

    function load(quiet) {
      if (state.loading) return Promise.resolve();
      state.loading = true;
      if (!quiet) ref.listMsg.busy('Loading');
      refreshBtn.disabled = true;
      var r = range(), today = T.today(), ws = T.weekStart(today);
      return Promise.all([ctx.load('staff'), ctx.load('services'), ctx.load('serviceStaff'), ctx.load('settings'),
        api.listBookings(r[0].toISOString(), r[1].toISOString(), r[2]),
        api.listBookings(T.dayRange(ws)[0].toISOString(), T.dayRange(T.addDays(ws, 7))[0].toISOString(), true)
      ]).then(function (res) {
        state.rows = res[4] || []; state.week = res[5] || [];
        state.lastLoad = Date.now();
        fillStaffFilter();
        form.refreshOptions();
        ref.listMsg.clear();
        updated.textContent = 'Updated ' + T.timeOf(new Date());
        render();
      }).catch(function (e) {
        ref.listMsg.err(e);
      }).then(function () { state.loading = false; refreshBtn.disabled = false; });
    }

    function fillStaffFilter() {
      var cur = state.staff;
      UA.clear(ref.fStaff).appendChild(el('option', { value: '', text: 'All stylists' }));
      ctx.cache.staff.forEach(function (s) {
        ref.fStaff.appendChild(el('option', { value: s.id, text: s.name, selected: s.id === cur }));
      });
    }

    function counters() {
      var today = T.today();
      var live = state.week.filter(function (b) { return b.status !== 'cancelled'; });
      ref.cToday.textContent = String(live.filter(function (b) { return T.dateOf(b.starts_at) === today; }).length);
      ref.cWeek.textContent = String(live.length);
      var paid = state.week.filter(function (b) { return b.status === 'confirmed' || b.status === 'completed'; });
      var sum = paid.reduce(function (a, b) { return a + (Number(b.total_price) || 0); }, 0);
      var min = paid.some(function (b) { return b.price_is_from; });
      ref.cRev.textContent = (min ? 'min. ' : '') + UA.money(sum);
      ref.cRevNote.textContent = min
        ? 'estimate: at least this, some prices are "from"'
        : 'estimate from confirmed and completed';
    }

    function staffName(id) {
      var s = (ctx.cache.staff || []).filter(function (x) { return x.id === id; })[0];
      return s ? s.name : (id || 'Any');
    }
    function serviceNames(ids) {
      var map = {};
      (ctx.cache.services || []).forEach(function (s) { map[s.id] = s.name; });
      return (ids || []).map(function (i) { return map[i] || i; }).join(', ');
    }

    function matches(b) {
      if (state.staff && b.staff_id !== state.staff) return false;
      if (state.status && b.status !== state.status) return false;
      var q = state.q.trim().toLowerCase();
      if (!q) return true;
      var digits = q.replace(/\D/g, '');
      return [b.customer_name, b.customer_email].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; })
        || (digits.length >= 3 && String(b.customer_phone || '').replace(/\D/g, '').indexOf(digits) >= 0);
    }

    function render() {
      counters();
      UA.clear(ref.list);
      ref.list.setAttribute('aria-labelledby', 'bk-tab-' + state.tab);
      var rows = state.rows.filter(matches);
      ref.more.hidden = state.tab !== 'past';
      if (!rows.length) {
        var none = { today: 'No bookings today.', upcoming: 'No upcoming bookings.', past: 'No bookings in the last ' + state.pastDays + ' days.' }[state.tab];
        ref.list.appendChild(el('p.empty', { text: state.rows.length ? 'Nothing matches these filters.' : none }));
        return;
      }
      var groups = [], byDay = {};
      rows.forEach(function (b) {
        var d = T.dateOf(b.starts_at);
        if (!byDay[d]) { byDay[d] = []; groups.push(d); }
        byDay[d].push(b);
      });
      groups.forEach(function (d) {
        var n = byDay[d].length;
        ref.list.appendChild(el('section.day',
          el('h3.day__head', el('span', { text: d === T.today() ? 'Today, ' + T.dayLabel(d) : T.dayLabel(d) }),
            el('span.day__count', { text: n + (n === 1 ? ' booking' : ' bookings') })),
          el('ul.bk', byDay[d].map(row))));
      });
    }

    function row(b) {
      var m = UA.msg();
      var li = el('li.bk__row' + (b.status === 'cancelled' ? '.is-cancelled' : ''), { 'data-id': b.id });
      var contacts = el('div.bk__contact',
        b.customer_phone ? el('a.link', { href: UA.telHref(b.customer_phone), text: b.customer_phone }) : null,
        b.customer_email ? el('a.link', { href: 'mailto:' + b.customer_email, text: b.customer_email }) : null);
      var actions = el('div.bk__actions');
      function act(label, status, ask, cls) {
        actions.appendChild(el('button.btn' + (cls || ''), { type: 'button', text: label, 'data-status': status,
          on: { click: function () { setStatus(b, status, ask, m, this); } } }));
      }
      if (b.status === 'confirmed') {
        act('Completed', 'completed');
        act('No-show', 'no_show');
        act('Cancel', 'cancelled', true, '.btn--quiet');
      } else {
        act('Restore to confirmed', 'confirmed', b.status === 'cancelled');
      }
      UA.append(li, [
        el('div.bk__time', el('span', { text: T.timeOf(b.starts_at) }), el('span.bk__to', { text: T.timeOf(b.ends_at) })),
        el('div.bk__main',
          el('p.bk__name', { text: b.customer_name || 'No name' }),
          el('p.bk__svc', { text: serviceNames(b.service_ids) }),
          el('p.bk__who', { text: staffName(b.staff_id) + ' · ' + (b.total_minutes || '?') + ' min · ' + (b.source === 'admin' ? 'Added by salon' : 'Online') }),
          contacts,
          b.notes ? el('p.bk__notes', el('span.bk__notes-label', { text: 'Note ' }), b.notes) : null),
        el('div.bk__side',
          el('span.badge.badge--' + b.status, { text: STATUS[b.status] || b.status }),
          el('span.bk__price', { text: UA.priceLabel(b.total_price, b.price_is_from) })),
        actions, m.node]);
      return li;
    }

    function setStatus(b, status, ask, m, btn) {
      var who = (b.customer_name || 'this booking') + ', ' + T.dayLabel(T.dateOf(b.starts_at)) + ' ' + T.timeOf(b.starts_at);
      var go = ask
        ? UA.confirm(status === 'cancelled' ? 'Cancel this booking?' : 'Restore this booking?',
            status === 'cancelled' ? 'Cancel booking' : 'Restore', who
            + (status === 'cancelled' ? '. The time becomes free for online booking again. The customer is not notified automatically.' : ''))
        : Promise.resolve(true);
      go.then(function (yes) {
        if (!yes) return;
        btn.disabled = true; m.busy();
        api.updateBooking(b.id, { status: status }).then(function () {
          m.ok('Saved');
          return load(true);
        }).catch(function (e) {
          btn.disabled = false;
          if (status === 'confirmed' && (e.code === '23P01' || /exclu|slot_taken/i.test(e.message || '')))
            m.err('Cannot restore: ' + staffName(b.staff_id) + ' already has another confirmed booking at that time.');
          else m.err(e);
        });
      });
    }

    function setTab(t) {
      state.tab = t;
      tabs.querySelectorAll('.tab').forEach(function (n) {
        n.setAttribute('aria-selected', String(n.getAttribute('data-tab') === t));
      });
      state.rows = []; UA.clear(ref.list);
      load();
    }

    /* ---------------------------------------------------- new booking ---- */
    function buildForm() {
      var m = UA.msg();
      var staffSel = el('select', { name: 'staff', required: true });
      var svcBox = el('fieldset.checks.checks--svc', el('legend.field__label', { text: 'Services' }));
      var summary = el('p.nb__summary', { 'aria-live': 'polite' });
      var date = el('input', { type: 'date', name: 'date', required: true });
      var time = el('input', { type: 'time', name: 'time', step: '300', required: true });
      var name = el('input', { type: 'text', name: 'name', maxlength: '80', required: true, autocomplete: 'off' });
      var phone = el('input', { type: 'tel', name: 'phone', maxlength: '30', required: true, autocomplete: 'off' });
      var email = el('input', { type: 'email', name: 'email', maxlength: '120', autocomplete: 'off' });
      var notes = el('textarea', { name: 'notes', maxlength: '500', rows: '2' });
      var save = el('button.btn.btn--ink', { type: 'submit', text: 'Save booking' });
      var cancel = el('button.btn.btn--quiet', { type: 'button', text: 'Close' });
      var node = el('form.card.nb', { id: 'nb-form', hidden: true, novalidate: true, 'aria-label': 'New booking' },
        el('h3.card__title', { text: 'New booking (phone or walk-in)' }),
        el('div.grid2',
          UA.field('Stylist', staffSel).wrap,
          el('div.grid2', UA.field('Date', date).wrap, UA.field('Start time', time).wrap)),
        svcBox, summary,
        el('div.grid2', UA.field('Customer name', name).wrap, UA.field('Phone', phone).wrap),
        el('div.grid2', UA.field('E-mail (optional)', email).wrap, UA.field('Notes (optional)', notes).wrap),
        el('div.actions', save, cancel), m.node);

      var checks = {};
      function capable(serviceId, staffId) {
        return (ctx.cache.serviceStaff || []).some(function (r) { return r.service_id === serviceId && r.staff_id === staffId; });
      }
      function chosen() {
        return (ctx.cache.services || []).filter(function (s) { return checks[s.id] && checks[s.id].input.checked; });
      }
      function refreshOptions() {
        var cur = staffSel.value;
        UA.clear(staffSel).appendChild(el('option', { value: '', text: 'Choose a stylist' }));
        (ctx.cache.staff || []).filter(function (s) { return s.active; }).forEach(function (s) {
          staffSel.appendChild(el('option', { value: s.id, text: s.name, selected: s.id === cur }));
        });
        var picked = chosen().map(function (s) { return s.id; });
        Array.prototype.slice.call(svcBox.querySelectorAll('.check')).forEach(function (n) { n.remove(); });
        checks = {};
        (ctx.cache.services || []).filter(function (s) { return s.active; }).forEach(function (s) {
          var input = el('input', { type: 'checkbox', value: s.id, checked: picked.indexOf(s.id) >= 0,
            on: { change: rules } });
          var why = el('span.check__why');
          var label = el('label.check', input,
            el('span.check__text', el('span', { text: s.name }),
              el('span.check__meta', { text: UA.priceLabel(s.price, s.is_from) + ' · ' + s.minutes + ' min' }), why));
          checks[s.id] = { input: input, why: why, svc: s, label: label };
          svcBox.appendChild(label);
        });
        rules();
      }
      function rules() {
        var staff = staffSel.value;
        Object.keys(checks).forEach(function (id) {
          if (staff && !capable(id, staff)) checks[id].input.checked = false;
        });
        var sel = chosen();
        Object.keys(checks).forEach(function (id) {
          var c = checks[id], reason = '';
          if (staff && !capable(id, staff)) reason = staffName(staff) + ' does not do this';
          else if (!c.input.checked && sel.some(function (s) { return s.grp && s.grp === c.svc.grp; }))
            reason = 'one ' + c.svc.grp + ' service per booking';
          c.input.disabled = !!reason;
          c.label.classList.toggle('is-off', !!reason);
          c.why.textContent = reason;
        });
        sel = chosen();
        var mins = sel.reduce(function (a, s) { return a + Number(s.minutes); }, 0);
        var price = sel.reduce(function (a, s) { return a + Number(s.price); }, 0);
        var from = sel.some(function (s) { return s.is_from; });
        if (!sel.length) { summary.textContent = 'Pick one or more services.'; return; }
        var end = '';
        if (date.value && time.value) end = ', ends ' + T.timeOf(new Date(T.toInstant(date.value, time.value).getTime() + mins * 60000));
        summary.textContent = sel.length + (sel.length === 1 ? ' service, ' : ' services, ') + mins + ' min, '
          + UA.priceLabel(price, from) + end;
      }
      staffSel.addEventListener('change', rules);
      date.addEventListener('change', rules); time.addEventListener('change', rules);

      function open(show) {
        node.hidden = !show;
        newBtn.setAttribute('aria-expanded', String(show));
        if (show) {
          if (!date.value) date.value = T.today();
          if (!time.value) {
            var p = T.parts(new Date(Date.now() + 15 * 60000));
            time.value = T.pad(p.h) + ':' + T.pad(Math.floor(p.mi / 15) * 15);
          }
          m.clear(); rules();
          staffSel.focus();
        }
      }
      cancel.addEventListener('click', function () { open(false); newBtn.focus(); });

      node.addEventListener('submit', function (e) {
        e.preventDefault();
        var sel = chosen(), staff = staffSel.value;
        var problems = [];
        if (!staff) problems.push('choose a stylist');
        if (!sel.length) problems.push('choose at least one service');
        if (!date.value || !time.value) problems.push('set the date and time');
        if (!name.value.trim()) problems.push('enter the customer name');
        if (!phone.value.trim()) problems.push('enter a phone number');
        if (email.value.trim() && !UA.EMAIL.test(email.value.trim())) problems.push('check the e-mail address');
        if (sel.some(function (s) { return !capable(s.id, staff); })) problems.push('this stylist does not do every chosen service');
        if (problems.length) { m.err('Please ' + problems.join(', ') + '.'); return; }

        var mins = sel.reduce(function (a, s) { return a + Number(s.minutes); }, 0);
        var start = T.toInstant(date.value, time.value);
        var endAt = new Date(start.getTime() + mins * 60000);
        var row = {
          starts_at: start.toISOString(), ends_at: endAt.toISOString(), staff_id: staff,
          service_ids: sel.map(function (s) { return s.id; }),
          total_price: Math.round(sel.reduce(function (a, s) { return a + Number(s.price); }, 0) * 100) / 100,
          price_is_from: sel.some(function (s) { return s.is_from; }), total_minutes: mins,
          customer_name: name.value.trim(), customer_phone: phone.value.trim(),
          customer_email: email.value.trim().toLowerCase(),
          notes: notes.value.trim() || null, status: 'confirmed', source: 'admin'
        };

        warnings(start, endAt, staff).then(function (list) {
          if (!list.length) return true;
          return UA.confirm('Book anyway?', 'Book anyway', list.join(' '));
        }).then(function (yes) {
          if (!yes) return;
          save.disabled = true; m.busy();
          return api.insertBooking(row).then(function () {
            var label = row.customer_name + ', ' + T.dayLabel(date.value) + ' ' + time.value;
            [name, phone, email, notes].forEach(function (i) { i.value = ''; });
            Object.keys(checks).forEach(function (id) { checks[id].input.checked = false; });
            rules();
            var d = date.value, today = T.today();
            var tab = d === today ? 'today' : (d > today ? 'upcoming' : 'past');
            if (tab !== state.tab) setTab(tab); else load(true);
            m.ok('Booked: ' + label + '.');
          }).catch(function (err) {
            if (err && (err.code === '23P01' || /exclu/i.test(err.message || '')))
              m.err(staffName(staff) + ' already has a confirmed booking that overlaps ' + time.value + '. Pick another time or stylist.');
            else m.err(err);
          });
        }).then(function () { save.disabled = false; });
      });

      /* Soft checks: the salon may book outside the online rules, but should know it is doing so. */
      function warnings(start, endAt, staff) {
        return ctx.load('timeOff').catch(function () { return []; }).then(function (off) {
          var out = [], s = ctx.cache.settings;
          var d = T.dateOf(start), t0 = T.timeOf(start), t1 = T.timeOf(endAt);
          if (s) {
            if ((s.open_days || []).indexOf(T.dowOf(d)) < 0) out.push('The salon is normally closed on this day.');
            var open = String(s.open_time || '').slice(0, 5), close = String(s.close_time || '').slice(0, 5);
            if (open && close && (t0 < open || t1 > close || T.dateOf(endAt) !== d)) out.push('This is outside opening hours (' + open + '-' + close + ').');
            var bs = s.break_start && String(s.break_start).slice(0, 5), be = s.break_end && String(s.break_end).slice(0, 5);
            if (bs && be && t0 < be && t1 > bs) out.push('This runs into the break (' + bs + '-' + be + ').');
          }
          (off || []).forEach(function (o) {
            if ((o.staff_id === null || o.staff_id === staff) && new Date(o.starts_at) < endAt && start < new Date(o.ends_at))
              out.push('This overlaps time off' + (o.reason ? ' (' + o.reason + ')' : '') + '.');
          });
          return out;
        });
      }

      return { node: node, refreshOptions: refreshOptions, toggle: function () { open(node.hidden); } };
    }

    /* -------------------------------------------------------- lifecycle -- */
    var timer = null;
    function maybeRefresh() {
      if (!root.hidden && document.visibilityState === 'visible' && Date.now() - state.lastLoad > 5000) load(true);
    }
    return {
      show: function () {
        if (!state.lastLoad) load(); else maybeRefresh();
        clearInterval(timer);
        timer = setInterval(maybeRefresh, 60000);
      },
      hide: function () { clearInterval(timer); },
      focusRefresh: maybeRefresh
    };
  };
})();
