-- UCHI 0002: seed data, mirroring assets/booking-data.js exactly.

insert into public.settings
  (id, open_days, open_time, close_time, break_start, break_end,
   slot_step_minutes, lead_time_minutes, booking_horizon_days)
values
  (1, '{1,2,3,4,5}', '10:00', '22:00', '14:00', '15:00', 15, 60, 60);

insert into public.staff (id, name, role, sort, active) values
  ('labi',    'LABI',    'Hairstylist', 1, true),
  ('donovan', 'DONOVAN', 'Hairstylist', 2, true);

insert into public.services (id, name, nl, price, is_from, minutes, grp, sort, active) values
  ('knippen',    'Cuts',       'Knippen',    35.00, true,   45, 'cut',     1, true),
  ('blowdry',    'Blow dry',   'Blowdrogen', 35.00, true,   45, 'blowdry', 2, true),
  ('wassen',     'Wash',       'Wassen',      7.50, false,  15, 'wash',    3, true),
  ('highlights', 'Highlights', 'Highlights', 60.00, true,   90, 'colour',  4, true),
  ('balayage',   'Balayage',   'Balayage',  160.00, true,  180, 'colour',  5, true),
  ('roots',      'Roots',      'Uitgroei',   50.00, true,   90, 'colour',  6, true),
  ('kleuring',   'Colour',     'Kleuring',   50.00, true,  120, 'colour',  7, true),
  ('toner',      'Toner',      'Toner',      45.00, true,   45, 'toner',   8, true);

insert into public.service_staff (service_id, staff_id) values
  ('knippen', 'labi'), ('blowdry', 'labi'), ('wassen', 'labi'),
  ('knippen', 'donovan'), ('blowdry', 'donovan'), ('wassen', 'donovan'),
  ('highlights', 'donovan'), ('balayage', 'donovan'), ('roots', 'donovan'),
  ('kleuring', 'donovan'), ('toner', 'donovan');

insert into public.admins (email) values
  ('charlesmuwangam@gmail.com'),
  ('info@uchi.be');
