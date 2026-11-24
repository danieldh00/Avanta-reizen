// @ts-check
/**
 * Online betalen via Mollie (migratie 28), bovenop de handmatige registratie van betalingen. Elke aanmelding heeft
 * een vaste, niet te raden betaallink `/betalen/<id>-<token>/` (HMAC van het id met een sleutel uit de hoofdsleutel);
 * daar start de reiziger een betaling voor de openstaande termijn. Elke aangemaakte betaling staat in
 * `online_payments`; Mollie meldt een statuswijziging via de webhook met alleen het id, en de app vraagt de betaling
 * dan zelf op. Een geslaagde betaling komt één keer in `payments` (methode `ideal`, `provider_ref` = Mollie-id) en
 * schuift de status van de aanmelding door, zoals een handmatige betaling. Terugbetalingen en storno's verwerkt
 * kantoor met de hand (correctie). Nooit persoonsgegevens naar Mollie: alleen bedrag, referentie en reis.
 */
const crypto = require('node:crypto');
const payments = require('./payments');
const { PAYMENT_ID_PATTERN, MollieError } = require('./mollie');

/** Lengte van het token in de betaallink (base64url, 132 bits). */
const TOKEN_LENGTH = 22;

/** Zo lang (minuten) wordt een nog open betaalscherm hergebruikt in plaats van een nieuwe betaling (Mollie houdt een
 * open betaling minstens 15 minuten geldig). */
const REUSE_MINUTES = 15;

/** Zo lang (minuten) blokkeert een betaling die bij de bank in behandeling is een nieuwe betaling. */
const PENDING_BLOCK_MINUTES = 24 * 60;

/** Patroon van het deel `<id>-<token>` in de betaallink. */
const LINK_PATTERN = /^(\d{1,9})-([A-Za-z0-9_-]{22})$/;

/** Stand van een Mollie-betaling in gewone taal. */
const ONLINE_STATES = {
  open: 'Gestart',
  pending: 'In behandeling',
  authorized: 'Goedgekeurd',
  paid: 'Betaald',
  canceled: 'Afgebroken',
  expired: 'Verlopen',
  failed: 'Mislukt',
};

/**
 * Maakt de functies voor online betalen.
 * @param {{db: any, settings: any, mollie: any, masterKey: Buffer, previousKeys?: Buffer[], appLog?: any, now?: () => number}} options
 *   Database, instellingen, Mollie-koppeling, hoofdsleutel (plus vorige sleutels: betaallinks uit mails van vóór een
 *   sleutelrotatie blijven geldig), logboek en klok.
 * @returns {any} Functies.
 */
