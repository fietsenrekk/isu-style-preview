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

  PRICES are the owner's current list, given as:

      Cuts from 35        Highlights from 60      Balayage from 160
      Wash 7,50           Toner from 45           Blow dry from 35
      Roots from 50       Colour from 50

  Eight services. Everything but the wash is a floor price — "from" — and is
  rendered that way, never as a fixed amount, because quoting a floor as a
  fixed price is the kind of error that ends in an argument at the counter.

  Two notes on how that list is written out below. The owner's list is in no
  particular order; here it is grouped so the three services both stylists
  offer sit together at the top, the four colour processes follow, and the
  toner closes. And "Color" is spelled "Colour", matching the rest of the site.
  Neither changes a price or a name in substance.

  ---------------------------------------------------------------------------
  THE PRICE LIST IS GENDERLESS, BY INSTRUCTION
  ---------------------------------------------------------------------------

  One cutting entry, from 35, priced by the length of the hair and the work it
  takes rather than by who is sitting in the chair.

  Nothing on this site may reintroduce a gendered split — not a label, not an
  `nl` string, not the e-mail the booking form composes, not a comment.
  tools/booking-test.mjs greps every shipped file for those words and fails if
  any reappears; tools/verify.mjs checks the rendered page, including the title
  attributes that explain a disabled row, where such a word could hide without
  ever being visible.

  ---------------------------------------------------------------------------
  HOURS
  ---------------------------------------------------------------------------

  Monday to Friday 10:00-22:00, closed Saturday and Sunday, with a one-hour
  rest break in the middle of the day.

  ---------------------------------------------------------------------------
  STAFF
  ---------------------------------------------------------------------------

  Donovan does everything. Labi does the three services that need no colour:
  cutting, washing and blow-drying. That is the whole split and it is expressed
  once, on each service's `staff` list, which both directions of the exclusion
  read from — so the two can never disagree.

  ---------------------------------------------------------------------------
  COMBINATIONS
  ---------------------------------------------------------------------------

  Services can be booked together — a cut, a colour, a wash and a blow-dry are
  one visit. What cannot be combined is expressed by `group`: two services
  sharing a group are alternatives to one another and exclude each other,
  services in different groups combine freely.

      colour   highlights, balayage, roots, colour — one colour process per
               visit; they are four ways of colouring the same head, not four
               things to have done to it in one sitting
      cut      the cut
      blowdry  the blow-dry
      wash     the wash
      toner    on its own, because a toner is a finishing step that genuinely
               sits on top of any of the above

  A group with one member excludes nothing, which is the point: a cut, a wash
  and a blow-dry are independent and all three can be booked at once.

  ---------------------------------------------------------------------------
  ASSUMPTIONS — these were NOT supplied and are guesses. Change them freely.
  ---------------------------------------------------------------------------

  1. BREAK WINDOW. "A one-hour rest break in the middle of the day" fixes the
     length but not the hour. 14:00-15:00 is used here. The exact midpoint of a
     10-22 day would be 16:00, which is not what most people mean by "midday",
     so this leans to the lunch reading. One line to change: `hours.break`.

  2. DURATIONS. No durations were given, and the slot calculator cannot run
     without them — a booking has to occupy a length of time. The values below
     are ordinary salon timings. They decide how many slots a day holds and
     when the last bookable start is, so they are worth a look from the owner
     before this goes live. Where a price is a floor, the duration is set for
     the longer end of what that floor covers: under-booking a chair overruns
     into the next client, over-booking it only leaves the stylist a gap.

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

  /* Both are hairstylists. What separates them is the service list, not the
     title, so the titles read the same. */
  staff: [
    {
      id: 'labi',
      name: 'LABI',
      role: 'Hairstylist'
    },
    {
      id: 'donovan',
      name: 'DONOVAN',
      role: 'Hairstylist'
    }
  ],

  /* ------------------------------------------------------------- services -- */

  /*
    `staff` drives the exclusion in both directions: pick a stylist and what
    they do not offer goes dead, pick a service and the stylists who do not
    offer it go dead. `group` drives the exclusion between services.

    `from: true` means the price is a floor, not a fixed amount.
    `minutes` is ASSUMPTION 2 — see the header.
  */

  services: [

    /* --- the three that need no colour: both stylists --------------------- */
    {
      id: 'knippen',
      name: 'Cuts',
      nl: 'Knippen',
      price: 35, from: true, minutes: 45,
      group: 'cut',
      staff: ['labi', 'donovan']
    },
    {
      id: 'blowdry',
      name: 'Blow dry',
      nl: 'Blowdrogen',
      price: 35, from: true, minutes: 45,
      group: 'blowdry',
      staff: ['labi', 'donovan']
    },
    {
      id: 'wassen',
      name: 'Wash',
      nl: 'Wassen',
      price: 7.5, from: false, minutes: 15,
      group: 'wash',
      staff: ['labi', 'donovan']
    },

    /* --- colour: Donovan's, and one process per visit --------------------- */
    {
      id: 'highlights',
      name: 'Highlights',
      nl: 'Highlights',
      price: 60, from: true, minutes: 90,
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
      id: 'roots',
      name: 'Roots',
      nl: 'Uitgroei',
      price: 50, from: true, minutes: 90,
      group: 'colour',
      staff: ['donovan']
    },
    {
      id: 'kleuring',
      name: 'Colour',
      nl: 'Kleuring',
      price: 50, from: true, minutes: 120,
      group: 'colour',
      staff: ['donovan']
    },

    /* --- the finishing step, which sits on top of anything ---------------- */
    {
      id: 'toner',
      name: 'Toner',
      nl: 'Toner',
      price: 45, from: true, minutes: 45,
      group: 'toner',
      staff: ['donovan']
    }
  ]
};
