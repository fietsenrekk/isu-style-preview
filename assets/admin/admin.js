/*
  UCHI admin, shell: sign-in, access check, panel switching.

  Passwords go straight to Supabase Auth; this file never stores one. The
  session lives in localStorage under supabase-js's own key (see js/sb.js).
  Access is decided by the database: after sign-in we ask for the admins
  list, and an account that is not on it gets nothing back and is signed out.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el, $ = UA.$;
  var PANELS = ['bookings', 'gallery', 'services', 'hours', 'team'];

  var demo = UA.demoApi && UA.demoApi();
  var api = demo || UA.realApi();
  var views = { boot: $('#boot'), auth: $('#auth'), app: $('#app') };

  function view(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
  }

  if (!api) {
    view('auth');
    $('#auth-banner').textContent = 'The dashboard could not load its database connection. Reload the page.';
    $('#auth-banner').className = 'msg msg--err';
    return;
  }

  /* ------------------------------------------------------------- auth UI -- */
  var forms = { signin: $('#form-signin'), signup: $('#form-signup'), reset: $('#form-reset'), newpass: $('#form-newpass') };
  var banner = {
    node: $('#auth-banner'),
    set: function (kind, text) { this.node.className = 'msg' + (kind ? ' msg--' + kind : ''); this.node.textContent = text || ''; }
  };
  function showForm(name, keepBanner) {
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== name; });
    if (!keepBanner) banner.set('', '');
    var first = forms[name].querySelector('input');
    if (first) first.focus();
  }
  document.querySelectorAll('[data-show]').forEach(function (b) {
    b.addEventListener('click', function () {
      var carry = forms.signin.querySelector('[name=email]').value || forms.signup.querySelector('[name=email]').value;
      showForm(b.getAttribute('data-show'));
      var target = forms[b.getAttribute('data-show')].querySelector('[name=email]');
      if (target && carry && !target.value) target.value = carry;
    });
  });
  function busy(form, on, label) {
    var btn = form.querySelector('[type=submit]');
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.disabled = on;
    btn.textContent = on ? label : btn.getAttribute('data-label');
  }
  function val(form, name) { return form.querySelector('[name=' + name + ']').value; }

  forms.signin.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = val(forms.signin, 'email').trim(), pw = val(forms.signin, 'password');
    if (!UA.EMAIL.test(email) || !pw) { banner.set('err', 'Enter your e-mail and password.'); return; }
    busy(forms.signin, true, 'Signing in');
    banner.set('busy', 'Signing in');
    api.auth.signIn(email, pw).then(function (session) {
      forms.signin.querySelector('[name=password]').value = '';
      return enter(session);
    }).catch(function (err) { banner.set('err', UA.errorText(err)); })
      .then(function () { busy(forms.signin, false); });
  });

  forms.signup.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = val(forms.signup, 'email').trim().toLowerCase(), pw = val(forms.signup, 'password'), pw2 = val(forms.signup, 'password2');
    if (!UA.EMAIL.test(email)) { banner.set('err', 'Enter a valid e-mail address.'); return; }
    if (pw.length < 8) { banner.set('err', 'Use a password of at least 8 characters.'); return; }
    if (pw !== pw2) { banner.set('err', 'The two passwords do not match.'); return; }
    busy(forms.signup, true, 'Creating login');
    api.auth.signUp(email, pw).then(function (data) {
      forms.signup.reset();
      if (data && data.session) return enter(data.session);
      showForm('signin', true);
      forms.signin.querySelector('[name=email]').value = email;
      banner.set('ok', 'Almost done. Open the confirmation e-mail sent to ' + email + ' and tap the link, then sign in here. If nothing arrives, this e-mail may not be on the admin list.');
    }).catch(function (err) { banner.set('err', UA.errorText(err)); })
      .then(function () { busy(forms.signup, false); });
  });

  forms.reset.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = val(forms.reset, 'email').trim();
    if (!UA.EMAIL.test(email)) { banner.set('err', 'Enter a valid e-mail address.'); return; }
    busy(forms.reset, true, 'Sending');
    api.auth.resetPassword(email).then(function () {
      showForm('signin', true);
      banner.set('ok', 'If ' + email + ' has a login, a reset link is on its way. Open it on this device.');
    }).catch(function (err) { banner.set('err', UA.errorText(err)); })
      .then(function () { busy(forms.reset, false); });
  });

  forms.newpass.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = val(forms.newpass, 'password'), pw2 = val(forms.newpass, 'password2');
    if (pw.length < 8) { banner.set('err', 'Use a password of at least 8 characters.'); return; }
    if (pw !== pw2) { banner.set('err', 'The two passwords do not match.'); return; }
    busy(forms.newpass, true, 'Saving');
    api.auth.updatePassword(pw).then(function () {
      forms.newpass.reset();
      banner.set('ok', 'Password changed.');
      return api.auth.session().then(enter);
    }).catch(function (err) { banner.set('err', UA.errorText(err)); })
      .then(function () { busy(forms.newpass, false); });
  });

  /* --------------------------------------------------------- access gate -- */
  var ctx = null, panels = {}, current = null, recovering = false;

  function enter(session) {
    if (!session) { view('auth'); showForm('signin', true); return Promise.resolve(); }
    return api.checkAccess().then(function (ok) {
      if (!ok) {
        return api.auth.signOut().then(function () {
          view('auth'); showForm('signin', true);
          banner.set('err', 'This account has no access. Ask the salon owner to add your e-mail to the admin list.');
        });
      }
      startApp(session);
    }).catch(function (err) {
      return api.auth.signOut().then(function () {
        view('auth'); showForm('signin', true);
        banner.set('err', UA.errorText(err));
      });
    });
  }

  function makeCtx(session) {
    var cache = {}, pending = {};
    var loaders = {
      staff: api.listStaff, services: api.listServices, serviceStaff: api.listServiceStaff,
      settings: api.getSettings, timeOff: api.listTimeOff
    };
    return {
      api: api, email: session.user && session.user.email, cache: cache,
      load: function (k) {
        if (k in cache) return Promise.resolve(cache[k]);
        if (!pending[k]) {
          pending[k] = loaders[k]().then(function (v) {
            cache[k] = Array.isArray(v) || k === 'settings' ? v : (v || []);
            delete pending[k];
            return cache[k];
          }, function (e) { delete pending[k]; throw e; });
        }
        return pending[k];
      },
      invalidate: function (k) { delete cache[k]; }
    };
  }

  function startApp(session) {
    if (ctx) { view('app'); return; }
    ctx = makeCtx(session);
    $('#who').textContent = ctx.email || '';
    $('#demo-flag').hidden = !api.demo;
    document.title = 'UCHI admin';
    PANELS.forEach(function (p) {
      var node = $('#panel-' + p);
      UA.clear(node);
      panels[p] = UA.panels[p](node, ctx);
    });
    view('app');
    var want = location.hash.replace('#', '');
    go(PANELS.indexOf(want) >= 0 ? want : 'bookings', true);
  }

  function go(name, first) {
    if (!panels[name]) return;
    if (current === name && !first) return;
    PANELS.forEach(function (p) {
      var node = $('#panel-' + p);
      var on = p === name;
      if (!on && !node.hidden) { node.hidden = true; if (panels[p]) panels[p].hide(); }
      document.querySelectorAll('[data-panel="' + p + '"]').forEach(function (b) {
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    });
    var node = $('#panel-' + name);
    node.hidden = false;
    node.classList.remove('is-entering');
    void node.offsetWidth;
    node.classList.add('is-entering');
    current = name;
    panels[name].show();
    if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
    if (!first) { window.scrollTo(0, 0); node.focus({ preventScroll: true }); }
  }

  document.querySelectorAll('[data-panel]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-panel')); });
  });
  $('#signout').addEventListener('click', function () {
    api.auth.signOut().then(function () {
      if (api.demo) { banner.set('ok', 'Signed out of the demo. Reload to see it again.'); }
      else banner.set('ok', 'Signed out.');
      ctx = null; current = null;
      view('auth'); showForm('signin', true);
    });
  });

  function onFocus() { if (current === 'bookings' && panels.bookings) panels.bookings.focusRefresh(); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') onFocus(); });
  window.addEventListener('focus', onFocus);

  api.auth.onChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true; view('auth'); showForm('newpass', true);
      banner.set('', 'Choose a new password.');
    } else if (event === 'SIGNED_OUT' && ctx) {
      ctx = null; current = null; view('auth'); showForm('signin', true);
      banner.set('err', 'You were signed out. Sign in again.');
    }
  });

  /* ---------------------------------------------------------------- boot -- */
  api.auth.consumeRedirect().then(function (r) {
    if (r && r.error) {
      view('auth'); showForm('signin', true);
      banner.set('err', /expired|invalid/i.test(r.error) ? 'This link has expired or was already used. Ask for a new one.' : r.error);
      return;
    }
    if (r && r.type === 'recovery') {
      recovering = true; view('auth'); showForm('newpass', true);
      banner.set('', 'Choose a new password.');
      return;
    }
    return api.auth.session().then(function (session) {
      if (recovering) return;
      if (session) {
        if (r && r.type === 'signup') banner.set('ok', 'E-mail confirmed.');
        return enter(session);
      }
      view('auth'); showForm('signin', true);
    });
  }).catch(function (err) {
    view('auth'); showForm('signin', true);
    banner.set('err', UA.errorText(err));
  });
})();
