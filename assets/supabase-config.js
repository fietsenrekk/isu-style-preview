/*
  UCHI — Supabase connection
  ==========================

  The project URL and the PUBLISHABLE key. Both are public by design: this key
  can do exactly what the database's row-level security allows an anonymous
  visitor to do, which is read the price list, hours and published gallery,
  read which time ranges are taken (no names), and create a booking through the
  validated create_booking() function. It cannot read bookings, change prices
  or upload images. Never put a service-role / secret key in this file.
*/
window.UCHI_SUPABASE = {
  url: 'https://kvnnikyjsvhxpdftfagj.supabase.co',
  key: 'sb_publishable_yXjnHNTOeESBC89LAqJD3g_woFpQS2T'
};