function createOnlinePayments(options) {
  const { db, settings, mollie } = options;
  const now = options.now || Date.now;
  /**
   * Sleutel voor de betaallinks, afgeleid van een hoofdsleutel.
   * @param {Buffer} masterKey Hoofdsleutel.
   * @returns {Buffer} HMAC-sleutel.
   */
  const linkKeyOf = (masterKey) => crypto.createHmac('sha256', masterKey).update('betaallink').digest();
  const linkKey = linkKeyOf(options.masterKey);
  /** Sleutels van vóór een rotatie: alleen om oude links te herkennen, nieuwe links gebruiken `linkKey`. */
  const previousLinkKeys = (options.previousKeys || []).map(linkKeyOf);
  const log = (message, details) => { if (options.appLog) options.appLog.warn('mollie', message, details); };

  /**
   * Het token van een betaallink met een bepaalde sleutel.
   * @param {Buffer} key HMAC-sleutel.
   * @param {number} bookingId Id.
   * @returns {string} Token.
   */
  const tokenWith = (key, bookingId) => crypto.createHmac('sha256', key).update(`aanmelding:${bookingId}`).digest('base64url').slice(0, TOKEN_LENGTH);

  /**
   * Het token van de betaallink van een aanmelding.
   * @param {number} bookingId Id.
   * @returns {string} Token.
   */
  const tokenFor = (bookingId) => tokenWith(linkKey, bookingId);

  /**
   * Het pad van de betaallink.
   * @param {number} bookingId Id.
   * @returns {string} Pad.
   */
  const pathFor = (bookingId) => `/betalen/${bookingId}-${tokenFor(bookingId)}/`;

  /**
   * Leest het id uit het deel `<id>-<token>` van de betaallink, met een vergelijking in constante tijd.
   * @param {string} value Deel van het pad.
   * @returns {(number|null)} Id, of null bij een ongeldige link.
   */
  const bookingIdFrom = (value) => {
    const match = LINK_PATTERN.exec(String(value || ''));
    if (!match) return null;
    const bookingId = Number(match[1]);
    const given = Buffer.from(match[2]);
    // Alle sleutels nalopen (niet stoppen bij de eerste treffer), zodat de duur niet verraadt welke sleutel past.
    let valid = false;
    for (const key of [linkKey, ...previousLinkKeys]) {
      const expected = Buffer.from(tokenWith(key, bookingId));
      if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) valid = true;
    }
    return valid ? bookingId : null;
  };

  /**
   * Het basisadres van de site als het https is (Mollie stuurt de reiziger terug en roept de webhook aan), anders leeg.
   * @returns {string} Adres zonder / aan het eind.
   */
  const baseUrl = () => {
    const value = String(settings.get('siteUrl') || '').replace(/\/+$/, '');
    return /^https:\/\/[^\s/?#]+$/.test(value) ? value : '';
  };

  /**
   * Of online betalen bruikbaar is: aan, geldige sleutel en een https-basisadres.
   * @returns {boolean} Waar als bruikbaar.
   */
  const enabled = () => mollie.enabled() && Boolean(baseUrl());

  /**
   * De volledige betaallink van een aanmelding, of leeg als online betalen niet bruikbaar is.
   * @param {number} bookingId Id.
   * @returns {string} Adres.
   */
  const linkFor = (bookingId) => (enabled() ? `${baseUrl()}${pathFor(bookingId)}` : '');

  /**
   * Leest een aanmelding met haar stand.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {number} bookingId Id.
   * @param {boolean} [lock] De aanmelding vergrendelen.
   * @returns {Promise<(any|null)>} `{booking, summary, kind, amountCents}` of null.
   */
  const loadState = async (client, bookingId, lock = false) => {
    const [booking] = await client.query(
      `SELECT id, reference, trip_title, departure_date, status, created_at, payment_choice, deposit_cents, anonymized_at
         FROM bookings WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [bookingId],
    );
    if (!booking) return null;
    const summary = payments.summarize({ booking, ...(await payments.loadLines(client, booking.id)), terms: payments.termsFrom(settings), today: payments.localDay(now()) });
    // Eerst de te late termijn, anders de aanbetaling zolang die openstaat, anders het restant.
    const kind = summary.overdue || (summary.depositOpenCents > 0 ? 'aanbetaling' : (summary.balanceCents > 0 ? 'restant' : ''));
    const amountCents = kind === 'aanbetaling' ? summary.depositOpenCents : (kind === 'restant' ? summary.balanceCents : 0);
    return { booking, summary, kind, amountCents };
  };

  /**
   * Of een aanmelding online kan betalen (niet geannuleerd of geanonimiseerd, en er staat iets open).
   * @param {any} state Uitkomst van `loadState`.
   * @returns {(''|'geannuleerd'|'niets-open')} Leeg als het kan, anders de reden.
   */
  const blockedReason = (state) => {
    if (state.booking.status === 'geannuleerd' || state.booking.anonymized_at) return 'geannuleerd';
    return state.amountCents > 0 ? '' : 'niets-open';
  };

  /**
   * Start een betaling voor de openstaande termijn.
   * @param {number} bookingId Id.
   * @returns {Promise<{status: string, checkoutUrl?: string}>} `ok` met het adres van het betaalscherm (een nog open
   *   betaling van de laatste minuten wordt hergebruikt), of `uit`, `weg`, `geannuleerd`, `niets-open`, `bezig` (een
   *   betaling is bij de bank in behandeling) of `mislukt`.
   */
  const start = async (bookingId) => {
    if (!enabled()) return { status: 'uit' };
    // Alles onder het slot van de aanmelding: twee tabbladen of een dubbelklik leveren nooit twee betalingen op.
    return db.transaction(async (client) => {
      const state = await loadState(client, bookingId, true);
      if (!state) return { status: 'weg' };
      const blocked = blockedReason(state);
      if (blocked) return { status: blocked };
      const { booking, kind, amountCents } = state;
      const clock = new Date(now()).toISOString();
      // Een betaling die bij de bank in behandeling is (tot een dag oud, zodat een verloren webhook de aanmelding niet
      // voorgoed vastzet): niet nog een starten.
      const [pending] = await client.query(
        `SELECT 1 AS hit FROM online_payments WHERE booking_id = $1 AND status IN ('pending', 'authorized')
            AND created_at > $2::timestamptz - make_interval(mins => $3)`,
        [booking.id, clock, PENDING_BLOCK_MINUTES],
      );
      if (pending) return { status: 'bezig' };
      // Nog een open betaalscherm van de laatste minuten voor dezelfde termijn en hetzelfde bedrag: dat hergebruiken.
      const [open] = await client.query(
        `SELECT checkout_url FROM online_payments WHERE booking_id = $1 AND status = 'open' AND kind = $2 AND amount_cents = $3
            AND checkout_url <> '' AND created_at > $4::timestamptz - make_interval(mins => $5)
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [booking.id, kind, amountCents, clock, REUSE_MINUTES],
      );
      if (open) return { status: 'ok', checkoutUrl: open.checkout_url };
      const path = pathFor(booking.id);
      let created;
      try {
        created = await mollie.createPayment({
          amountCents,
          description: `${booking.reference} ${kind} ${booking.trip_title}`,
          redirectUrl: `${baseUrl()}${path}klaar/`,
          webhookUrl: `${baseUrl()}/betalen/webhook/`,
          metadata: { bookingId: booking.id, kind },
        });
      } catch (error) {
        log(`Betaling starten mislukt (${error instanceof MollieError ? error.code : 'onbekend'})`, { bookingId: booking.id });
        return { status: 'mislukt' };
      }
      try {
        await client.query(
          'INSERT INTO online_payments (booking_id, provider_ref, kind, amount_cents, checkout_url, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
          [booking.id, created.id, kind, amountCents, created.checkoutUrl, clock],
        );
      } catch (error) {
        // Bij Mollie bestaat de betaling al: met het id is hij met de hand terug te vinden als hij toch wordt betaald.
        log(`Betaling ${created.id} aangemaakt maar niet opgeslagen; controleer in Mollie`, { bookingId: booking.id });
        throw error;
      }
      return { status: 'ok', checkoutUrl: created.checkoutUrl };
    });
  };

  /**
   * Verwerkt de actuele stand van een betaling (na de webhook of bij terugkomst van de reiziger): werkt de regel bij
   * en registreert een geslaagde betaling één keer, onder slot van de aanmelding.
   * @param {string} providerRef Mollie-id.
   * @returns {Promise<{status: string, state?: string, newStatus?: (string|null)}>} `ok` (met de Mollie-stand en
   *   eventueel de nieuwe status van de aanmelding), `onbekend`, `afwijkend` of `mislukt`.
   */
  const refresh = async (providerRef) => {
    if (!PAYMENT_ID_PATTERN.test(String(providerRef))) return { status: 'onbekend' };
    const [row] = await db.query('SELECT id, booking_id, amount_cents FROM online_payments WHERE provider_ref = $1', [providerRef]);
    if (!row) return { status: 'onbekend' };
    let remote;
    try {
      remote = await mollie.getPayment(providerRef);
    } catch (error) {
      log(`Betaling opvragen mislukt (${error instanceof MollieError ? error.code : 'onbekend'})`, { bookingId: row.booking_id });
      return { status: 'mislukt' };
    }
    // Alleen vertrouwen wat bij onze eigen regel past: zelfde id, aanmelding en bedrag.
    if (remote.id !== providerRef || Number(remote.metadata.bookingId) !== row.booking_id || remote.amountCents !== row.amount_cents) {
      log('Betaling wijkt af van wat de site heeft aangemaakt; niet geregistreerd', { bookingId: row.booking_id });
      return { status: 'afwijkend' };
    }
    const state = Object.hasOwn(ONLINE_STATES, remote.status) ? remote.status : 'open';
    return db.transaction(async (client) => {
      const current = await loadState(client, row.booking_id, true);
      const paidAt = state === 'paid' ? (remote.paidAt || new Date(now()).toISOString()) : null;
      await client.query(
        // Een bereikte betaalde stand nooit terugzetten met een ouder antwoord (webhook en terugkeerpagina tegelijk).
        "UPDATE online_payments SET status = $2, paid_at = coalesce(paid_at, $3::timestamptz), updated_at = $4 WHERE id = $1 AND status <> 'paid'",
        [row.id, state, paidAt, new Date(now()).toISOString()],
      );
      if (state !== 'paid' || !current) return { status: 'ok', state, newStatus: null };
      const [inserted] = await client.query(
        `INSERT INTO payments (booking_id, amount_cents, method, received_on, note, provider_ref)
         VALUES ($1, $2, 'ideal', $3, $4, $5) ON CONFLICT (provider_ref) DO NOTHING RETURNING id`,
        [row.booking_id, row.amount_cents, payments.localDay(paidAt), 'Online betaald via Mollie', providerRef],
      );
      if (!inserted) return { status: 'ok', state, newStatus: null };
      const { booking } = current;
      const summary = payments.summarize({ booking, ...(await payments.loadLines(client, booking.id)), terms: payments.termsFrom(settings), today: payments.localDay(now()) });
      const to = payments.nextBookingStatus(booking.status, summary.state);
      if (to) {
        await client.query('UPDATE bookings SET status = $2, status_changed_at = now() WHERE id = $1', [booking.id, to]);
        await client.query(
          'INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, $2, $3, NULL, $4)',
          [booking.id, booking.status, to, `Automatisch na een online betaling van ${payments.formatAmount(row.amount_cents)}.`],
        );
      }
      return { status: 'ok', state, newStatus: to || null };
    });
  };

  /**
   * De online betalingen van een aanmelding, nieuwste eerst.
   * @param {number} bookingId Id.
   * @returns {Promise<any[]>} Regels.
   */
  const list = (bookingId) => db.query(
    'SELECT provider_ref, kind, amount_cents, status, created_at, paid_at FROM online_payments WHERE booking_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50',
    [bookingId],
  );

  /**
   * De laatste online betaling van een aanmelding (voor de terugkeerpagina).
   * @param {number} bookingId Id.
   * @returns {Promise<(any|null)>} Regel of null.
   */
  const latest = async (bookingId) => {
    const [row] = await db.query('SELECT provider_ref, status FROM online_payments WHERE booking_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [bookingId]);
    return row || null;
  };

  return { enabled, linkFor, pathFor, bookingIdFrom, loadState, blockedReason, start, refresh, list, latest };
}

module.exports = { createOnlinePayments, ONLINE_STATES, LINK_PATTERN, TOKEN_LENGTH };
