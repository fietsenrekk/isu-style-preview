/*
  UCHI - booking provider
  =======================

  Where a finished booking goes: straight into the salon's own diary, through
  the Supabase RPC create_booking (see docs/ARCHITECTURE.md). The browser only
  holds the publishable key, which cannot read bookings at all; the RPC checks
  everything again on the server (services, stylist, opening hours, break,
  grid, lead time, horizon, time off, overlap, contact details, rate limit)
  and the table's exclusion constraint is the last word on double booking. So
  nothing the page shows is trusted: a slot that looked free but was taken a
  second ago comes back as `slot_taken`, and the page refreshes availability
  and asks for another time.

  Flow:
    submit(booking, form, hooks)
      -> button disabled, reads "BOOKING..."
      -> rpc('create_booking', { p_service_ids, p_staff_id (null = first
         available), p_date 'YYYY-MM-DD', p_time 'HH:MM' Brussels, p_name,
         p_email, p_phone, p_notes, p_hp (honeypot, the hidden "website"
         field) })
      -> { ok: true, ... }   the form is replaced by a confirmation built from
                             what the server stored (stylist, time, total)
      -> { ok: false, error } a plain message for that code under the button;
                             slot-type errors call hooks.onRetime(code) so the
                             page clears the time and re-checks availability
      -> network failure     a message with the phone number; the form and
                             everything typed stay as they are

  Alternatives considered: embedding onlineafspraken.nl (what ISU uses) needs
  the salon's own paid account and an iframe in someone else's styling; its
  REST API needs a signing secret, which a static site would publish. An
  e-mail request (the previous version of this file) booked nothing. A small
  database with a validated function is the one option that books for real
  with no server of our own.
*/

window.BookingProvider = (function () {
  'use strict';

  var PHONE = '+32 498 80 30 33';

  /* Shown under the submit button before anything is pressed. */
  var note = 'This books the appointment straight away. Nothing is charged. '
           + 'Rather speak to someone? Call ' + PHONE + '.';

  var MESSAGES = {
    invalid_services: 'Those services cannot be booked together online. Please change your '
      + 'choice, or call us on ' + PHONE + '.',
    invalid_staff: 'That stylist cannot take this booking. Please choose the other stylist '
      + 'or leave the choice open.',
    closed: 'The salon is closed on that day. Please pick another day.',
    outside_hours: 'That time is outside opening hours. Please pick another time.',
    in_break: 'That time runs into the break. Please pick another time.',
    off_grid: 'That start time cannot be booked. Please pick one of the times shown.',
    too_soon: 'That time is too soon to book online. Please pick a later time, or call us on '
      + PHONE + '.',
    too_far: 'That day is too far ahead to book online. Please pick an earlier day.',
    slot_taken: 'Sorry, that time was just taken. The times shown are now up to date, '
      + 'please pick another one.',
    invalid_contact: 'Please check your name, e-mail address and phone number.',
    rate_limited: 'This e-mail address already has several bookings with us. Please call us on '
      + PHONE + ' and we will help you.',
    rejected: 'The booking could not be made. Please call us on ' + PHONE + '.',
    network: 'We could not reach the booking system, so nothing was booked. Your details are '
      + 'still here: try again in a moment, or call us on ' + PHONE + '.',
    unknown: 'Something went wrong and nothing was booked. Please try again, or call us on '
      + PHONE + '.'
  };

  /* Codes after which the chosen time is no longer valid. */
  var RETIME = ['slot_taken', 'too_soon', 'off_grid', 'in_break', 'outside_hours', 'closed', 'too_far'];

  function message(code) { return MESSAGES[code] || MESSAGES.unknown; }

  function params(b) {
    return {
      p_service_ids: b.services.map(function (s) { return s.id; }),
      p_staff_id: b.staffId || null,
      p_date: b.isoDate,
      p_time: b.time,
      p_name: b.name,
      p_email: b.email,
      p_phone: b.phone,
      p_notes: b.notes ? b.notes : null,
      p_hp: b.hp || ''
    };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function money(n) { return n % 1 === 0 ? String(n) : n.toFixed(2); }

  function confirmation(b, res) {
    var Core = window.BookingCore;
    var at = res.starts_at && Core ? Core.brusselsLabel(Date.parse(res.starts_at)) : null;
    var dateText = at ? DAYS[at.dow] + ' ' + at.d + ' ' + MONTHS[at.m - 1] + ' ' + at.y : b.dateLabel;
    var timeText = at ? at.time : b.time;
    var total = res.total_price != null
      ? (res.price_is_from ? 'from ' : '') + money(Number(res.total_price)) + ' euro'
      : b.price + ' euro';
    var who = res.staff_name || b.staffName;

    var done = el('div', 'bdone');
    done.setAttribute('role', 'status');
    done.appendChild(el('p', 'bdone__h', 'BOOKED'));
    done.appendChild(el('p', 'bdone__p',
      'Thank you, ' + b.name + '. Your appointment at UCHI is booked.'));
    var lines = [
      'Stylist   ' + who,
      'Date      ' + dateText,
      'Time      ' + timeText,
      'Services  ' + b.services.map(function (s) { return s.name; }).join(' + '),
      'Total     ' + total
    ];
    done.appendChild(el('pre', 'bdone__pre', lines.join('\n')));
    done.appendChild(el('p', 'step__hint',
      'Need to change or cancel it? Call us on ' + PHONE + '.'));
    return done;
  }

  /*
    Resolves { ok: true, data } or { ok: false, error }. Never rejects, so the
    page always ends in a readable state.
  */
  function submit(booking, form, hooks) {
    hooks = hooks || {};
    var button = form.querySelector('.bsubmit');
    var noteNode = form.querySelector('.bnote');
    var label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'BOOKING...'; }
    if (noteNode) noteNode.textContent = '';

    function restore() {
      if (button) { button.disabled = false; button.textContent = label; }
    }
    function fail(code) {
      restore();
      if (noteNode) {
        noteNode.setAttribute('role', 'alert');
        noteNode.textContent = message(code);
      }
      if (RETIME.indexOf(code) !== -1 && hooks.onRetime) hooks.onRetime(code);
      return { ok: false, error: code };
    }

    var db = window.UchiDB;
    var client = null;
    try { client = db && db.client ? db.client() : null; } catch (e) { client = null; }
    if (!client) return Promise.resolve(fail('network'));

    return Promise.resolve()
      .then(function () { return client.rpc('create_booking', params(booking)); })
      .then(function (r) {
        if (r.error || !r.data) return fail(r.status >= 400 ? 'unknown' : 'network');
        var data = r.data;
        if (!data.ok) return fail(data.error || 'unknown');
        var done = confirmation(booking, data);
        form.parentNode.replaceChild(done, form);
        if (done.scrollIntoView) done.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (hooks.onBooked) hooks.onBooked(data);
        return { ok: true, data: data };
      }, function () { return fail('network'); });
  }

  return { submit: submit, note: note, message: message, params: params,
           phone: PHONE, codes: Object.keys(MESSAGES) };
})();
