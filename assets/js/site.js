/*
  UCHI - shared page behaviour (home, gallery, reservation, and the root redirect)
  ================================================================================

  Loaded synchronously in <head>, so the two things that must happen before the
  first paint do: the `js` class that switches motion on, and the covered
  curtain the page arrives under. Everything else waits for DOMContentLoaded.

  No inline script anywhere (the CSP is script-src 'self'), so the root redirect
  lives here too: index.html carries data-redirect="home".

  Timings, measured from isu-antwerp.com js/app/ui/Navigation.js and Ui.js:

    mobile menu open   overlay scaleX 0 -> 1, .35s ease1, origin left
                       each li x -15 -> 0, opacity 0 -> 1, .45s ease1,
                       starting at +.35s, stagger .05s
    mobile menu close  overlay opacity 1 -> 0, .35s ease1
    burger             `transition: all .25s ease-in` on width/rotate; here
                       transform only, .35s --ease-io, in step with the overlay
    page transition    ISU showPreload(): .bck scaleX 0 -> 1 .85s ease2, then
                       the wrap scaleX 1 -> 0 .65s Power1.easeOut at +.9s.
                       Compressed to .40s in / .45s out on --ease-io so a
                       leave + arrive stays under 900ms.

  Everything is CSS transitions on transform / opacity; this file only toggles
  classes. Those are interruptible, so no "is animating" lock is needed.
*/
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---- root redirect ------------------------------------------------- */
  var redirect = root.getAttribute('data-redirect');
  if (redirect) {
    location.replace(redirect + location.hash);
    return;
  }

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.classList.add('js');
  if (!reduce) root.classList.add('curtain-cover');

  var T_IN = 400, T_OUT = 450, REVEAL_AFTER = 180;

  var arrived = false, arrivedQueue = [];
  function fireArrived() {
    if (arrived) return;
    arrived = true;
    var q = arrivedQueue; arrivedQueue = [];
    q.forEach(function (cb) { try { cb(); } catch (e) { /* one listener must not stop the rest */ } });
  }
  window.UchiSite = {
    reducedMotion: reduce,
    whenArrived: function (cb) { if (arrived) cb(); else arrivedQueue.push(cb); }
  };

  function setCurtain(state) {
    root.classList.remove('curtain-cover', 'curtain-in', 'curtain-out');
    if (state) root.classList.add(state);
  }
  function has(c) { return root.classList.contains(c); }

  /* Resolve on the element's own transform transitionend, with a timer as the
     backstop (a transition that never starts never ends). */
  function afterTransform(el, ms, cb) {
    var done = false, timer;
    function finish(e) {
      if (e && (e.target !== el || e.propertyName !== 'transform')) return;
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', finish);
      clearTimeout(timer);
      cb();
    }
    el.addEventListener('transitionend', finish);
    timer = setTimeout(finish, ms + 120);
  }

  function init() {
    var page = document.querySelector('.page');
    var curtain = document.getElementById('curtain');
    var bck = curtain && curtain.querySelector('.bck');
    var content = document.getElementById('main-content');
    var burger = document.getElementById('ico-nav');
    var mobileNav = document.getElementById('main-navigation-mobile');
    var sections = [].slice.call(document.querySelectorAll('.section'));
    var navLinks = [].slice.call(document.querySelectorAll('#main-navigation a, #main-navigation-mobile a'));
    var isHome = !!document.getElementById('home') && sections.length > 0;
    var current = 'home';
    var busy = false, menuOpen = false, leaveToken = 0;

    if (!curtain || !bck) { setCurtain(null); }

    /* ---- curtain ------------------------------------------------------ */

    function coverIn(cb) {
      if (reduce || !bck) { cb(); return; }
      if (has('curtain-cover') || has('curtain-in')) { cb(); return; }
      if (has('curtain-out')) { setCurtain(null); void curtain.offsetWidth; }
      setCurtain('curtain-in');
      afterTransform(bck, T_IN, cb);
    }

    function sweepOut(cb) {
      if (reduce || !curtain) { setCurtain(null); if (cb) cb(); return; }
      if (!has('curtain-cover') && !has('curtain-in')) { if (cb) cb(); return; }
      setCurtain('curtain-out');
      afterTransform(curtain, T_OUT, function () {
        if (has('curtain-out')) setCurtain(null);
        if (cb) cb();
      });
    }

    function reveal() { if (page) page.classList.add('is-revealed'); }

    function arrive() {
      if (reduce || !curtain) { setCurtain(null); reveal(); fireArrived(); return; }
      var started = false;
      function go() {
        if (started) return;
        started = true;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            sweepOut(fireArrived);
            setTimeout(reveal, REVEAL_AFTER);
          });
        });
      }
      /* A short grace for the webfonts, so text does not reflow as it is
         uncovered. Never longer than 150ms. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(go, go);
        setTimeout(go, 150);
      } else {
        go();
      }
    }

    /* ---- mobile menu -------------------------------------------------- */

    function menuLinks() {
      return mobileNav ? [].slice.call(mobileNav.querySelectorAll('a[href]')) : [];
    }

    function openMenu() {
      if (menuOpen || !mobileNav || !burger) return;
      menuOpen = true;
      root.classList.add('menu-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', 'Close menu');
      var first = menuLinks()[0];
      if (first) {
        requestAnimationFrame(function () {
          if (menuOpen) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
        });
      }
    }

    function closeMenu(returnFocus) {
      if (!menuOpen) return;
      menuOpen = false;
      root.classList.remove('menu-open');
      if (burger) {
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-label', 'Open menu');
        if (returnFocus) { try { burger.focus({ preventScroll: true }); } catch (e) { burger.focus(); } }
      }
    }

    if (burger) {
      burger.addEventListener('click', function () {
        if (menuOpen) closeMenu(true); else openMenu();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!menuOpen) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeMenu(true);
        return;
      }
      if (e.key === 'Tab') {
        var ring = [burger].concat(menuLinks());
        var i = ring.indexOf(document.activeElement);
        var next = e.shiftKey ? (i <= 0 ? ring.length - 1 : i - 1) : (i === ring.length - 1 ? 0 : i + 1);
        e.preventDefault();
        ring[next].focus();
      }
    });

    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 760px)');
      var onWide = function () { if (wide.matches) closeMenu(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }

    /* ---- sections on home --------------------------------------------- */

    function isSection(id) {
      for (var i = 0; i < sections.length; i++) if (sections[i].id === id) return true;
      return false;
    }

    function swap(id) {
      current = id;
      sections.forEach(function (s) { s.classList.toggle('is-active', s.id === id); });
      navLinks.forEach(function (a) {
        var sec = a.getAttribute('data-sec');
        if (!sec) return;
        var on = sec === id;
        a.parentNode.classList.toggle('selected', on);
        if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
      });
      if (history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search + (id === 'home' ? '' : '#' + id));
      }
    }

    function show(id) {
      if (busy) return;
      var fromMenu = menuOpen;
      closeMenu(fromMenu);
      if (id === current) return;
      if (reduce || !content) { swap(id); return; }
      busy = true;
      content.classList.add('is-shifting');
      coverIn(function () {
        swap(id);
        window.scrollTo(0, 0);
        content.classList.remove('is-shifting');
        sweepOut(function () { busy = false; });
      });
    }

    if (isHome) {
      var initial = (location.hash || '').slice(1);
      if (initial && isSection(initial)) swap(initial);   // under the cover, before it lifts
      window.addEventListener('hashchange', function () {
        var id = (location.hash || '').slice(1) || 'home';
        if (isSection(id)) show(id);
      });
    }

    /* ---- leaving the page --------------------------------------------- */

    function leave(href) {
      var token = ++leaveToken;
      coverIn(function () {
        if (token !== leaveToken) return;
        closeMenu(false);
        location.href = href;
      });
    }

    function normalise(p) {
      return p.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
    }

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;

      if (!a) {
        /* A tap on the grey overlay, anywhere that is not a link, closes it. */
        if (menuOpen && mobileNav && mobileNav.contains(e.target)) closeMenu(true);
        return;
      }
      var target = a.getAttribute('target');
      if ((target && target !== '_self') || a.hasAttribute('download')) return;

      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (!/^https?:$/.test(url.protocol) || url.host !== location.host) return;

      if (normalise(url.pathname) === normalise(location.pathname) && url.search === location.search) {
        var id = url.hash.slice(1) || (isHome ? 'home' : '');
        if (isHome && id && isSection(id)) { e.preventDefault(); show(id); return; }
        if (!url.hash) { e.preventDefault(); closeMenu(menuOpen); }
        return;
      }

      e.preventDefault();
      leave(url.href);
    });

    /* ---- back / forward cache ----------------------------------------- */

    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      leaveToken++;
      busy = false;
      closeMenu(false);
      if (content) content.classList.remove('is-shifting');
      reveal();
      if (reduce || (!has('curtain-in') && !has('curtain-cover'))) { setCurtain(null); return; }
      requestAnimationFrame(function () { sweepOut(); });
    });

    /* ---- opening hours on home, painted from the booking data ---------- */

    (function paintHours() {
      if (!window.SHOP || !window.BookingCore) return;
      var host = document.getElementById('hours-rows');
      if (!host) return;
      host.textContent = '';
      window.BookingCore.hoursSummary(window.SHOP).forEach(function (r) {
        var item = document.createElement('div');
        item.className = 'item';
        var d = document.createElement('p'); d.className = 'desc'; d.textContent = r.label;
        var v = document.createElement('p'); v.className = 'value'; v.textContent = r.value;
        item.appendChild(d); item.appendChild(v);
        host.appendChild(item);
      });
      var br = document.getElementById('hours-break');
      var label = window.BookingCore.breakLabel(window.SHOP);
      if (br) br.textContent = label ? 'Closed for a break ' + label + '.' : '';
    })();

    arrive();
  }

  function safeInit() {
    try {
      init();
    } catch (err) {
      /* Never leave a visitor behind a sheet of paper. */
      setCurtain(null);
      var page = document.querySelector('.page');
      if (page) page.classList.add('is-revealed');
      fireArrived();
      if (window.console) console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit);
  else safeInit();
})();
