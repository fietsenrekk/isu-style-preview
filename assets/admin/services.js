/*
  UCHI admin, services and prices.

  One row per service, saved on its own. The stylist checkboxes write
  service_staff, which is what both the online booking and the new-booking
  form read to decide who can do what.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el;

  UA.panels.services = function (root, ctx) {
    var api = ctx.api;
    var listMsg = UA.msg();
    var list = el('div.svc');
    UA.append(root, [
      el('div.panel__head', el('h2.panel__title', { id: 'h-services', text: 'Services' }),
        el('div.panel__tools', el('span.panel__meta', { text: 'Prices in euro. "From" shows the price as a starting price.' }))),
      listMsg.node, list
    ]);

    function load() {
      listMsg.busy('Loading');
      ctx.invalidate('services'); ctx.invalidate('serviceStaff');
      return Promise.all([ctx.load('services'), ctx.load('serviceStaff'), ctx.load('staff')]).then(function () {
        listMsg.clear(); render();
      }).catch(function (e) { listMsg.err(e); });
    }

    function render() {
      UA.clear(list);
      var services = ctx.cache.services || [], staff = ctx.cache.staff || [];
      if (!services.length) { list.appendChild(el('p.empty', { text: 'No services in the database yet.' })); return; }
      list.appendChild(el('div.svc__head', { 'aria-hidden': 'true' },
        ['Service', 'Dutch name', 'Price', 'From', 'Minutes', 'Active', 'Stylists', ''].map(function (t) {
          return el('span', { text: t });
        })));
      services.forEach(function (s) { list.appendChild(row(s, staff)); });
    }

    function row(s, staff) {
      var m = UA.msg();
      var name = el('input', { type: 'text', maxlength: '80', value: s.name, required: true });
      var nl = el('input', { type: 'text', maxlength: '80', value: s.nl || '' });
      var price = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '9999', step: '0.01', value: String(Number(s.price)) });
      var from = el('input', { type: 'checkbox', checked: s.is_from });
      var minutes = el('input', { type: 'number', inputmode: 'numeric', min: '5', max: '600', step: '5', value: String(s.minutes) });
      var active = el('input', { type: 'checkbox', checked: s.active });
      var who = (ctx.cache.serviceStaff || []).filter(function (r) { return r.service_id === s.id; }).map(function (r) { return r.staff_id; });
      var staffChecks = staff.map(function (p) {
        var c = el('input', { type: 'checkbox', value: p.id, checked: who.indexOf(p.id) >= 0 });
        return { input: c, label: el('label.check.check--inline', c, el('span.check__text', { text: p.name })) };
      });
      var save = el('button.btn.btn--ink', { type: 'submit', text: 'Save' });

      function cell(label, input, cls) {
        if (!input.id) input.id = UA.id('svc');
        return el('div.svc__cell' + (cls || ''), el('label.svc__label', { for: input.id, text: label }), input);
      }
      var form = el('form.svc__row', { novalidate: true, 'data-id': s.id, 'aria-label': s.name },
        cell('Service', name, '.svc__cell--name'),
        cell('Dutch name', nl),
        cell('Price', price),
        el('div.svc__cell.svc__cell--tick', el('label.check.check--inline', from, el('span.check__text', { text: 'From' }))),
        cell('Minutes', minutes),
        el('div.svc__cell.svc__cell--tick', el('label.check.check--inline', active, el('span.check__text', { text: 'Active' }))),
        el('fieldset.svc__cell.svc__staff', el('legend.svc__label', { text: 'Stylists' }), staffChecks.map(function (c) { return c.label; })),
        el('div.svc__cell.svc__cell--save', save),
        m.node);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var p = Number(price.value), mins = Number(minutes.value);
        var ids = staffChecks.filter(function (c) { return c.input.checked; }).map(function (c) { return c.input.value; });
        var bad = [];
        if (!name.value.trim()) bad.push('the name is empty');
        if (!nl.value.trim()) bad.push('the Dutch name is empty');
        if (price.value === '' || !isFinite(p) || p < 0 || p > 9999 || Math.round(p * 100) !== p * 100 && Math.abs(Math.round(p * 100) - p * 100) > 1e-6)
          bad.push('the price must be a number between 0 and 9999 with at most 2 decimals');
        if (!Number.isInteger(mins) || mins < 5 || mins > 600) bad.push('minutes must be a whole number from 5 to 600');
        if (active.checked && !ids.length) bad.push('an active service needs at least one stylist');
        if (bad.length) { m.err('Not saved: ' + bad.join('; ') + '.'); return; }
        save.disabled = true; m.busy();
        api.updateService(s.id, { name: name.value.trim(), nl: nl.value.trim(), price: Math.round(p * 100) / 100,
          is_from: from.checked, minutes: mins, active: active.checked })
          .then(function () { return api.setServiceStaff(s.id, ids); })
          .then(function () {
            ctx.invalidate('services'); ctx.invalidate('serviceStaff');
            return Promise.all([ctx.load('services'), ctx.load('serviceStaff')]);
          })
          .then(function () { m.ok('Saved'); })
          .catch(function (e) { m.err(e); })
          .then(function () { save.disabled = false; });
      });
      return form;
    }

    var loaded = false;
    return { show: function () { if (!loaded) { loaded = true; load(); } }, hide: function () {} };
  };
})();
