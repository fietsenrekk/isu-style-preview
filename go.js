/* This GitHub Pages copy is retired; the live site runs on Netlify with its
   security headers and Supabase booking. Forward every path to the same page. */
(function () {
  var p = location.pathname.replace(/^\/isu-style-preview/, '').replace(/\.html$/, '').replace(/\/index$/, '/');
  var allowed = { '/home': 1, '/gallery': 1, '/reservation': 1, '/admin': 1 };
  var dest = allowed[p] ? p : '/home';
  location.replace('https://labiwebsite.netlify.app' + dest + location.hash);
})();
