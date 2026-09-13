/*
  UCHI admin, team and access.

  staff rows are edited in place. The admins table is the allowlist is_admin()
  checks: an e-mail added here can create a login on the sign-in screen and,
  once that e-mail is confirmed, gets full access. The database refuses to
  delete the last admin; this screen also refuses to let you remove yourself.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el;

  UA.panels.team = function (root, ctx) {
    var api = ctx.api;
    var topMsg = UA.msg();
    var staffList = el('div.team');
    var adminList = el('ul.adm');
    var aMsg = UA.msg();
    var newEmail = el('input', { type: 'email', maxlength: '254', required: true, autocomplete: 'off', name: 'admin_email' });
    var add = el('button.btn.btn--ink', { type: 'submit', text: 'Add admin' });
    var addForm = el('form.adm__add', { novalidate: true, id: 'admin-add' },
      UA.field('E-mail to give access', newEmail,
        'That person then uses "First time? Create your login" on the sign-in screen with this e-mail.').wrap,
      el('div.actions', add), aMsg.node);

    UA.append(root, [
      el('div.panel__head', el('h2.panel__title', { id: 'h-team', text: 'Team & access' })),
      topMsg.node,
      el('section.card', { 'aria-labelledby': 'h-staff' },
        el('h3.card__title', { id: 'h-staff', text: 'Stylists' }),
        el('p.card__note', { text: 'Inactive stylists are hidden from the website and cannot be booked online. Lower sort numbers come first.' }),
        staffList),
      el('section.card', { 'aria-labelledby': 'h-admins' },
        el('h3.card__title', { id: 'h-admins', text: 'Who can use this dashboard' }),
        adminList, addForm)
    ]);

    function staffRow(s) {
      var m = UA.msg();
      var name = el('input', { type: 'text', maxlength: '80', required: true, value: s.name });
      var role = el('input', { type: 'text', maxlength: '80', required: true, value: s.role || '' });
      var sort = el('input', { type: 'number', step: '1', min: '-32768', max: '32767', inputmode: 'numeric', value: String(s.sort) });
      var active = el('input', { type: 'checkbox', checked: s.active });
      var save = el('button.btn.btn--ink', { type: 'submit', text: 'Save' });
      var f = el('form.team__row', { novalidate: true, 'data-id': s.id, 'aria-label': s.name },
        UA.field('Name', name).wrap, UA.field('Role', role).wrap, UA.field('Sort', sort).wrap,
        el('label.check.check--inline', active, el('span.check__text', { text: 'Active' })),
        el('div.team__save', save), m.node);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var n = Number(sort.value), bad = [];
        if (!name.value.trim()) bad.push('the name is empty');
        if (!role.value.trim()) bad.push('the role is empty');
        if (!Number.isInteger(n) || n < -32768 || n > 32767) bad.push('sort must be a whole number');
        if (bad.length) { m.err('Not saved: ' + bad.join('; ') + '.'); return; }
        save.disabled = true; m.busy();
        api.updateStaff(s.id, { name: name.value.trim(), role: role.value.trim(), sort: n, active: active.checked })
          .then(function () { ctx.invalidate('staff'); m.ok('Saved'); })
          .catch(function (err) { m.err(err); }).then(function () { save.disabled = false; });
      });
      return f;
    }

    function renderAdmins(rows) {
      UA.clear(adminList);
      var me = String(ctx.email || '').toLowerCase();
      if (!rows.length) adminList.appendChild(el('li.empty', { text: 'No admins listed.' }));
      rows.forEach(function (a) {
        var m = UA.msg();
        var self = a.email === me, last = rows.length < 2;
        var rm = el('button.btn.btn--quiet', { type: 'button', text: 'Remove', disabled: self || last,
          'aria-label': 'Remove ' + a.email });
        rm.addEventListener('click', function () {
          UA.confirm('Remove access for ' + a.email + '?', 'Remove', 'They can no longer sign in to this dashboard.').then(function (yes) {
            if (!yes) return;
            rm.disabled = true; m.busy('Removing');
            api.removeAdmin(a.email).then(function () { topMsg.ok('Access removed for ' + a.email); return loadAdmins(); })
              .catch(function (err) { rm.disabled = false; m.err(err); });
          });
        });
        adminList.appendChild(el('li.adm__item',
          el('span.adm__email', { text: a.email }),
          self ? el('span.badge.badge--confirmed', { text: 'You' }) : null,
          el('span.adm__note', { text: self ? 'You cannot remove yourself' : (last ? 'The last admin cannot be removed' : '') }),
          rm, m.node));
      });
    }

    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = newEmail.value.trim().toLowerCase();
      if (!UA.EMAIL.test(v)) { aMsg.err('Enter a valid e-mail address.'); return; }
      add.disabled = true; aMsg.busy('Adding');
      api.addAdmin(v).then(function () { newEmail.value = ''; aMsg.ok(v + ' can now create a login.'); return loadAdmins(); })
        .catch(function (err) { aMsg.err(err && err.code === '23505' ? v + ' is already on the list.' : err); })
        .then(function () { add.disabled = false; });
    });

    function loadAdmins() {
      return api.listAdmins().then(renderAdmins).catch(function (e) { topMsg.err(e); });
    }
    function load() {
      topMsg.busy('Loading');
      ctx.invalidate('staff');
      return Promise.all([ctx.load('staff').then(function (rows) {
        UA.clear(staffList);
        if (!rows.length) staffList.appendChild(el('p.empty', { text: 'No stylists in the database.' }));
        rows.forEach(function (s) { staffList.appendChild(staffRow(s)); });
      }), loadAdmins()]).then(function () { topMsg.clear(); }).catch(function (e) { topMsg.err(e); });
    }

    var loaded = false;
    return { show: function () { if (!loaded) { loaded = true; load(); } }, hide: function () {} };
  };
})();
