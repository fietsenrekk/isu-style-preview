/*
  JILL SCUTT — booking provider adapter
  =====================================

  Where a finished booking goes. Everything above this file — the exclusion
  logic, the slot maths, the whole interface — is provider-independent; this
  is the only file that has to change when the salon signs up to a planner.

  WHY THERE IS AN ADAPTER AT ALL

  The site is static, served from GitHub Pages. There is no server, so there is
  nothing here that can hold a diary, take a deposit, or stop two people
  claiming 15:00 on the same Thursday. Any real booking system is therefore
  somebody else's server, and the honest question is only which one and who
  owns the account.

  ISU embeds onlineafspraken.nl. Their widget URL carries an account key that
  identifies THEIR diary — pointing this site at it would drop Jill Scutt's
  customers into ISU's calendar, so it is not an option, and no amount of
  restyling makes it one.

  So the default below does the one thing that genuinely works today with no
  account and no server: it composes the complete, unambiguous appointment
  request the visitor just built and hands it to the salon by e-mail. Every
  field the salon needs is in it. Nothing is invented, and nothing pretends to
  be confirmed that is not — the button says "request", the confirmation says
  the salon will confirm, because until a human or a real diary answers, that
  is exactly what has happened.

  SWAPPING IN A REAL PLANNER

  Implement `submit` against the provider and delete the mailto branch. The
  shape of `booking` is stable:

    { shop, staffId, staffName, serviceId, serviceName, serviceNl,
      price, minutes, date (Date), dateLabel, time ('HH:MM'),
      name, email, phone, notes }

  ---------------------------------------------------------------------------
  ROUTE A — onlineafspraken.nl (what ISU runs). Recommended.
  ---------------------------------------------------------------------------

  The salon needs their own account. Tier "Groei" — 32,50/month billed annually,
  40,00 monthly, covering 2 to 10 resources — is the one that matters, because
  it is the tier that lists "widgets per resource". 14-day free trial, no free
  tier, sign-up is a manual web form at
  agenda.onlineafspraken.nl/company/register/groei.

  Their platform already does the Labi/Donovan split natively, configured in
  the backend with no code: resource lists are scoped per appointment-type
  group, so a stylist who does not perform a service simply does not appear in
  that service's picker. ISU's own live widget shows exactly this — two
  separate pickers, "Cut or blowdry by" and "Color by", with different staff in
  each. In other words the exclusion this file's UI implements by hand is the
  same behaviour the real platform gives you once Labi is marked as not
  performing highlights, balayage and toner.

  Once the key exists, the whole of this adapter is replaced by an iframe.
  The URL segments, decoded by diffing the widgetConfig JSON the widget embeds
  in its own HTML across altered requests:

    key   the account. THE ONLY PART THAT CHANGES BETWEEN SALONS.
    at    appointment-type filter, 0 = no filter
    rs    resource (staff) filter, 0 = no filter. Set it per stylist to get
          one widget per chair.
    ln    language — 1 = English, 2 = Dutch
    l     five digits of layout components; digit 4 is the pricing component
    t     packed display toggles (showResource, showSlots, showDuration...).
          Not a clean bitmask — copy whatever value the backend generates
          rather than hand-authoring it.
    f     font, hex, read right-to-left in pairs: [size2][size1][family][size3]
    c     SEVEN values in the order LINK, MAIN, TEXT, TEXTMAIN, TEXTALT,
          BACKGROUND, and a seventh that is not a colour. Note the trap: slot 1
          is the LINK colour, not the background — putting #fcfcfc there makes
          every link invisible.
    s     min_max size
    o     key:value options
    output  html

  For this site's palette that gives:

    c/000000,000000,000000,000000,888888,fcfcfc,0

  Two things the URL cannot fix: button label colour is white and is an
  account-level backend setting, and the widget's own typography is Verdana
  from a fixed enum. And the iframe height must be hard-set — the official
  auto-resize loader at widget.onlineafspraken.nl/js/widget.js points at a
  path that now 404s, and the current bundle emits no height message at all.
  Budget 1400-1600px, as ISU does with s/500_1500.

  ---------------------------------------------------------------------------
  ROUTE B — their REST API. Not viable here, and worth writing down why.
  ---------------------------------------------------------------------------

  It is real: https://agenda.onlineafspraken.nl/APIREST, XML responses, auth by
  api_key + timestamp salt + SHA256 signature over the sorted parameters and
  the account's api_secret. But it is Pro tier only (65,00/month, double the
  Groei price) and the signature needs that secret at call time. This site is
  static, so "call time" means in the browser, so the secret would be published
  to anyone who opens the page — along with full access to the salon's diary.
  The endpoint does send permissive CORS headers, which makes it look callable
  from the front end. It is not, for that reason. It needs a server.
*/

window.BookingProvider = (function () {
  'use strict';

  /* The salon's inbox. One constant, used by the adapter and by the fallback
     link in the markup. */
  var INBOX = 'alabivof@gmail.com';

  /* Shown under the submit button so the visitor knows what pressing it does
     before they press it. Read by booking-ui.js. */
  var note = 'This sends your request to the salon by e-mail — they confirm '
           + 'the appointment. Nothing is charged and nothing is booked '
           + 'automatically.';

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) {
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function compose(b) {
    var lines = [
      'Appointment request via the website.',
      '',
      'Service   : ' + b.serviceName + ' (' + b.serviceNl + ')',
      'Price     : ' + b.price + ' euro',
      'Duration  : ' + b.minutes + ' minutes',
      'Stylist   : ' + b.staffName,
      'Date      : ' + b.dateLabel + ' (' + isoDate(b.date) + ')',
      'Time      : ' + b.time,
      '',
      'Name      : ' + b.name,
      'E-mail    : ' + b.email,
      'Phone     : ' + b.phone
    ];
    if (b.notes) lines.push('', 'Notes     : ' + b.notes);
    return lines.join('\n');
  }

  function submit(booking, form) {
    var subject = booking.shop + ' — ' + booking.serviceName + ', '
                + booking.dateLabel + ' ' + booking.time;
    var body = compose(booking);

    /* Replace the form with a plain confirmation rather than leaving a filled
       form on screen, which reads as "nothing happened". */
    var done = document.createElement('div');
    done.className = 'bdone';

    var h = document.createElement('p');
    h.className = 'bdone__h';
    h.textContent = 'REQUEST READY';
    done.appendChild(h);

    var p = document.createElement('p');
    p.className = 'bdone__p';
    p.textContent = 'Your mail app is opening with the request below already '
      + 'written. Send it and the salon will confirm.';
    done.appendChild(p);

    var pre = document.createElement('pre');
    pre.className = 'bdone__pre';
    pre.textContent = body;
    done.appendChild(pre);

    var a = document.createElement('a');
    a.className = 'bsubmit';
    a.href = 'mailto:' + INBOX
           + '?subject=' + encodeURIComponent(subject)
           + '&body=' + encodeURIComponent(body);
    a.textContent = 'OPEN MY MAIL APP';
    done.appendChild(a);

    var alt = document.createElement('p');
    alt.className = 'step__hint';
    alt.textContent = 'Or copy the text above and send it to ' + INBOX
      + ' — or just call the salon.';
    done.appendChild(alt);

    form.parentNode.replaceChild(done, form);
    done.scrollIntoView({ behavior: 'smooth', block: 'center' });

    /* Fire the mail client too, so the common case takes one click. */
    window.location.href = a.href;
  }

  return { submit: submit, note: note, inbox: INBOX };
})();
