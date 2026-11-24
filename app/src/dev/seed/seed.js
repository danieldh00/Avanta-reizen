// @ts-check
/**
 * Testdata voor de testomgeving (wachtlijstpunt W00): vult de database met verzonnen, maar realistische gegevens om het
 * CRM en de site mee te testen. Opdrachtregel: `dev/seed/cli.js`; de vaste inhoud staat in `dev/seed/data.js`.
 *
 * Wat erin komt: reistypes en landen, reisleiders, reizen (elk één vertrek met precies één reisleider; komende, net
 * geweeste, een volle, een bijna volle en een concept), personen met aanmeldingen in alle statussen, de verwachte
 * bedragen en betalingen (open, aanbetaald, betaald, achterstallig), toestemmingen, blog met categorieën en tags, FAQ,
 * pagina's en één CRM-gebruiker per rol.
 *
 * Veiligheid:
 * - `seedBlockReason` weigert zonder expliciete bevestiging, op het productiedomein en als zoekmachines de site mogen
 *   indexeren (dan is de site live). NODE_ENV zegt niets: de testomgeving draait het productie-image.
 * - Alles in één transactie: lukt iets niet, dan verandert er niets.
 * - Testdata is herkenbaar (`test-`-slugs, `@example.com`-adressen) en `removeSeed` verwijdert alleen dat.
 * - Persoonsgegevens gaan via `persons/persons.js` (dezelfde versleuteling per blok en toestemmingen als het formulier) en
 *   de verwachte bedragen via `payments/payments.js` (dezelfde regels als bij aanmelden).
 * - Uitvoer en audit bevatten alleen aantallen, nooit persoonsgegevens.
 *
 * De verzonnen gegevens zijn bij elke run gelijk (vaste startwaarde van de toevalsgenerator); alleen de datums schuiven
 * mee met vandaag.
 */
const { createPersons } = require('../../persons/persons');
const { addInitialCharges, addDays, localDay, summarize, termsFrom } = require('../../payments/payments');
const data = require('./data');
const { needsGuardian, FIELDS } = require('../../booking/fields');

/** Namen van de velden van de ouder of voogd (`booking/fields.js`). */
const GUARDIAN_FIELDS = FIELDS.filter((field) => field.guardian).map((field) => field.name);

/** Startwaarde van de toevalsgenerator: dezelfde testdata bij elke run. */
const RANDOM_SEED = 20261123;

/** LIKE-patronen waarmee de testdata te herkennen is (vaste tekst, geen invoer). */
const SLUG_PATTERN = `${data.SEED_SLUG_PREFIX}%`;
const PATH_PATTERN = `/${data.SEED_SLUG_PREFIX}%`;
const EMAIL_PATTERN = `%@${data.SEED_EMAIL_DOMAIN}`;

/** Het productiedomein: daar draait de testdata nooit, ook niet met bevestiging. */
const PRODUCTION_DOMAIN = 'avantareizen.nl';

/**
 * Een eenvoudige, voorspelbare toevalsgenerator (mulberry32), zodat de testdata bij elke run gelijk is.
 * @param {number} seed Startwaarde.
 * @returns {{next: Function, int: Function, pick: Function, chance: Function, hex: Function}} Hulpfuncties.
 */
function createRandom(seed) {
  let state = seed >>> 0;
  /**
   * Het volgende getal.
   * @returns {number} Getal in [0, 1).
   */
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /**
     * Een geheel getal tussen twee grenzen.
     * @param {number} min Kleinste waarde.
     * @param {number} max Grootste waarde (inclusief).
     * @returns {number} Getal.
     */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /**
     * Een willekeurig element.
     * @param {Array} list Lijst.
     * @returns {*} Element.
     */
    pick: (list) => list[Math.floor(next() * list.length)],
    /**
     * Waar met de gegeven kans.
     * @param {number} probability Kans tussen 0 en 1.
     * @returns {boolean} Uitkomst.
     */
    chance: (probability) => next() < probability,
    /**
     * Willekeurige hexadecimale tekens.
     * @param {number} length Aantal tekens.
     * @returns {string} Tekst.
     */
    hex: (length) => Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join(''),
  };
}

/**
 * Bepaalt of de testdata hier niet mag draaien.
 * @param {{siteUrl: string, indexing: boolean, confirmed: boolean}} context Het basisadres van de site (Beheer of
 *   SITE_URL), of zoekmachines mogen indexeren en of de opdracht expliciet bevestigd is (`--testomgeving`).
 * @returns {string} Reden om te weigeren; leeg als het mag.
 */
