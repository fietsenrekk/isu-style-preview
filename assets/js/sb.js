/*
  UCHI — one shared Supabase client per page.

  Public pages ask for a client that never persists a session, so a visitor's
  browser holds no auth token at all. Only /admin keeps a session.
*/
(function () {
  'use strict';
  var cache = null;
  window.UchiDB = {
    available: function () {
      return !!(window.supabase && window.supabase.createClient && window.UCHI_SUPABASE);
    },
    client: function (opts) {
      if (cache) return cache;
      if (!this.available()) return null;
      var isPublic = !opts || opts.public !== false;
      cache = window.supabase.createClient(window.UCHI_SUPABASE.url, window.UCHI_SUPABASE.key, {
        auth: {
          persistSession: !isPublic,
          autoRefreshToken: !isPublic,
          detectSessionInUrl: false,
          storageKey: 'uchi-admin-auth'
        }
      });
      return cache;
    }
  };
})();
