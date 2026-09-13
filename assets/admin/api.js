/*
  UCHI admin, data access.

  Every read and write the dashboard makes goes through this object, so the
  in-memory demo (demo.js) can stand in for it method for method. Access is
  enforced by row-level security in the database, not here: this file only
  asks, and an account that is not on the admin list gets nothing back.
*/
(function () {
  'use strict';
  var UA = window.UA = window.UA || {};

  UA.realApi = function () {
    var c = window.UchiDB && UchiDB.client({ public: false });
    if (!c) return null;

    function run(p) {
      return Promise.resolve(p).then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
    }
    /* Writes return the affected rows; RLS filtering a write silently shows up as zero rows. */
    function must(p) {
      return run(p).then(function (rows) {
        if (Array.isArray(rows) && rows.length === 0) { var e = new Error('no rows'); e.code = 'no_rows'; throw e; }
        return Array.isArray(rows) ? rows[0] : rows;
      });
    }
    function fromHash() {
      var h = location.hash.replace(/^#/, '');
      if (!/access_token=|error_description=|error=/.test(h)) return null;
      var p = new URLSearchParams(h);
      return { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
               type: p.get('type'), error: p.get('error_description') || p.get('error') };
    }
    function redirectTo() { return location.origin + '/admin'; }

    var auth = {
      session: function () {
        return c.auth.getSession().then(function (r) { return r.data && r.data.session; });
      },
      signIn: function (email, password) {
        return c.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
          if (r.error) throw r.error; return r.data.session;
        });
      },
      signUp: function (email, password) {
        return c.auth.signUp({ email: email, password: password, options: { emailRedirectTo: redirectTo() } })
          .then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      signOut: function () { return c.auth.signOut().catch(function () {}); },
      resetPassword: function (email) {
        return c.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() })
          .then(function (r) { if (r.error) throw r.error; });
      },
      updatePassword: function (password) {
        return c.auth.updateUser({ password: password }).then(function (r) { if (r.error) throw r.error; });
      },
      onChange: function (cb) {
        c.auth.onAuthStateChange(function (event, session) {
          /* Supabase warns against awaiting its own calls inside this callback. */
          setTimeout(function () { cb(event, session); }, 0);
        });
      },
      /*
        The shared client is created with detectSessionInUrl: false, so the
        tokens an e-mail link puts in the address are read here instead.
        Returns { type } ('recovery', 'signup', ...) or { error } or null.
      */
      consumeRedirect: function () {
        var h = fromHash();
        var q = new URLSearchParams(location.search);
        function tidy() { history.replaceState(null, '', location.pathname); }
        if (h && h.error) { tidy(); return Promise.resolve({ error: h.error }); }
        if (h && h.access_token && h.refresh_token) {
          return c.auth.setSession({ access_token: h.access_token, refresh_token: h.refresh_token })
            .then(function (r) { tidy(); if (r.error) return { error: UA.errorText(r.error) }; return { type: h.type || 'signin' }; });
        }
        if (q.get('code')) {
          var isRecovery = q.get('type') === 'recovery';
          return c.auth.exchangeCodeForSession(q.get('code')).then(function (r) {
            tidy();
            if (r.error) return { error: 'This link has expired or was already used. Ask for a new one.' };
            return { type: isRecovery ? 'recovery' : 'signin' };
          });
        }
        return Promise.resolve(null);
      }
    };

    return {
      demo: false,
      auth: auth,

      /* Admins can read the allowlist; anyone else gets an empty list. */
      checkAccess: function () {
        return run(c.from('admins').select('email').limit(1)).then(function (rows) { return rows.length > 0; })
          .catch(function (e) { if (e && e.code === '42501') return false; throw e; });
      },

      getSettings: function () { return run(c.from('settings').select('*').eq('id', 1).maybeSingle()); },
      updateSettings: function (patch) { return must(c.from('settings').update(patch).eq('id', 1).select()); },

      listStaff: function () { return run(c.from('staff').select('*').order('sort').order('name')); },
      updateStaff: function (id, patch) { return must(c.from('staff').update(patch).eq('id', id).select()); },

      listServices: function () { return run(c.from('services').select('*').order('sort')); },
      updateService: function (id, patch) { return must(c.from('services').update(patch).eq('id', id).select()); },
      listServiceStaff: function () { return run(c.from('service_staff').select('service_id, staff_id')); },
      setServiceStaff: function (serviceId, staffIds) {
        return run(c.from('service_staff').select('staff_id').eq('service_id', serviceId)).then(function (rows) {
          var have = rows.map(function (r) { return r.staff_id; });
          var add = staffIds.filter(function (s) { return have.indexOf(s) < 0; });
          var del = have.filter(function (s) { return staffIds.indexOf(s) < 0; });
          var jobs = [];
          if (del.length) jobs.push(run(c.from('service_staff').delete().eq('service_id', serviceId).in('staff_id', del)));
          if (add.length) jobs.push(run(c.from('service_staff').insert(add.map(function (s) {
            return { service_id: serviceId, staff_id: s };
          }))));
          return Promise.all(jobs);
        });
      },

      listBookings: function (fromIso, toIso, ascending) {
        return run(c.from('bookings').select('*').gte('starts_at', fromIso).lt('starts_at', toIso)
          .order('starts_at', { ascending: ascending !== false }).limit(2000));
      },
      updateBooking: function (id, patch) { return must(c.from('bookings').update(patch).eq('id', id).select()); },
      insertBooking: function (row) {
        return must(c.from('bookings').insert(row).select()).catch(function (e) {
          /* If the column turns out to be NOT NULL, an empty e-mail is the honest value. */
          if (e && e.code === '23502' && row.customer_email === null && /customer_email/.test(e.message || '')) {
            var copy = Object.assign({}, row, { customer_email: '' });
            return must(c.from('bookings').insert(copy).select());
          }
          throw e;
        });
      },

      listTimeOff: function () { return run(c.from('time_off').select('*').order('starts_at')); },
      insertTimeOff: function (row) { return must(c.from('time_off').insert(row).select()); },
      deleteTimeOff: function (id) { return must(c.from('time_off').delete().eq('id', id).select()); },

      listGallery: function () { return run(c.from('gallery_images').select('*').order('sort').order('created_at')); },
      insertGallery: function (row) { return must(c.from('gallery_images').insert(row).select()); },
      updateGallery: function (id, patch) { return must(c.from('gallery_images').update(patch).eq('id', id).select()); },
      deleteGallery: function (row) {
        return run(c.storage.from('gallery').remove([row.path])).then(function () {
          return must(c.from('gallery_images').delete().eq('id', row.id).select());
        });
      },
      uploadImage: function (path, blob, contentType) {
        return run(c.storage.from('gallery').upload(path, blob, {
          contentType: contentType, cacheControl: '31536000', upsert: false
        }));
      },
      removeObject: function (path) { return run(c.storage.from('gallery').remove([path])).catch(function () {}); },
      imageUrl: function (path) { return c.storage.from('gallery').getPublicUrl(path).data.publicUrl; },

      listAdmins: function () { return run(c.from('admins').select('email').order('email')); },
      addAdmin: function (email) { return must(c.from('admins').insert({ email: email }).select()); },
      removeAdmin: function (email) {
        return must(c.from('admins').delete().eq('email', email).select()).catch(function (e) {
          if (e && e.code === 'no_rows') e.friendly = 'Not removed. The last admin cannot be removed.';
          throw e;
        });
      }
    };
  };
})();
