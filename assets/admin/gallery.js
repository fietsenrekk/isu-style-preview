/*
  UCHI admin, gallery.

  Images are downscaled in the browser (long edge 2000 px, WebP 0.85) before
  they are uploaded, so a 12 MB phone photo becomes a few hundred KB on the
  public page. Upload order: storage object first, then the gallery_images row;
  if the row fails the object is removed again so nothing is orphaned.
  Delete order: storage object first, then the row.
*/
(function () {
  'use strict';
  var UA = window.UA, el = UA.el;
  var MAX_EDGE = 2000, QUALITY = 0.85, ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

  /* file -> Promise<{ blob, type, ext, width, height }> */
  function prepare(file) {
    return decode(file).then(function (img) {
      var w = img.width, h = img.height;
      var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      return new Promise(function (resolve) {
        try {
          var cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
          cv.getContext('2d').drawImage(img.source, 0, 0, tw, th);
          cv.toBlob(function (blob) {
            if (blob && blob.type === 'image/webp') resolve({ blob: blob, type: 'image/webp', ext: 'webp', width: tw, height: th });
            else resolve(null);
          }, 'image/webp', QUALITY);
        } catch (e) { resolve(null); }
      }).then(function (out) {
        if (img.close) img.close();
        if (out) return out;
        /* Canvas could not encode WebP here: keep the original file untouched. */
        if (ALLOWED.indexOf(file.type) < 0) throw { friendly: 'This browser could not convert the image, and the original type is not allowed.' };
        return { blob: file, type: file.type, ext: file.type.split('/')[1].replace('jpeg', 'jpg'), width: w, height: h };
      });
    });
  }
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then(function (bm) {
        return { source: bm, width: bm.width, height: bm.height, close: function () { bm.close(); } };
      }).catch(function () { return decodeImg(file); });
    }
    return decodeImg(file);
  }
  function decodeImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { resolve({ source: im, width: im.naturalWidth, height: im.naturalHeight, close: function () { URL.revokeObjectURL(url); } }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject({ friendly: 'This file could not be read as an image.' }); };
      im.src = url;
    });
  }

  UA.panels.gallery = function (root, ctx) {
    var api = ctx.api;
    var rows = [];
    var listMsg = UA.msg();

    var input = el('input.visually-hidden', { type: 'file', accept: 'image/*', multiple: true, id: 'gal-file', tabindex: '-1' });
    var pick = el('button.btn.btn--ink', { type: 'button', text: 'Choose photos' });
    var drop = el('div.drop', { 'data-drop': '' },
      el('p.drop__big', { text: 'Drop photos here' }),
      el('p.drop__small', { text: 'or' }), pick, input,
      el('p.field__hint', { text: 'JPG, PNG, WebP or AVIF. Large photos are resized to 2000 px and saved as WebP.' }));
    var queue = el('ul.queue', { 'aria-live': 'polite' });
    var grid = el('ul.gal');

    UA.append(root, [
      el('div.panel__head', el('h2.panel__title', { id: 'h-gallery', text: 'Gallery' }),
        el('div.panel__tools', el('span.panel__meta', { text: 'The public gallery shows 6 images per page, in this order.' }))),
      drop, queue, listMsg.node, grid
    ]);

    pick.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { handle(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) { handle(e.dataTransfer && e.dataTransfer.files); });

    function load() {
      listMsg.busy('Loading');
      return api.listGallery().then(function (r) { rows = r || []; listMsg.clear(); render(); })
        .catch(function (e) { listMsg.err(e); });
    }

    /* Sequential, so sort values stay distinct and a phone is not asked to decode 20 photos at once. */
    function handle(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      var chain = Promise.resolve();
      list.forEach(function (file) {
        var status = el('span.queue__status', { text: 'Waiting' });
        var item = el('li.queue__item', el('span.queue__name', { text: file.name }), status);
        queue.appendChild(item);
        function set(kind, text) { status.textContent = text; item.className = 'queue__item is-' + kind; }
        chain = chain.then(function () {
          if (!/^image\//.test(file.type)) { set('err', 'Not an image, skipped'); return; }
          set('busy', 'Resizing');
          var path;
          return prepare(file).then(function (out) {
            if (out.blob.size > 10 * 1024 * 1024) throw { friendly: 'Still larger than 10 MB after resizing.' };
            var t = UchiTZ.parts(new Date());
            path = t.y + '/' + UchiTZ.pad(t.m) + '/' + UA.uuid() + '.' + out.ext;
            set('busy', 'Uploading ' + Math.round(out.blob.size / 1024) + ' KB');
            return api.uploadImage(path, out.blob, out.type).then(function () {
              var max = rows.reduce(function (a, r) { return Math.max(a, Number(r.sort) || 0); }, 0);
              return api.insertGallery({ path: path, sort: max + 10, published: true,
                width: out.width, height: out.height, caption: null, alt: null })
                .catch(function (e) { api.removeObject(path); throw e; });
            });
          }).then(function (row) {
            rows.push(row); render();
            set('ok', 'Added. Add a caption and alt text below.');
          }).catch(function (e) { set('err', UA.errorText(e)); });
        });
      });
      chain.then(function () {
        setTimeout(function () {
          Array.prototype.slice.call(queue.querySelectorAll('.is-ok')).forEach(function (n) { n.remove(); });
        }, 8000);
      });
    }

    function sorted() { return rows.slice().sort(function (a, b) { return (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)); }); }

    function render() {
      UA.clear(grid);
      var list = sorted();
      if (!list.length) { grid.appendChild(el('li.empty', { text: 'No images yet. Add the first ones above.' })); return; }
      var published = 0;
      list.forEach(function (r, i) {
        if (r.published) published++;
        grid.appendChild(card(r, i, list, r.published ? Math.ceil(published / 6) : null));
      });
    }

    function card(r, i, list, page) {
      var m = UA.msg();
      function textEdit(label, key, max) {
        var inp = el('input', { type: 'text', maxlength: String(max), value: r[key] || '', 'data-key': key });
        function commit() {
          var v = inp.value.trim();
          if (v === (r[key] || '')) return;
          var patch = {}; patch[key] = v || null;
          m.busy();
          api.updateGallery(r.id, patch).then(function () { r[key] = v || null; m.ok(label + ' saved'); })
            .catch(function (e) { m.err(e); });
        }
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        return UA.field(label, inp).wrap;
      }
      var pub = el('input', { type: 'checkbox', checked: r.published, 'data-key': 'published' });
      pub.addEventListener('change', function () {
        var v = pub.checked; m.busy();
        api.updateGallery(r.id, { published: v }).then(function () { r.published = v; render(); })
          .catch(function (e) { pub.checked = !v; m.err(e); });
      });
      var up = el('button.btn.btn--icon', { type: 'button', 'aria-label': 'Move earlier', text: '↑', disabled: i === 0 });
      var down = el('button.btn.btn--icon', { type: 'button', 'aria-label': 'Move later', text: '↓', disabled: i === list.length - 1 });
      var del = el('button.btn.btn--quiet', { type: 'button', text: 'Delete' });
      up.addEventListener('click', function () { move(list, i, -1, m); });
      down.addEventListener('click', function () { move(list, i, 1, m); });
      del.addEventListener('click', function () {
        UA.confirm('Delete this image?', 'Delete', 'It is removed from the website and from storage. This cannot be undone.').then(function (yes) {
          if (!yes) return;
          del.disabled = true; m.busy('Deleting');
          api.deleteGallery(r).then(function () {
            rows = rows.filter(function (x) { return x.id !== r.id; }); render();
            listMsg.ok('Image deleted');
          }).catch(function (e) { del.disabled = false; m.err(e); });
        });
      });

      return el('li.gal__item' + (r.published ? '' : '.is-hidden'), { 'data-id': r.id },
        el('div.gal__img',
          el('img', { src: api.imageUrl(r.path), alt: r.alt || '', loading: 'lazy', decoding: 'async',
            width: r.width || null, height: r.height || null }),
          el('span.gal__pos', { text: '#' + (i + 1) + (page ? ' · page ' + page : ' · hidden') })),
        el('div.gal__body',
          textEdit('Caption', 'caption', 140),
          textEdit('Alt text (describes the photo for screen readers)', 'alt', 200),
          el('div.gal__row',
            el('label.check.check--inline', pub, el('span.check__text', { text: 'Published' })),
            el('span.gal__move', up, down), del),
          m.node));
    }

    function move(list, i, dir, m) {
      var j = i + dir;
      if (j < 0 || j >= list.length) return;
      var order = list.slice();
      var t = order[i]; order[i] = order[j]; order[j] = t;
      var changes = [];
      order.forEach(function (r, k) {
        var want = (k + 1) * 10;
        if (Number(r.sort) !== want) changes.push([r, want]);
      });
      m.busy('Moving');
      Promise.all(changes.map(function (c) { return api.updateGallery(c[0].id, { sort: c[1] }); })).then(function () {
        changes.forEach(function (c) { c[0].sort = c[1]; });
        render();
        var again = grid.querySelector('[data-id="' + order[j].id + '"] [aria-label="' + (dir < 0 ? 'Move earlier' : 'Move later') + '"]');
        if (again && !again.disabled) again.focus();
      }).catch(function (e) { m.err(e); load(); });
    }

    var loaded = false;
    return { show: function () { if (!loaded) { loaded = true; load(); } }, hide: function () {} };
  };
})();
