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

  PRICES come from the owner's own price list (WhatsApp, 16 Jul), with the
  cutting prices later revised by the owner. Dutch kept in `nl` on every entry
  so nothing is lost in translation:

      Knippen v.a 35                Knippen + drogen 55
      Knippen + blowdry 65
      Half head highlights 70       Fullhead highlights 100
      Uitgroei 50                   Uitgroei + punten en lengtes 70
      Balayage va 160               Toner va 45
      Wassen 7.50                   Wassen blowdry va 40

  "v.a" / "va" is Dutch for "vanaf" — from. Those entries carry `from: true`
  and render as "from 35", not "35", because quoting a floor price as a fixed
  price is the kind of error that ends in an argument at the counter.

  ---------------------------------------------------------------------------
  THE PRICE LIST IS GENDERLESS, BY INSTRUCTION
  ---------------------------------------------------------------------------

  The written list split the cuts in two by gender and priced both at 45. The
  owner has replaced that with a single cut from 35: one list, priced by the
  length of the hair and the work it takes, not by who is sitting in the chair.

  Nothing on this site may reintroduce that split — not a label, not an `nl`
  string, not the e-mail the booking form composes, not a comment. There are
  three cutting entries now and none of them names a gender. A test greps the
  whole repository for those words and fails if any reappears.

  HOURS are the owner's: Monday to Friday 10:00-22:00, closed Saturday and
  Sunday, with a one-hour rest break in the middle of the day.

  STAFF: Labi and Donovan. Labi cuts, Donovan colours. Every colour service —
  both highlights, balayage, toner, and both regrowth services — is Donovan's.
  Labi does the cuts, the washes and the blow-dries. That is the whole split,
  and it is expressed once, on each service's `staff` list.

  COMBINATIONS. Services can be booked together. What cannot be combined is
  expressed by `group`: two services sharing a group are alternatives to one
  another and are mutually exclusive, services in different groups combine
  freely. So a cut and a colour and a wash go together, but a cut and a cut
  with a blow-dry do not — they are the same appointment priced two ways, and
  offering both at once would sell the cut twice.

      cut     the three cutting options
      colour  the five colour services — one colour process per visit
      wash    wash, or wash with a blow-dry
      toner   on its own, because a toner is a finishing step that genuinely
              sits on top of any of the above

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
    /* --- cutting: one list, no gender ------------------------------------ */
    {
      id: 'knippen',
      /* 45 minutes rather than the 30 the shorter of the two old entries
         carried. A genderless cut priced from 35 covers everything from a
         clipper cut to long layers, and the calendar has to reserve for the
         longer end - under-booking a chair overruns into the next client,
         over-booking it only leaves the stylist a gap. ASSUMPTION 2. */
      name: 'Cut',
      nl: 'Knippen',
      price: 35, from: true, minutes: 45,
      group: 'cut',
      staff: ['labi', 'donovan']
    },
    {
      id: 'knippen-drogen',
      name: 'Cut + dry',
      nl: 'Knippen + drogen',
      price: 55, from: false, minutes: 60,
      group: 'cut',
      staff: ['labi', 'donovan']
    },
    {
      id: 'knippen-blowdry',
      name: 'Cut + blow-dry',
      nl: 'Knippen + blowdry',
      price: 65, from: false, minutes: 60,
      group: 'cut',
      staff: ['labi', 'donovan']
    },

    /* --- colour: Donovan's, all of it ------------------------------------ */
    {
      id: 'half-head-highlights',
      name: 'Half-head highlights',
      nl: 'Half head highlights',
      price: 70, from: false, minutes: 90,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'full-head-highlights',
      name: 'Full-head highlights',
      nl: 'Fullhead highlights',
      price: 100, from: false, minutes: 120,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'balayage',
      name: 'Balayage',
      nl: 'Balayage',
      price: 160, from: true, minutes: 180,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'toner',
      name: 'Toner',
      nl: 'Toner',
      price: 45, from: true, minutes: 45,
      group: 'toner',
      staff: ['donovan']
    },
    {
      id: 'uitgroei',
      name: 'Regrowth colour',
      nl: 'Uitgroei',
      price: 50, from: false, minutes: 90,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'uitgroei-lengtes',
      name: 'Regrowth + ends and lengths',
      nl: 'Uitgroei + punten en lengtes',
      price: 70, from: false, minutes: 120,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'wassen',
      name: 'Wash',
      nl: 'Wassen',
      price: 7.5, from: false, minutes: 15,
      group: 'wash',
      staff: ['labi', 'donovan']
    },
    {
      id: 'wassen-blowdry',
      name: 'Wash + blow-dry',
      nl: 'Wassen blowdry',
      price: 40, from: true, minutes: 45,
      group: 'wash',
      staff: ['labi', 'donovan']
    }
  ]
};
