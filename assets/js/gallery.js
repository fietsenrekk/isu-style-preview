/*
  UCHI - gallery page
  ===================

  Reads public.gallery_images (published rows, ordered by sort then
  created_at) through the shared public client, builds public URLs from the
  'gallery' bucket, and lays them out as ISU's COLLECTIONS: pages of up to six
  photographs on the six measured fragment slots (#item-col-1 .. -6), with the
  1 2 switcher when there is more than one page.

  Never throws at the visitor. No client, a failed query, no answer within
  8 seconds, or zero rows all end in the same place: the empty composition
  already written into gallery.html. All text is set with textContent.

  ISU (js/app/ui/Collections.js) measured:
    section intro      opacity 0, y 70 -> 1, 0 over .45s (TweenMax default
                       ease, Power1.easeOut)
    page switch        old block opacity -> 0 over 1.35s; new block opacity
                       -> 1 over 1.35s after .3s
    switcher span      color #888 -> #000, .35s ease-in, margin 0 2px
*/
(function () {
  'use strict';

  var PER_PAGE = 6;
  var TIMEOUT_MS = 8000;
  /* Which ISU slot the n-th photograph of a page takes. The large centre
     frame (#item-col-6) goes first, so a page with one or two photographs
     still reads as the composition rather than as a corner of it. */
  var SLOT_FOR = [6, 2, 1, 3, 4, 5];
  var TITLE = 'GALLERY';
  var BODY_EMPTY = 'New work is on its way.';
  var BODY_FULL = 'UCHI, Klapdorp 37, Antwerp.';

  var section = document.getElementById('collections');
  var content = document.getElementById('collections-content');
  var switcher = document.getElementById('collections-nav');
  if (!section || !content || !switcher) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fragments(pageIndex, body) {
    var f = el('div', 'collections-fragments');
    f.id = 'collections-block-fragments-' + (pageIndex + 1);
    f.appendChild(el('h2', 'frag__t', TITLE));
    f.appendChild(el('p', 'frag__p', body));
    return f;
  }

  function item(photo, slot, order) {
    var box = el('div', 'item');
    box.id = 'item-col-' + slot;
    box.style.order = String(order);   /* phone stacking follows the data order */
    var img = document.createElement('img');
    img.alt = photo.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = photo.width || 900;
    img.height = photo.height || 1200;
    var settled = false;
    function loaded() { if (settled) return; settled = true; box.classList.add('is-loaded'); }
    function failed() { if (settled) return; settled = true; if (box.parentNode) box.parentNode.removeChild(box); }
    img.addEventListener('load', loaded);
    img.addEventListener('error', failed);
    img.src = photo.src;
    if (img.complete && img.naturalWidth > 0) loaded();
    box.appendChild(img);
    return box;
  }

  var pages = [];
  var currentPage = 0;

  function goTo(i) {
    if (i === currentPage || !pages[i]) return;
    pages[currentPage].classList.remove('is-current');
    pages[i].classList.add('is-current');
    var buttons = switcher.querySelectorAll('button');
    for (var b = 0; b < buttons.length; b++) {
      var on = b === i;
      buttons[b].classList.toggle('selected', on);
      if (on) buttons[b].setAttribute('aria-current', 'true'); else buttons[b].removeAttribute('aria-current');
    }
    currentPage = i;
  }

  function render(photos) {
    photos = (photos || []).filter(function (p) { return p && typeof p.src === 'string' && p.src; });
    content.textContent = '';
    switcher.textContent = '';
    pages = [];
    currentPage = 0;

    var empty = photos.length === 0;
    section.classList.toggle('is-empty', empty);
    var count = empty ? 1 : Math.ceil(photos.length / PER_PAGE);

    for (var p = 0; p < count; p++) {
      var block = el('div', 'collections-block collection-mobile' + (p === 0 ? ' is-current' : ''));
      block.id = 'collections-block-' + (p + 1);
      block.appendChild(fragments(p, empty ? BODY_EMPTY : BODY_FULL));

      if (!empty) {
        var chunk = photos.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
        var bySlot = [];
        chunk.forEach(function (photo, i) { bySlot[SLOT_FOR[i]] = { photo: photo, order: i }; });
        /* DOM in slot order, so the stacking matches ISU's (later slots on top,
           4 and 5 lifted by z-index in the stylesheet). */
        for (var s = 1; s <= 6; s++) {
          if (bySlot[s]) block.appendChild(item(bySlot[s].photo, s, bySlot[s].order));
        }
      }
      content.appendChild(block);
      pages.push(block);
    }

    if (count > 1) {
      for (var n = 0; n < count; n++) {
        var btn = el('button', n === 0 ? 'selected' : '', String(n + 1));
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Page ' + (n + 1));
        if (n === 0) btn.setAttribute('aria-current', 'true');
        btn.addEventListener('click', (function (i) { return function () { goTo(i); }; })(n));
        switcher.appendChild(btn);
      }
      switcher.hidden = false;
    } else {
      switcher.hidden = true;
    }
  }

  function load() {
    var client = null;
    try { client = window.UchiDB && window.UchiDB.client(); } catch (e) { client = null; }
    if (!client) return Promise.resolve([]);

    var query = Promise.resolve().then(function () {
      return client.from('gallery_images')
        .select('path, caption, alt, width, height, sort, created_at')
        .eq('published', true)
        .order('sort', { ascending: true })
        .order('created_at', { ascending: true });
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve({ data: null, error: 'timeout' }); }, TIMEOUT_MS);
    });

    return Promise.race([query, timeout]).then(function (res) {
      if (!res || res.error || !Array.isArray(res.data)) return [];
      return res.data.map(function (row) {
        var src = '';
        try { src = client.storage.from('gallery').getPublicUrl(row.path).data.publicUrl; } catch (e) { src = ''; }
        return {
          src: src,
          alt: (row.alt || row.caption || 'Photograph from UCHI').trim(),
          width: row.width > 0 ? row.width : null,
          height: row.height > 0 ? row.height : null
        };
      });
    }, function () { return []; });
  }

  function ready() {
    function play() { requestAnimationFrame(function () { section.classList.add('is-ready'); }); }
    if (window.UchiSite && window.UchiSite.whenArrived) window.UchiSite.whenArrived(play); else play();
  }

  section.classList.add('is-loading');
  window.UchiGallery = { render: render };

  load().then(function (photos) {
    try { render(photos); } catch (e) { try { render([]); } catch (e2) { /* the static empty state stays */ } }
  }, function () {
    try { render([]); } catch (e) { /* the static empty state stays */ }
  }).then(function () {
    section.classList.remove('is-loading');
    ready();
  });
})();