function seedBlockReason({ siteUrl, indexing, confirmed }) {
  if (!confirmed) return 'Geef --testomgeving mee om te bevestigen dat dit de testomgeving is.';
  let host;
  try {
    host = new URL(String(siteUrl || '')).hostname.toLowerCase();
  } catch {
    return 'Het basisadres van de site is niet ingesteld of ongeldig; testdata alleen met een herkenbaar testadres.';
  }
  if (host === PRODUCTION_DOMAIN || host.endsWith(`.${PRODUCTION_DOMAIN}`)) return `Dit is de productiesite (${host}); testdata is hier nooit toegestaan.`;
  if (indexing) return 'Zoekmachines mogen deze site indexeren (Beheer > Vindbaarheid): dan is de site live en komt er geen testdata.';
  return '';
}

/**
 * Zet tekst om naar een stukje e-mailadres: kleine letters, zonder accenten, spaties en tussenvoegsels samengevoegd.
 * @param {string} text Naam.
 * @returns {string} Bijvoorbeeld `vandenberg`.
 */
function emailPart(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Een tijdstip op een dag (tussen 08:00 en 20:59 UTC, dus dezelfde dag in Nederland).
 * @param {string} day Datum jjjj-mm-dd.
 * @param {ReturnType<typeof createRandom>} random Toevalsgenerator.
 * @returns {string} ISO-tijdstip.
 */
function momentOn(day, random) {
  return `${day}T${String(random.int(8, 20)).padStart(2, '0')}:${String(random.int(0, 59)).padStart(2, '0')}:00Z`;
}

/**
 * De vroegste van twee datums (jjjj-mm-dd).
 * @param {string} first Datum.
 * @param {string} second Datum.
 * @returns {string} De vroegste.
 */
function earliest(first, second) {
  return first < second ? first : second;
}

/**
 * Of er al testdata in de database staat.
 * @param {{query: Function}} client Database of transactie-client.
 * @returns {Promise<boolean>} Waar als er testreizen of testpersonen zijn.
 */
async function hasSeed(client) {
  const [row] = await client.query(
    `SELECT EXISTS (SELECT 1 FROM trips WHERE slug LIKE $1) OR EXISTS (SELECT 1 FROM persons WHERE email LIKE $2)
         OR EXISTS (SELECT 1 FROM users WHERE email LIKE $2) AS present`,
    [SLUG_PATTERN, EMAIL_PATTERN],
  );
  return row.present;
}

/**
 * Verwijdert alle testdata, en alleen die: aanmeldingen en personen met een `@example.com`-adres (bedragen,
 * betalingen, gebeurtenissen en toestemmingen gaan mee), testgebruikers, en inhoud met een `test-`-slug of -pad.
 * FAQ-categorieën van de testdata (naam eindigt op "(test)") verdwijnen alleen als er geen vragen meer in staan.
 * @param {{query: Function}} client Transactie-client.
 * @returns {Promise<Record<string, number>>} Aantal verwijderde rijen per soort.
 */
async function removeSeed(client) {
  const removed = {};
  /**
   * Voert één DELETE uit en onthoudt het aantal.
   * @param {string} label Soort.
   * @param {string} sql DELETE … RETURNING id.
   * @param {Array} params Parameters.
   * @returns {Promise<void>}
   */
  const remove = async (label, sql, params) => {
    removed[label] = (await client.query(sql, params)).length;
  };
  await remove('aanmeldingen', `DELETE FROM bookings WHERE email LIKE $1 OR person_id IN (SELECT id FROM persons WHERE email LIKE $1) RETURNING id`, [EMAIL_PATTERN]);
  await remove('personen', 'DELETE FROM persons WHERE email LIKE $1 RETURNING id', [EMAIL_PATTERN]);
  await remove('berichten', 'DELETE FROM contact_messages WHERE email LIKE $1 RETURNING id', [EMAIL_PATTERN]);
  await remove('gebruikers', 'DELETE FROM users WHERE email LIKE $1 RETURNING id', [EMAIL_PATTERN]);
  await remove('reizen', 'DELETE FROM trips WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove('reisleiders', 'DELETE FROM guides WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove('reistypes en landen', 'DELETE FROM trip_categories WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove('blogberichten', 'DELETE FROM posts WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove('blogcategorieën en tags', 'DELETE FROM post_terms WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove("pagina's", 'DELETE FROM pages WHERE path LIKE $1 RETURNING id', [PATH_PATTERN]);
  await remove('veelgestelde vragen', 'DELETE FROM faqs WHERE slug LIKE $1 RETURNING id', [SLUG_PATTERN]);
  await remove('FAQ-categorieën', `DELETE FROM faq_categories c WHERE lower(c.name) = ANY($1::text[])
      AND NOT EXISTS (SELECT 1 FROM faqs f WHERE f.category_id = c.id) RETURNING id`, [data.FAQ_CATEGORIES.map((category) => category.name.toLowerCase())]);
  return removed;
}

/**
 * Maakt het hulpmiddel dat de testdata schrijft.
 * @param {{vault: any, today: string, terms: {depositDays: number, balanceDaysBefore: number}}} options De kluis (voor
 *   de versleutelde blokken van personen), de datum van vandaag (jjjj-mm-dd, Nederland) en de betaaltermijnen uit Beheer.
 * @returns {{fill: Function}} Het hulpmiddel.
 */
function createSeeder({ vault, today, terms }) {
  const persons = createPersons({ vault });
  const random = createRandom(RANDOM_SEED);
  const slug = (key) => `${data.SEED_SLUG_PREFIX}${key}`;
  const email = (local) => `${local}@${data.SEED_EMAIL_DOMAIN}`;
  const blockId = () => `b${random.hex(12)}`;

  /**
   * Schrijft reistypes en landen.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<Map<string, number>>} Id per sleutel (`type:<key>` en `land:<key>`).
   */
  const insertCategories = async (client) => {
    const ids = new Map();
    const rows = [
      ...data.TRIP_TYPES.map((item, index) => ({ ...item, kind: 'type', ref: `type:${item.key}`, sortOrder: index + 1 })),
      ...data.COUNTRIES.map((item, index) => ({ ...item, kind: 'bestemming', icon: '', showOnHome: index < 6, ref: `land:${item.key}`, sortOrder: index + 1 })),
    ];
    for (const row of rows) {
      const [saved] = await client.query(
        `INSERT INTO trip_categories (slug, name, kind, icon, intro, body_html, sort_order, show_on_home)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [slug(row.key), row.name, row.kind, row.icon, row.intro, `<p>${row.intro}</p>`, row.sortOrder, row.showOnHome],
      );
      ids.set(row.ref, saved.id);
    }
    return ids;
  };

  /**
   * Schrijft de reisleiders (online, beheerd in het CRM).
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<Map<string, number>>} Id per sleutel.
   */
  const insertGuides = async (client) => {
    const ids = new Map();
    for (const [index, guide] of data.GUIDES.entries()) {
      const [saved] = await client.query(
        `INSERT INTO guides (slug, name, surname, city, since, quote, intro, body_html, published, managed_in_crm, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true, $9) RETURNING id`,
        [slug(guide.key), guide.name, guide.surname, guide.city, guide.since, guide.quote, guide.intro, `<p>${guide.intro}</p>`, index + 1],
      );
      ids.set(guide.key, saved.id);
    }
    return ids;
  };

  /**
   * Schrijft de reizen met hun reistype, land en precies één reisleider.
   * @param {{query: Function}} client Transactie-client.
   * @param {Map<string, number>} categoryIds Ids van reistypes en landen.
   * @param {Map<string, number>} guideIds Ids van reisleiders.
   * @returns {Promise<any[]>} De reizen met id en vertrekdatum.
   */
  const insertTrips = async (client, categoryIds, guideIds) => {
    const trips = [];
    for (const trip of data.TRIPS) {
      const departure = addDays(today, trip.departureInDays);
      // Eén aanbieding: het najaarsvertrek van de Ardèche met een oude prijs tot over drie weken.
      const offer = trip.key === 'ardeche-najaar' ? { oldPriceCents: 74900, offerUntil: addDays(today, 21) } : { oldPriceCents: null, offerUntil: null };
      const summary = `${trip.tagline}. Een reis van ${trip.days} dagen met een vaste reisleider en een groep van maximaal ${trip.capacity} deelnemers.`;
      const [saved] = await client.query(
        `INSERT INTO trips (slug, title, tagline, summary, body_html, trip_code, departure_date, duration_label, duration_days,
           price_cents, old_price_cents, offer_until, deposit_cents, guaranteed, is_new, capacity, published, managed_in_crm)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true) RETURNING id`,
        [slug(trip.key), trip.title, trip.tagline, summary, `<p>${summary}</p><p>Dit is een testreis; de inhoud is verzonnen.</p>`,
          trip.code, departure, `${trip.days} dagen`, trip.days, trip.priceEuros * 100, offer.oldPriceCents, offer.offerUntil,
          trip.depositEuros * 100, Boolean(trip.guaranteed), trip.isNew, trip.capacity, trip.published !== false],
      );
      await client.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2), ($1, $3)',
        [saved.id, categoryIds.get(`type:${trip.type}`), categoryIds.get(`land:${trip.country}`)]);
      await client.query('INSERT INTO trip_guides (trip_id, guide_id, sort_order) VALUES ($1, $2, 0)', [saved.id, guideIds.get(trip.guide)]);
      trips.push({ ...trip, id: saved.id, departure, priceCents: trip.priceEuros * 100, depositCents: trip.depositEuros * 100 });
    }
    return trips;
  };

  /**
   * Schrijft één CRM-gebruiker per rol, allemaal met hetzelfde (eenmalig getoonde) wachtwoord.
   * @param {{query: Function}} client Transactie-client.
   * @param {string} passwordHash Hash van het wachtwoord (`crm/passwords.js`).
   * @param {Map<string, number>} guideIds Ids van reisleiders (voor de gebruiker met de rol reisleider).
   * @returns {Promise<Map<string, number>>} Id per rol.
   */
  const insertUsers = async (client, passwordHash, guideIds) => {
    const ids = new Map();
    for (const user of data.USERS) {
      const [saved] = await client.query(
        'INSERT INTO users (email, name, role, password_hash, guide_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [email(user.email), user.name, user.role, passwordHash, user.guide ? guideIds.get(user.guide) : null],
      );
      ids.set(user.role, saved.id);
    }
    return ids;
  };

  /**
   * Verzint een reiziger met een leeftijd die bij de reis past, in de vorm van het aanmeldformulier.
   * @param {number} number Volgnummer (maakt het e-mailadres uniek).
   * @param {[number, number]} ages Leeftijd van en tot.
   * @param {string} departure Vertrekdatum (jjjj-mm-dd).
   * @returns {Record<string, string>} Formulierwaarden (`booking/fields.js`).
   */
  const inventTraveller = (number, ages, departure) => {
    const gender = random.chance(0.55) ? 'vrouw' : 'man';
    const callName = random.pick(data.FIRST_NAMES[gender]);
    const secondName = random.chance(0.6) ? ` ${random.pick(data.FIRST_NAMES[gender])}` : '';
    const lastName = random.pick(data.LAST_NAMES);
    const age = random.int(ages[0], ages[1]);
    const birthDate = addDays(`${Number(departure.slice(0, 4)) - age - 1}-${departure.slice(5)}`, random.int(1, 360));
    const place = random.pick(data.PLACES);
    const letters = 'ABCDEGHJKLMNPRSTVWXZ';
    const mobile = () => `06-99${String(random.int(0, 999999)).padStart(6, '0')}`;
    const church = random.chance(0.6) ? random.pick(data.CHURCHES) : '';
    const particulars = random.chance(0.18) ? random.pick(data.PARTICULARS) : '';
    const documentType = random.pick(['paspoort', 'paspoort', 'id-kaart', 'aanvragen']);
    const occupation = age < 18 ? 'scholier' : age < 23 ? 'student' : age > 67 ? 'gepensioneerd' : random.pick(data.OCCUPATIONS);
    return {
      gender,
      first_names: `${callName}${secondName}`,
      call_name: callName,
      last_name: lastName,
      birth_date: birthDate,
      mobile: mobile(),
      phone: random.chance(0.3) ? `0${random.int(30, 38)}-${random.int(1000000, 9999999)}` : '',
      email: email(`${emailPart(callName)}.${emailPart(lastName)}.${number}`),
      street: `${random.pick(data.STREETS)} ${random.int(1, 180)}`,
      postal_code: `${place.postcode + random.int(0, 8)} ${random.pick(letters.split(''))}${random.pick(letters.split(''))}`,
      city: place.city,
      occupation,
      church,
      consent_religion: church ? 'ja' : '',
      emergency_phone: mobile(),
      nationality: 'Nederlandse',
      document_type: documentType,
      document_number: documentType === 'aanvragen' ? '' : `TST${random.int(100000, 999999)}`,
      document_valid_until: documentType === 'aanvragen' ? '' : addDays(departure, random.int(200, 3000)),
      particulars,
      consent_health: particulars ? 'ja' : '',
    };
  };

  /**
   * Vult bij een deelnemer onder de 16 (op de dag van aanmelden) een verzonnen ouder in die toestemming geeft, zoals
   * het formulier eist; bij een oudere deelnemer gaan de oudervelden eruit.
   * @param {Record<string, string>} values Formulierwaarden van de reiziger.
   * @param {string} bookedOn Dag van aanmelden (jjjj-mm-dd).
   * @returns {Record<string, string>} Nieuwe waarden (het origineel blijft ongewijzigd).
   */
  const withGuardian = (values, bookedOn) => {
    const result = { ...values };
    for (const name of GUARDIAN_FIELDS) delete result[name];
    if (!needsGuardian(result, { today: bookedOn })) return result;
    const parentName = random.pick(data.FIRST_NAMES[random.chance(0.6) ? 'vrouw' : 'man']);
    return {
      ...result,
      guardian_name: `${parentName} ${values.last_name}`,
      guardian_relation: random.chance(0.95) ? 'ouder' : 'voogd',
      guardian_email: email(`${emailPart(parentName)}.${emailPart(values.last_name)}.ouder`),
      guardian_phone: `06-98${String(random.int(0, 999999)).padStart(6, '0')}`,
      consent_guardian: 'ja',
    };
  };

  /**
   * Kiest het verloop van een aanmelding: wanneer ze binnenkwam en welke status ze nu heeft.
   * @param {any} trip De reis (met `departure`).
   * @param {boolean} cancelled Of het een geannuleerde aanmelding is.
   * @returns {{createdOn: string, status: string}} Datum van aanmelden en status.
   */
  const plotBooking = (trip, cancelled) => {
    const past = trip.departure <= today;
    const latest = earliest(addDays(today, -1), addDays(trip.departure, -10));
    // Ongeveer één op de acht aanmeldingen voor een komende reis is van de afgelopen dagen (nog nieuw of net bevestigd).
    const recent = !past && !cancelled && random.chance(0.12);
    const createdOn = recent ? addDays(today, -random.int(0, 4)) : addDays(latest, -random.int(past ? 30 : 6, past ? 160 : 140));
    if (cancelled) return { createdOn, status: 'geannuleerd' };
    if (past) return { createdOn, status: 'betaald' };
    const ageInDays = Math.round((Date.parse(today) - Date.parse(createdOn)) / 86_400_000);
    if (ageInDays <= 5) return { createdOn, status: random.chance(0.7) ? 'nieuw' : 'bevestigd' };
    const restDue = addDays(trip.departure, -terms.balanceDaysBefore);
    const roll = random.next();
    // Na de vervaldatum van het restant betaalt bijna iedereen; een enkeling loopt achter (achterstand restant).
    if (today > restDue) return { createdOn, status: roll < 0.8 ? 'betaald' : 'aanbetaald' };
    if (roll < 0.15) return { createdOn, status: 'bevestigd' };
    if (roll < 0.65) return { createdOn, status: 'aanbetaald' };
    return { createdOn, status: 'betaald' };
  };

  /**
   * Schrijft de betalingen en de statusgeschiedenis van een aanmelding, passend bij de status: aanbetaald = de
   * vereiste aanbetaling binnen, betaald = alles binnen, bevestigd of nieuw = nog niets.
   * @param {{query: Function}} client Transactie-client.
   * @param {any} booking De aanmelding (`id`, `createdOn`, `status`, `paymentChoice`, `depositCents`).
   * @param {any} trip De reis.
   * @param {number} officeUserId Gebruiker van kantoor (bij gebeurtenissen en betalingen).
   * @returns {Promise<void>}
   */
  const insertHistory = async (client, booking, trip, officeUserId) => {
    const charges = await client.query('SELECT kind, amount_cents FROM booking_charges WHERE booking_id = $1', [booking.id]);
    const summary = summarize({
      booking: { created_at: `${booking.createdOn}T12:00:00Z`, payment_choice: booking.paymentChoice, departure_date: trip.departure, deposit_cents: booking.depositCents, status: booking.status },
      charges,
      payments: [],
      terms,
      today,
    });
    const events = [];
    const payments = [];
    const confirmedOn = earliest(today, addDays(booking.createdOn, random.int(0, 3)));
    if (booking.status !== 'nieuw') events.push({ from: 'nieuw', to: 'bevestigd', on: confirmedOn, note: random.pick(data.STATUS_NOTES.bevestigd) });
    if (booking.status === 'aanbetaald' || booking.status === 'betaald') {
      const firstOn = earliest(today, addDays(confirmedOn, random.int(1, 6)));
      const method = random.chance(0.3) ? 'ideal' : 'bank';
      if (booking.status === 'betaald' && booking.paymentChoice === 'totaal') {
        payments.push({ amount: summary.totalCents, on: firstOn, method });
      } else {
        payments.push({ amount: summary.depositRequiredCents, on: firstOn, method });
        events.push({ from: 'bevestigd', to: 'aanbetaald', on: firstOn, note: random.pick(data.STATUS_NOTES.aanbetaald) });
        if (booking.status === 'betaald' && summary.totalCents > summary.depositRequiredCents) {
          // Het restant komt binnen in de weken vóór de vervaldatum, nooit na vandaag en nooit vóór de aanbetaling.
          const restOn = earliest(today, addDays(addDays(trip.departure, -terms.balanceDaysBefore), -random.int(0, 20)));
          payments.push({ amount: summary.totalCents - summary.depositRequiredCents, on: restOn < firstOn ? firstOn : restOn, method: 'bank' });
        }
      }
      if (booking.status === 'betaald') events.push({ from: events.at(-1).to, to: 'betaald', on: payments.at(-1).on, note: random.pick(data.STATUS_NOTES.betaald) });
    }
    if (booking.status === 'geannuleerd') {
      const cancelledOn = earliest(today, addDays(confirmedOn, random.int(2, 20)));
      events.push({ from: 'bevestigd', to: 'geannuleerd', on: cancelledOn, note: booking.cancelReason });
    }
    for (const payment of payments) {
      await client.query(
        `INSERT INTO payments (booking_id, amount_cents, method, received_on, note, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [booking.id, payment.amount, payment.method, payment.on, payment.method === 'ideal' ? 'Betaald via iDEAL' : 'Overschrijving ontvangen', momentOn(payment.on, random), officeUserId],
      );
    }
    for (const event of events) {
      await client.query(
        'INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [booking.id, event.from, event.to, officeUserId, event.note, momentOn(event.on, random)],
      );
    }
    const last = events.at(-1);
    await client.query(
      `UPDATE bookings SET confirmed_at = $2, cancelled_at = $3, cancel_reason = $4, status_changed_at = $5 WHERE id = $1`,
      [booking.id, events.length ? momentOn(confirmedOn, random) : null, booking.status === 'geannuleerd' ? momentOn(last.on, random) : null,
        booking.status === 'geannuleerd' ? booking.cancelReason : '', last ? momentOn(last.on, random) : null],
    );
  };

  /**
   * Schrijft de aanmeldingen van alle reizen, met personen (via `persons/persons.js`), bedragen, betalingen,
   * gebeurtenissen en toestemmingen. Een deel van de reizigers gaat vaker mee (zelfde persoon, nieuwe aanmelding) en
   * één reiziger meldt zich aan met een andere geboortedatum (mogelijk dubbel, om samenvoegen te testen).
   * @param {{query: Function}} client Transactie-client.
   * @param {any[]} trips De reizen.
   * @param {number} officeUserId Gebruiker van kantoor.
   * @returns {Promise<{bookings: number, payments: number}>} Aantallen.
   */
  const insertBookings = async (client, trips, officeUserId) => {
    const travellers = [];
    let number = 0;
    let bookingCount = 0;
    let duplicateMade = false;
    for (const trip of trips) {
      const onThisTrip = new Set();
      const cancellations = trip.bookings >= 8 ? 1 : 0;
      for (let index = 0; index < trip.bookings + cancellations; index++) {
        const cancelled = index >= trip.bookings;
        // Vaste reizigers: ongeveer één op de zes komt terug, als de leeftijd past.
        const returning = travellers.filter((traveller) => !onThisTrip.has(traveller.email) && traveller.age >= trip.ages[0] && traveller.age <= trip.ages[1] + 2);
        let values;
        if (returning.length && random.chance(0.17)) {
          values = { ...random.pick(returning).values };
        } else {
          number += 1;
          values = inventTraveller(number, trip.ages, trip.departure);
          travellers.push({ email: values.email, age: Number(trip.departure.slice(0, 4)) - Number(values.birth_date.slice(0, 4)), values });
        }
        if (!duplicateMade && travellers.length > 20 && onThisTrip.size === 3) {
          // Zelfde e-mailadres, andere geboortedatum: het CRM toont dit als mogelijk dubbel.
          const original = travellers[2].values;
          if (!onThisTrip.has(original.email)) {
            values = { ...original, birth_date: addDays(original.birth_date, 1) };
            duplicateMade = true;
          }
        }
        onThisTrip.add(values.email);
        const plot = plotBooking(trip, cancelled);
        const paymentChoice = random.chance(0.15) ? 'totaal' : 'aanbetaling';
        // Wie het totaalbedrag kiest, betaalt in één keer: aanbetaald bestaat dan niet.
        if (paymentChoice === 'totaal' && plot.status === 'aanbetaald') plot.status = 'betaald';
        values.earlier_trip = travellers.filter((traveller) => traveller.email === values.email).length > 1 || random.chance(0.3) ? 'ja' : 'nee';
        values = withGuardian(values, plot.createdOn);
        const { personId } = await persons.savePerson(client, values);
        const createdAt = momentOn(plot.createdOn, random);
        const driver = Number(trip.departure.slice(0, 4)) - Number(values.birth_date.slice(0, 4)) >= 21 && random.chance(0.25);
        const [booking] = await client.query(
          `INSERT INTO bookings (reference, trip_id, trip_code, trip_title, departure_date, status, created_at, gender, first_names,
             call_name, last_name, email, mobile, phone, street, postal_code, city, occupation, travel_with, earlier_trip,
             credit_card, driver_interest, driver_before, driver_when, payment_method, payment_choice, price_cents, person_id,
             deposit_cents, consent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'handmatig',$25,$26,$27,$28,$7)
           RETURNING id`,
          [`AV-${plot.createdOn.slice(0, 4)}-${random.hex(8).toUpperCase()}`, trip.id, trip.code, trip.title, trip.departure, plot.status,
            createdAt, values.gender, values.first_names, values.call_name, values.last_name, values.email, values.mobile, values.phone,
            values.street, values.postal_code, values.city, values.occupation, random.chance(0.12) ? `${random.pick(data.FIRST_NAMES.vrouw)} ${random.pick(data.LAST_NAMES)}` : '',
            values.earlier_trip === 'ja', random.chance(0.6), driver, driver && random.chance(0.5), driver && random.chance(0.5) ? `${Number(today.slice(0, 4)) - random.int(1, 4)}` : '',
            paymentChoice, trip.priceCents, personId, trip.depositCents],
        );
        await addInitialCharges(client, booking.id, { priceCents: trip.priceCents, paymentChoice });
        await persons.recordConsents(client, { personId, bookingId: booking.id, values, givenAt: createdAt });
        await insertHistory(client, { id: booking.id, createdOn: plot.createdOn, status: plot.status, paymentChoice, depositCents: trip.depositCents, cancelReason: random.pick(data.CANCEL_REASONS) }, trip, officeUserId);
        bookingCount += 1;
      }
    }
    const [{ count }] = await client.query('SELECT count(*)::int AS count FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.email LIKE $1', [EMAIL_PATTERN]);
    return { bookings: bookingCount, payments: count };
  };

  /**
   * Schrijft blogcategorieën, tags en berichten (gepubliceerd, ingepland en concept).
   * @param {{query: Function}} client Transactie-client.
   * @param {number} editorUserId Gebruiker met de rol redacteur.
   * @returns {Promise<number>} Aantal berichten.
   */
  const insertPosts = async (client, editorUserId) => {
    const termIds = new Map();
    for (const [index, term] of data.POST_TERMS.entries()) {
      const [saved] = await client.query(
        'INSERT INTO post_terms (kind, slug, name, intro, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [term.kind, slug(term.key), term.name, term.intro || '', index + 1, editorUserId],
      );
      termIds.set(term.key, { id: saved.id, kind: term.kind, name: term.name });
    }
    for (const post of data.POSTS) {
      const blocks = [{ id: blockId(), type: 'tekst', data: { html: post.html }, style: {} }];
      const categories = post.terms.map((key) => termIds.get(key)).filter((term) => term.kind === 'categorie').map((term) => term.name);
      const [saved] = await client.query(
        `INSERT INTO posts (slug, title, intro, excerpt, blocks, categories, published, published_at, featured, managed_in_crm, updated_by)
         VALUES ($1, $2, $3, $3, $4, $5, $6, now() - make_interval(days => $7), $8, true, $9) RETURNING id`,
        [slug(post.key), post.title, post.intro, JSON.stringify(blocks), categories, post.published !== false, post.daysAgo, post.featured, editorUserId],
      );
      for (const key of post.terms) await client.query('INSERT INTO post_term_links (post_id, term_id) VALUES ($1, $2)', [saved.id, termIds.get(key).id]);
    }
    return data.POSTS.length;
  };

  /**
   * Schrijft de FAQ-categorieën (namen met "(test)") en -vragen. Staat een testcategorie er nog (met een echte vraag
   * erin, zie `removeSeed`), dan wordt die hergebruikt.
   * @param {{query: Function}} client Transactie-client.
   * @param {number} editorUserId Gebruiker met de rol redacteur.
   * @returns {Promise<number>} Aantal vragen.
   */
  const insertFaqs = async (client, editorUserId) => {
    let count = 0;
    for (const [categoryIndex, category] of data.FAQ_CATEGORIES.entries()) {
      await client.query('INSERT INTO faq_categories (name, sort_order, updated_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [category.name, categoryIndex + 1, editorUserId]);
      const [{ id: categoryId, name }] = await client.query('SELECT id, name FROM faq_categories WHERE lower(name) = lower($1)', [category.name]);
      for (const [index, question] of category.questions.entries()) {
        await client.query(
          `INSERT INTO faqs (slug, question, answer_html, category, category_id, sort_order, managed_in_crm, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
          [slug(question.key), question.question, question.answer, name, categoryId, index + 1, editorUserId],
        );
        count += 1;
      }
    }
    return count;
  };

  /**
   * Schrijft de pagina's in blokken (gepubliceerd).
   * @param {{query: Function}} client Transactie-client.
   * @param {number} editorUserId Gebruiker met de rol redacteur.
   * @returns {Promise<number>} Aantal pagina's.
   */
  const insertPages = async (client, editorUserId) => {
    for (const page of data.PAGES) {
      const blocks = page.blocks.map((block) => ({ id: blockId(), type: block.type, data: block.data, style: {} }));
      await client.query(
        `INSERT INTO pages (path, title, pretitle, intro, blocks, published, managed_in_crm, updated_by)
         VALUES ($1, $2, $3, $4, $5, true, true, $6)`,
        [`/${slug(page.key)}/`, page.title, page.pretitle, page.intro, JSON.stringify(blocks), editorUserId],
      );
    }
    return data.PAGES.length;
  };

  /**
   * Schrijft de berichten via het contactformulier; een afgehandeld bericht staat op naam van kantoor.
   * @param {{query: Function}} client Transactie-client.
   * @param {any[]} trips De testreizen (met sleutel).
   * @param {number} officeUserId Gebruiker met de rol kantoor.
   * @returns {Promise<number>} Aantal berichten.
   */
  const insertMessages = async (client, trips, officeUserId) => {
    for (const message of data.MESSAGES) {
      const createdAt = `${addDays(today, -message.daysAgo)}T09:30:00+01:00`;
      await client.query(
        `INSERT INTO contact_messages (name, email, phone, subject, message, trip_slug, consent_at, created_at, status, handled_at, handled_by, note)
         VALUES ($1, $2, '', $3, $4, $5, $6, $6, $7, $8, $9, $10)`,
        [message.name, `${emailPart(message.name)}@${data.SEED_EMAIL_DOMAIN}`, message.subject, message.message,
          message.trip === null ? null : slug(trips[message.trip % trips.length].key), createdAt,
          message.handled ? 'afgehandeld' : 'nieuw', message.handled ? createdAt : null, message.handled ? officeUserId : null, message.note || ''],
      );
    }
    return data.MESSAGES.length;
  };

  /**
   * Schrijft alle testdata (in de transactie van de aanroeper).
   * @param {{query: Function}} client Transactie-client.
   * @param {{passwordHash: string}} input Hash van het wachtwoord van de testgebruikers.
   * @returns {Promise<Record<string, number>>} Aantal per soort.
   */
  const fill = async (client, { passwordHash }) => {
    const categoryIds = await insertCategories(client);
    const guideIds = await insertGuides(client);
    const trips = await insertTrips(client, categoryIds, guideIds);
    const userIds = await insertUsers(client, passwordHash, guideIds);
    const { bookings, payments } = await insertBookings(client, trips, userIds.get('kantoor'));
    const [{ count: personCount }] = await client.query('SELECT count(*)::int AS count FROM persons WHERE email LIKE $1', [EMAIL_PATTERN]);
    return {
      'reistypes en landen': categoryIds.size,
      reisleiders: guideIds.size,
      reizen: trips.length,
      gebruikers: userIds.size,
      personen: personCount,
      aanmeldingen: bookings,
      betalingen: payments,
      blogberichten: await insertPosts(client, userIds.get('redacteur')),
      'veelgestelde vragen': await insertFaqs(client, userIds.get('redacteur')),
      "pagina's": await insertPages(client, userIds.get('redacteur')),
      berichten: await insertMessages(client, trips, userIds.get('kantoor')),
    };
  };

  return { fill };
}

/**
 * Voert een opdracht uit in één transactie, met een regel in het auditlog (alleen aantallen).
 * @param {{db: {transaction: Function}, vault: any, settings: {get: Function}, mode: ('vullen'|'opnieuw'|'verwijderen'),
 *   confirmed: boolean, passwordHash?: string, today?: string}} options De database, kluis, geladen instellingen, de
 *   opdracht, of `--testomgeving` is meegegeven, de hash van het wachtwoord voor de testgebruikers (niet bij
 *   verwijderen) en (voor tests) de datum van vandaag.
 * @returns {Promise<({ok: true, removed: Record<string, number>, added: Record<string, number>}|{ok: false, reason: string})>}
 *   De aantallen, of waarom er niets is gedaan.
 */
async function runSeed(options) {
  const { db, vault, settings, mode, confirmed, passwordHash } = options;
  const reason = seedBlockReason({ siteUrl: settings.get('siteUrl'), indexing: Boolean(settings.get('seoIndexing')), confirmed });
  if (reason) return { ok: false, reason };
  const today = options.today || localDay(new Date());
  return db.transaction(async (client) => {
    // Eén run tegelijk: een tweede wacht tot de eerste klaar is en ziet dan diens testdata.
    await client.query('SELECT pg_advisory_xact_lock(727099)');
    const present = await hasSeed(client);
    if (mode === 'vullen' && present) return { ok: false, reason: 'Er staat al testdata in de database. Gebruik "opnieuw" om die te vervangen of "verwijderen" om haar weg te halen.' };
    const removed = mode === 'vullen' ? {} : await removeSeed(client);
    const added = mode === 'verwijderen' ? {} : await createSeeder({ vault, today, terms: termsFrom(settings) }).fill(client, { passwordHash });
    await client.query(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix) VALUES (NULL, $1, 'testdata', NULL, NULL)",
      [`testdata.${mode}`],
    );
    return { ok: true, removed, added };
  });
}

module.exports = { runSeed, seedBlockReason, hasSeed, removeSeed, createSeeder, createRandom, emailPart, PRODUCTION_DOMAIN };
