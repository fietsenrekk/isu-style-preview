/*
  UCHI admin, opening hours and time off.

  settings is one row (id = 1). time_off rows block online booking: busy_slots
  returns them, and create_booking refuses any overlap. A row with no stylist
  closes the whole salon.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el, T = window.UchiTZ;
  var DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  function hm(t) { return t ? String(t).slice(0, 5) : ''; }

  UA.panels.hours = function (root, ctx) {
    var api = ctx.api;
    var topMsg = UA.msg();

    /* ---------------------------------------------------------- settings -- */
    var sMsg = UA.msg();
    var dayInputs = DAYS.map(function (d) {
      var i = el('input', { type: 'checkbox', value: String(d[0]), 'data-day': String(d[0]) });
      return { n: d[0], input: i, label: el('label.check.check--day', i, el('span.check__text', { text: d[1] })) };
    });
    var open = el('input', { type: 'time', step: '300', required: true, name: 'open' });
    var close = el('input', { type: 'time', step: '300', required: true, name: 'close' });
    var noBreak = el('input', { type: 'checkbox', name: 'nobreak' });
    var bStart = el('input', { type: 'time', step: '300', name: 'break_start' });
    var bEnd = el('input', { type: 'time', step: '300', name: 'break_end' });
    var step = el('select', { name: 'step' }, [5, 10, 15, 20, 30, 45, 60].map(function (n) {
      return el('option', { value: String(n), text: n + ' minutes' });
    }));
    var lead = el('input', { type: 'number', min: '0', max: '10080', step: '15', inputmode: 'numeric', name: 'lead' });
    var horizon = el('input', { type: 'number', min: '1', max: '366', step: '1', inputmode: 'numeric', name: 'horizon' });
    var sSave = el('button.btn.btn--ink', { type: 'submit', text: 'Save hours' });
    noBreak.addEventListener('change', function () { bStart.disabled = bEnd.disabled = noBreak.checked; });

    var settingsForm = el('form.card', { novalidate: true, id: 'hours-form', 'aria-labelledby': 'h-hours-set' },
      el('h3.card__title', { id: 'h-hours-set', text: 'Opening hours and online booking' }),
      el('fieldset.checks.checks--days', el('legend.field__label', { text: 'Open on' }), dayInputs.map(function (d) { return d.label; })),
      el('div.grid4', UA.field('Opens', open).wrap, UA.field('Closes', close).wrap,
        UA.field('Break starts', bStart).wrap, UA.field('Break ends', bEnd).wrap),
      el('label.check.check--inline', noBreak, el('span.check__text', { text: 'No break' })),
      el('div.grid3',
        UA.field('Start times every', step).wrap,
        UA.field('Minimum notice (minutes)', lead, 'How long before a start time online booking closes.').wrap,
        UA.field('Bookable ahead (days)', horizon, 'How far ahead customers can book online.').wrap),
      el('div.actions', sSave), sMsg.node);

    function fillSettings(s) {
      if (!s) { sMsg.err('No settings row found in the database.'); return; }
      dayInputs.forEach(function (d) { d.input.checked = (s.open_days || []).indexOf(d.n) >= 0; });
      open.value = hm(s.open_time); close.value = hm(s.close_time);
      noBreak.checked = !s.break_start;
      bStart.value = hm(s.break_start) || '14:00'; bEnd.value = hm(s.break_end) || '15:00';
      bStart.disabled = bEnd.disabled = noBreak.checked;
      var sv = String(s.slot_step_minutes);
      if (!step.querySelector('option[value="' + sv + '"]')) step.appendChild(el('option', { value: sv, text: sv + ' minutes' }));
      step.value = sv;
      lead.value = String(s.lead_time_minutes); horizon.value = String(s.booking_horizon_days);
    }

    settingsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var days = dayInputs.filter(function (d) { return d.input.checked; }).map(function (d) { return d.n; }).sort();
      var bad = [];
      if (!open.value || !close.value) bad.push('set the opening and closing time');
      else if (open.value >= close.value) bad.push('closing must be after opening');
      if (!noBreak.checked) {
        if (!bStart.value || !bEnd.value) bad.push('set both break times, or tick "No break"');
        else if (bStart.value >= bEnd.value) bad.push('the break must end after it starts');
        else if (bStart.value < open.value || bEnd.value > close.value) bad.push('the break must fall inside opening hours');
      }
      var l = Number(lead.value), h = Number(horizon.value);
      if (!Number.isInteger(l) || l < 0 || l > 10080) bad.push('minimum notice must be a whole number of minutes (0 to 10080)');
      if (!Number.isInteger(h) || h < 1 || h > 366) bad.push('bookable ahead must be 1 to 366 days');
      if (bad.length) { sMsg.err('Not saved: ' + bad.join('; ') + '.'); return; }
      sSave.disabled = true; sMsg.busy();
      api.updateSettings({
        open_days: days, open_time: open.value, close_time: close.value,
        break_start: noBreak.checked ? null : bStart.value, break_end: noBreak.checked ? null : bEnd.value,
        slot_step_minutes: Number(step.value), lead_time_minutes: l, booking_horizon_days: h,
        updated_at: new Date().toISOString()
      }).then(function () {
        ctx.invalidate('settings');
        sMsg.ok(days.length ? 'Saved. Online booking uses these hours now.' : 'Saved. No open days: online booking is effectively closed.');
      }).catch(function (err) { sMsg.err(err); }).then(function () { sSave.disabled = false; });
    });

    /* ---------------------------------------------------------- time off -- */
    var tMsg = UA.msg();
    var who = el('select', { name: 'who' });
    var sd = el('input', { type: 'date', required: true, name: 'start_date' });
    var st = el('input', { type: 'time', step: '300', required: true, name: 'start_time', value: '00:00' });
    var ed = el('input', { type: 'date', required: true, name: 'end_date' });
    var et = el('input', { type: 'time', step: '300', required: true, name: 'end_time', value: '23:59' });
    var reason = el('input', { type: 'text', maxlength: '200', name: 'reason', placeholder: 'Holiday, training, closed' });
    var tSave = el('button.btn.btn--ink', { type: 'submit', text: 'Add time off' });
    sd.addEventListener('change', function () { if (!ed.value || ed.value < sd.value) ed.value = sd.value; });
    var offForm = el('form.card', { novalidate: true, id: 'off-form', 'aria-labelledby': 'h-off' },
      el('h3.card__title', { id: 'h-off', text: 'Time off' }),
      el('p.card__note', { text: 'Time off blocks online booking for that period. Existing bookings are not cancelled.' }),
      el('div.grid2', UA.field('Who', who).wrap, UA.field('Reason (optional)', reason).wrap),
      el('div.grid4', UA.field('From date', sd).wrap, UA.field('From time', st).wrap,
        UA.field('Until date', ed).wrap, UA.field('Until time', et).wrap),
      el('div.actions', tSave), tMsg.node);
    var offList = el('ul.off');
    var pastToggle = el('button.btn.btn--quiet', { type: 'button', text: 'Show past time off', 'aria-expanded': 'false' });
    var pastList = el('ul.off.off--past', { hidden: true });
    pastToggle.addEventListener('click', function () {
      pastList.hidden = !pastList.hidden;
      pastToggle.setAttribute('aria-expanded', String(!pastList.hidden));
      pastToggle.textContent = pastList.hidden ? 'Show past time off' : 'Hide past time off';
    });

    offForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!sd.value || !st.value || !ed.value || !et.value) { tMsg.err('Set both the start and the end.'); return; }
      var a = T.toInstant(sd.value, st.value), b = T.toInstant(ed.value, et.value);
      if (b <= a) { tMsg.err('The end must be after the start.'); return; }
      tSave.disabled = true; tMsg.busy();
      api.insertTimeOff({ staff_id: who.value || null, starts_at: a.toISOString(), ends_at: b.toISOString(),
        reason: reason.value.trim() || null })
        .then(function () { reason.value = ''; tMsg.ok('Time off added.'); return loadOff(); })
        .catch(function (err) { tMsg.err(err); }).then(function () { tSave.disabled = false; });
    });

    function staffName(id) {
      if (!id) return 'Whole salon';
      var s = (ctx.cache.staff || []).filter(function (x) { return x.id === id; })[0];
      return s ? s.name : id;
    }
    function span(o) {
      var d0 = T.dateOf(o.starts_at), d1 = T.dateOf(o.ends_at);
      var t0 = T.timeOf(o.starts_at), t1 = T.timeOf(o.ends_at);
      if (d0 === d1) return T.dayLabel(d0) + ', ' + t0 + ' to ' + t1;
      return T.dayLabel(d0) + ' ' + t0 + ' to ' + T.dayLabel(d1) + ' ' + t1;
    }
    function item(o) {
      var m = UA.msg();
      var del = el('button.btn.btn--quiet', { type: 'button', text: 'Delete' });
      del.addEventListener('click', function () {
        UA.confirm('Delete this time off?', 'Delete', staffName(o.staff_id) + ': ' + span(o) + '. Online booking opens again for this period.')
          .then(function (yes) {
            if (!yes) return;
            del.disabled = true; m.busy('Deleting');
            api.deleteTimeOff(o.id).then(function () { topMsg.ok('Time off deleted'); return loadOff(); })
              .catch(function (err) { del.disabled = false; m.err(err); });
          });
      });
      return el('li.off__item', { 'data-id': o.id },
        el('div.off__main',
          el('p.off__who', { text: staffName(o.staff_id) }),
          el('p.off__when', { text: span(o) }),
          o.reason ? el('p.off__why', { text: o.reason }) : null),
        del, m.node);
    }

    function loadOff() {
      ctx.invalidate('timeOff');
      return ctx.load('timeOff').then(function (rows) {
        var now = new Date();
        var future = rows.filter(function (o) { return new Date(o.ends_at) >= now; });
        var past = rows.filter(function (o) { return new Date(o.ends_at) < now; }).reverse();
        UA.clear(offList); UA.clear(pastList);
        if (!future.length) offList.appendChild(el('li.empty', { text: 'No time off planned.' }));
        future.forEach(function (o) { offList.appendChild(item(o)); });
        past.slice(0, 50).forEach(function (o) { pastList.appendChild(item(o)); });
        pastToggle.hidden = !past.length;
      }).catch(function (e) { topMsg.err(e); });
    }

    UA.append(root, [
      el('div.panel__head', el('h2.panel__title', { id: 'h-hours', text: 'Hours & time off' })),
      topMsg.node, settingsForm, offForm, offList, pastToggle, pastList
    ]);

    function load() {
      topMsg.busy('Loading');
      ctx.invalidate('settings');
      return Promise.all([ctx.load('settings'), ctx.load('staff')]).then(function (r) {
        topMsg.clear();
        fillSettings(r[0]);
        UA.clear(who).appendChild(el('option', { value: '', text: 'Whole salon' }));
        (r[1] || []).forEach(function (s) { who.appendChild(el('option', { value: s.id, text: s.name })); });
        if (!sd.value) { sd.value = T.today(); ed.value = T.today(); }
        return loadOff();
      }).catch(function (e) { topMsg.err(e); });
    }

    var loaded = false;
    return { show: function () { if (!loaded) { loaded = true; load(); } }, hide: function () {} };
  };
})();
