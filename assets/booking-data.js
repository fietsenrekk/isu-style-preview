/*
  JILL SCUTT — booking data
  =========================

  The single source of truth for opening hours, staff and the price list.
  Nothing else in the site hard-codes any of these values: the contact page's
  hours table, the booking page's service list and the slot calculator all read
  from here, so they cannot drift apart. Edit this file and the whole site
  follows.

  ---------------------------------------------------------------------------
  PROVENANCE — read before changing anything
  ---------------------------------------------------------------------------

  PRICES are transcribed from the owner's own price list (WhatsApp, 16 Jul).
  Transcribed verbatim, Dutch original kept in `nl` on every entry so nothing
  is lost in translation:

      Heren knippen v.a 45          Dames knippen 45
      Dames knippen drogen 55       Dames knippen blowdry 65
      Half head highlights 70       Fullhead highlights 100
      Uitgroei 50                   Uitgroei + punten en lengtes 70
      Balayage va 160               Toner va 45
      Wassen 7.50                   Wassen blowdry va 40

  "v.a" / "va" is Dutch for "vanaf" — from. Those four carry `from: true` and
  render as "from 45", not "45", because quoting a floor price as a fixed price
  is the kind of error that ends in an argument at the counter.

  HOURS are the owner's: Monday to Friday 10:00-22:00, closed Saturday and
  Sunday, with a one-hour rest break in the middle of the day.

  STAFF: Labi and Donovan. The owner's instruction was that "Labi does
  everything on the list except highlights, balayage and toner", so those four
  line items (half-head and full-head highlights are two entries of the one
  "highlights" exclusion) are Donovan-only. Every other service is done by both.

  ---------------------------------------------------------------------------
  ASSUMPTIONS — these were NOT supplied and are guesses. Change them freely.
  ---------------------------------------------------------------------------

  1. BREAK WINDOW. "A one-hour rest break in the middle of the day" fixes the
     length but not the hour. 14:00-15:00 is used here. The exact midpoint of a
     10-22 day would be 16:00, which is not what most people mean by "midday",
     so this leans to the lunch reading. One line to change: `hours.break`.

  2. DURATIONS. No durations were given, and the slot calculator cannot run
     without them — a booking has to occupy a length of time. The values below
     are ordinary salon timings for each service. They decide how many slots a
     day holds and when the last bookable start is, so they are worth a look
     from the owner before this goes live.

  3. LEAD TIME. Same-day bookings are cut off 60 minutes ahead, so nobody books
     a slot that starts before they can arrive.

  All three are constants at the top of their sections, not scattered through
  the code.
*/

window.SHOP = {

  name: 'JILL SCUTT',

  /* ---------------------------------------------------------------- hours -- */

  hours: {
    /* 1 = Monday ... 5 = Friday. Saturday (6) and Sunday (0) are absent, which
       is what makes them closed — there is no second "closed" list to keep in
       sync with this one. */
    openDays: [1, 2, 3, 4, 5],

    open:  '10:00',
    close: '22:00',

    /* ASSUMPTION 1 — see the header. */
    break: { start: '14:00', end: '15:00' },

    /* Booking grid granularity, and how far ahead a same-day booking must be. */
    slotStepMinutes: 15,
    leadTimeMinutes: 60,

    /* Rendered on the contact section. Derived from openDays/open/close above
       rather than written out by hand, so it cannot contradict them. */
    dayLabels: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  },

  /* ---------------------------------------------------------------- staff -- */

  staff: [
    {
      id: 'labi',
      name: 'LABI',
      role: 'Hair stylist'
    },
    {
      id: 'donovan',
      name: 'DONOVAN',
      role: 'Partner — colour'
    }
  ],

  /* ------------------------------------------------------------- services -- */

  /*
    `staff` on each service is the whole exclusion mechanism. The booking page
    reads it in both directions — pick a stylist and the services they do not
    offer go dead; pick a service and the stylists who do not offer it go dead —
    so there is one list to maintain, not two rules that can disagree.

    `from: true` means the price is a floor ("vanaf"), not a fixed amount.
    `minutes` is ASSUMPTION 2 — see the header.
  */

  services: [
    {
      id: 'heren-knippen',
      name: "Men's cut",
      nl: 'Heren knippen',
      price: 45, from: true, minutes: 30,
      staff: ['labi', 'donovan']
    },
    {
      id: 'dames-knippen',
      name: "Women's cut",
      nl: 'Dames knippen',
      price: 45, from: false, minutes: 45,
      staff: ['labi', 'donovan']
    },
    {
      id: 'dames-knippen-drogen',
      name: "Women's cut + dry",
      nl: 'Dames knippen drogen',
      price: 55, from: false, minutes: 60,
      staff: ['labi', 'donovan']
    },
    {
      id: 'dames-knippen-blowdry',
      name: "Women's cut + blow-dry",
      nl: 'Dames knippen blowdry',
      price: 65, from: false, minutes: 60,
      staff: ['labi', 'donovan']
    },

    /* --- the four Donovan-only entries ----------------------------------- */
    {
      id: 'half-head-highlights',
      name: 'Half-head highlights',
      nl: 'Half head highlights',
      price: 70, from: false, minutes: 90,
      staff: ['donovan']
    },
    {
      id: 'full-head-highlights',
      name: 'Full-head highlights',
      nl: 'Fullhead highlights',
      price: 100, from: false, minutes: 120,
      staff: ['donovan']
    },
    {
      id: 'balayage',
      name: 'Balayage',
      nl: 'Balayage',
      price: 160, from: true, minutes: 180,
      staff: ['donovan']
    },
    {
      id: 'toner',
      name: 'Toner',
      nl: 'Toner',
      price: 45, from: true, minutes: 45,
      staff: ['donovan']
    },
    /* --------------------------------------------------------------------- */

    {
      id: 'uitgroei',
      name: 'Regrowth colour',
      nl: 'Uitgroei',
      price: 50, from: false, minutes: 90,
      staff: ['labi', 'donovan']
    },
    {
      id: 'uitgroei-lengtes',
      name: 'Regrowth + ends and lengths',
      nl: 'Uitgroei + punten en lengtes',
      price: 70, from: false, minutes: 120,
      staff: ['labi', 'donovan']
    },
    {
      id: 'wassen',
      name: 'Wash',
      nl: 'Wassen',
      price: 7.5, from: false, minutes: 15,
      staff: ['labi', 'donovan']
    },
    {
      id: 'wassen-blowdry',
      name: 'Wash + blow-dry',
      nl: 'Wassen blowdry',
      price: 40, from: true, minutes: 45,
      staff: ['labi', 'donovan']
    }
  ]
};
