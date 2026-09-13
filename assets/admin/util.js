/*
  UCHI admin, shared helpers.

  DOM is built with createElement + textContent only. The site runs under a
  strict CSP and every string shown here may have come from a customer.
*/
(function () {
  'use strict';
  var UA = window.UA = window.UA || {};

  /* el('div.row.is-x', { attrs }, children...) */
  function el(spec, attrs) {
    var m = String(spec).split('.');
    var node = document.createElement(m[0] || 'div');
    if (m.length > 1) node.className = m.slice(1).join(' ');
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      kids.unshift(attrs); attrs = null;
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else if (k === 'disabled') node.disabled = !!v;
        else if (k === 'selected') node.selected = !!v;
        else if (/^on/i.test(k) || k === 'style' || k === 'innerHTML') throw new Error('refused attribute ' + k);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(node, kids);
    return node;
  }
  function append(node, kids) {
    kids.forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) append(node, k);
      else node.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
    });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  var uid = 0;
  function id(prefix) { return (prefix || 'f') + '-' + (++uid); }

  /* A labelled field. Returns { wrap, input }. */
  function field(label, input, hint) {
    if (!input.id) input.id = id('in');
    var wrap = el('div.field',
      el('label.field__label', { for: input.id, text: label }),
      input,
      hint ? el('p.field__hint', { text: hint }) : null);
    return { wrap: wrap, input: input };
  }

  /* --------------------------------------------------------- feedback -- */
  /* An inline status line that belongs to one form or row. */
  function msg() {
    var node = el('p.msg', { role: 'status', 'aria-live': 'polite' });
    var timer = null;
    function set(kind, text) {
      clearTimeout(timer);
      node.className = 'msg' + (kind ? ' msg--' + kind : '');
      node.textContent = text || '';
      if (kind === 'ok') timer = setTimeout(function () { set('', ''); }, 4000);
    }
    return {
      node: node,
      ok: function (t) { set('ok', t); },
      err: function (e) { set('err', typeof e === 'string' ? e : UA.errorText(e)); },
      busy: function (t) { set('busy', t || 'Saving'); },
      clear: function () { set('', ''); }
    };
  }

  /* ------------------------------------------------- plain-English errors -- */
  function errorText(e) {
    if (!e) return 'Something went wrong. Try again.';
    if (typeof e === 'string') return e;
    var code = String(e.code || e.error_code || '');
    var text = String(e.message || e.msg || e.error_description || e.error || '');
    var status = e.status || e.statusCode;
    if (e.friendly) return e.friendly;

    if (/failed to fetch|networkerror|network request failed|load failed/i.test(text))
      return 'No connection. Check the internet and try again.';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(text))
      return 'That e-mail and password do not match.';
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(text))
      return 'This e-mail is not confirmed yet. Open the link in the confirmation e-mail first.';
    if (code === 'user_already_exists' || /already registered/i.test(text))
      return 'There is already a login for this e-mail. Sign in, or use "Forgot password".';
    if (code === 'weak_password' || /password should be/i.test(text))
      return 'That password is too weak. Use at least 8 characters with letters and numbers.';
    if (code === 'same_password')
      return 'The new password must be different from the old one.';
    if (/rate limit|too many/i.test(text) || code === 'over_email_send_rate_limit'
        || code === 'over_request_rate_limit' || status === 429)
      return 'Too many attempts. Wait a minute and try again.';
    if (code === 'signup_disabled') return 'Creating logins is switched off for this site.';
    if (/jwt expired|session.*(missing|expired)|refresh token/i.test(text))
      return 'Your session has expired. Sign in again.';

    if (code === '23P01' || /exclu|conflicting key value violates exclusion/i.test(text))
      return 'That stylist already has a confirmed booking at that time.';
    if (code === '23505') return 'That already exists.';
    if (code === '23503') return 'This is still used somewhere else, or refers to something that no longer exists.';
    if (code === '23502') return 'A required value is missing.';
    if (code === '23514' || /violates check constraint/i.test(text))
      return 'One of the values is not allowed (too long, empty or out of range).';
    if (code === '22P02' || code === '22007' || code === '22008')
      return 'One of the values is in the wrong format.';
    if (code === '42501' || /permission denied|row-level security/i.test(text))
      return 'This account is not allowed to do that.';
    if (code === 'PGRST205' || code === '42P01')
      return 'The database is not set up yet. Try again in a few minutes.';
    if (code === 'no_rows')
      return 'Nothing was saved. The item may be gone, or this account lost access.';
    if (/exceeded the maximum allowed size|payload too large/i.test(text) || status === 413)
      return 'The file is too large (the limit is 10 MB).';
    if (/mime type|invalid_mime|not supported/i.test(text))
      return 'This file type is not allowed. Use JPG, PNG, WebP or AVIF.';
    if (/last admin/i.test(text)) return 'The last admin cannot be removed.';
    if (/duplicate|already exists/i.test(text)) return 'That already exists.';
    return 'Something went wrong' + (text ? ': ' + text : '.') ;
  }

  /* ------------------------------------------------------------ dialog -- */
  /* confirm(text, okLabel) -> Promise<boolean>, using the <dialog> in admin.html */
  function confirmBox(text, okLabel, detail) {
    var dlg = $('#confirm');
    return new Promise(function (resolve) {
      $('#confirm-text').textContent = text;
      $('#confirm-detail').textContent = detail || '';
      var ok = $('#confirm-ok'), no = $('#confirm-no');
      ok.textContent = okLabel || 'Yes';
      function done(v) {
        ok.removeEventListener('click', yes); no.removeEventListener('click', nope);
        dlg.removeEventListener('cancel', esc);
        if (dlg.open) dlg.close();
        resolve(v);
      }
      function yes() { done(true); }
      function nope() { done(false); }
      function esc(e) { e.preventDefault(); done(false); }
      ok.addEventListener('click', yes); no.addEventListener('click', nope);
      dlg.addEventListener('cancel', esc);
      if (typeof dlg.showModal === 'function') { dlg.showModal(); no.focus(); }
      else resolve(window.confirm(text));
    });
  }

  /* ------------------------------------------------------------ format -- */
  function money(n) {
    var v = Number(n) || 0;
    return '€ ' + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
  }
  function priceLabel(n, isFrom) { return (isFrom ? 'from ' : '') + money(n); }
  function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  UA.el = el; UA.append = append; UA.clear = clear; UA.$ = $; UA.id = id; UA.field = field;
  UA.msg = msg; UA.errorText = errorText; UA.confirm = confirmBox;
  UA.money = money; UA.priceLabel = priceLabel; UA.telHref = telHref; UA.EMAIL = EMAIL; UA.uuid = uuid;
  UA.panels = UA.panels || {};
})();
