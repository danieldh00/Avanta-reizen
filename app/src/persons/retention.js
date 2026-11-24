/**
 * AVG-opschoning (OPZET-CRM §5): bewaartermijnen afdwingen. Elke dag (en met *Nu opschonen* in Beheer) wist de app:
 * - bijzondere en paspoortgegevens van een persoon zoveel maanden na de laatste reis (de geboortedatum blijft, die
 *   hoort bij het ontdubbelen);
 * - de persoon zelf (anonimiseren) en de persoonsvelden van de bijbehorende aanmeldingen na de bewaartermijn; de
 *   aanmeldingen blijven voor de boekhouding;
 * - geannuleerde aanmeldingen waarop nooit iets is betaald;
 * - geanonimiseerde aanmeldingen na de fiscale bewaartermijn, en personen zonder aanmeldingen die al anoniem zijn;
 * - reizigersaccounts die lang niet zijn gebruikt en oude berichten van het contactformulier.
 *
 * Elke ronde komt met aantallen in `retention_runs` (nooit welke persoon). Een persoon wordt in een eigen transactie
 * verwerkt, met de rij vergrendeld en de termijn opnieuw gecontroleerd, zodat een aanmelding die tegelijk binnenkomt
 * nooit gegevens kwijtraakt.
 */
const { BLOCKS } = require('./persons');

/** Naam van een geanonimiseerde persoon en aanmelding (op het scherm en in exports). */
const ANONYMIZED_NAME = '(verwijderd)';

/** Hoogstens zoveel records per regel per ronde; de rest volgt de volgende dag. */
const MAX_PER_RULE = 5000;

/** Zoveel ids per zoekopdracht. */
const BATCH_SIZE = 200;

/** Rondes in het overzicht van Beheer. */
const VIEW_RUNS = 30;

/** Eerste controle zoveel ms na het starten (na het omzetten van oude aanmeldingen). */
const FIRST_RUN_MS = 5 * 60 * 1000;

/** Daarna elk uur een controle of de dagelijkse ronde aan de beurt is. */
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Een dagelijkse ronde start pas als de vorige dagelijkse ronde zoveel uur geleden begon. Zo draait de opschoning één
 * keer per dag, ook als de app vaak herstart (bij elke update): eerder startte elke herstart een eigen ronde.
 */
const DAILY_GAP_HOURS = 23;

/** De onderdelen van een ronde, met de omschrijving voor het scherm. */
const COUNT_LABELS = {
  blokken: 'Bijzondere en paspoortgegevens gewist (personen)',
  personen: 'Personen geanonimiseerd',
  aanmeldingen: 'Aanmeldingen geanonimiseerd (zonder persoon)',
  geannuleerd: 'Geannuleerde aanmeldingen zonder betaling verwijderd',
  verlopen: 'Aanmeldingen na de fiscale termijn verwijderd',
  personenWeg: 'Geanonimiseerde personen zonder aanmeldingen verwijderd',
  accounts: 'Ongebruikte reizigersaccounts verwijderd',
  contact: 'Contactberichten verwijderd',
};

/** De datum van een tijdstip in Nederland (SQL). */
const localDate = (column) => `(${column} AT TIME ZONE 'Europe/Amsterdam')::date`;

/**
 * Einddatum van één aanmelding (SQL, met `b` = bookings en `t` = trips): bij een geannuleerde de dag van annuleren,
 * anders de laatste reisdag (vertrek + duur − 1, met de datum van de reis als die later is gewijzigd); zonder
 * vertrekdatum de dag van aanmelden.
 */
const BOOKING_END_SQL = `CASE WHEN b.status = 'geannuleerd'
    THEN ${localDate('coalesce(b.cancelled_at, b.status_changed_at, b.created_at)')}
    ELSE coalesce(coalesce(t.departure_date, b.departure_date) + (GREATEST(coalesce(t.duration_days, 1), 1) - 1), ${localDate('b.created_at')})
  END`;

/**
 * Personen met hun einddatum: de laatste reisdag van alle aanmeldingen, of de laatste activiteit als die later is.
 * Parameters: $4 = alleen deze persoon (of null), $5 = ids groter dan dit (cursor).
 * @param {string} where Extra voorwaarde op `p` (vaste tekst uit deze module).
 * @returns {string} SQL voor een CTE `ends (id, end_date)`.
 */
const personEnds = (where) => `ends AS (
  SELECT p.id, GREATEST(${localDate('p.last_activity_at')}, max(${BOOKING_END_SQL})) AS end_date
    FROM persons p
    LEFT JOIN bookings b ON b.person_id = p.id
    LEFT JOIN trips t ON t.id = b.trip_id
   WHERE p.anonymized_at IS NULL AND ($4::int IS NULL OR p.id = $4) AND p.id > $5 AND ${where}
   GROUP BY p.id)`;

/**
 * De zoekopdrachten per regel. Alle met dezelfde parameters: $1 = vandaag (jjjj-mm-dd, Nederland), $2 = termijn,
 * $3 = hoogstens zoveel, $4 = alleen dit id (of null), $5 = cursor (ids groter dan dit).
 */
const CANDIDATES = {
  // Een blok dat al is gewist, komt pas terug als de persoon daarna is gewijzigd (nieuwe aanmelding of kantoor).
  blokken: `WITH ${personEnds(`(p.blocks_purged_at IS NULL OR p.updated_at > p.blocks_purged_at)
      AND (p.identity_data IS NOT NULL OR p.special_data IS NOT NULL OR p.health_data IS NOT NULL OR p.emergency_data IS NOT NULL
        OR p.guardian_data IS NOT NULL)`)}
    SELECT id FROM ends WHERE end_date + make_interval(months => $2) < $1::date ORDER BY id LIMIT $3`,
  personen: `WITH ${personEnds('true')}
    SELECT id FROM ends WHERE end_date + make_interval(months => $2) < $1::date ORDER BY id LIMIT $3`,
  // Aanmeldingen zonder persoon (niet omgezet of de persoon is samengevoegd en weg): op hun eigen einddatum.
  aanmeldingen: `SELECT b.id FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id
     WHERE b.person_id IS NULL AND b.anonymized_at IS NULL AND ($4::int IS NULL OR b.id = $4) AND b.id > $5
       AND ${BOOKING_END_SQL} + make_interval(months => $2) < $1::date
     ORDER BY b.id LIMIT $3`,
  // Geannuleerd en nooit (aan)betaald: geen status aanbetaald/betaald gehad en geen enkele betaling geregistreerd
  // (ook niet een die met een correctie is teruggedraaid: die blijft voor de boekhouding).
  geannuleerd: `SELECT b.id FROM bookings b
     WHERE b.status = 'geannuleerd' AND ($4::int IS NULL OR b.id = $4) AND b.id > $5
       AND ${localDate('coalesce(b.cancelled_at, b.status_changed_at, b.created_at)')} + make_interval(months => $2) < $1::date
       AND NOT EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.to_status IN ('aanbetaald', 'betaald'))
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
     ORDER BY b.id LIMIT $3`,
  // Alleen al geanonimiseerde aanmeldingen: van een persoon die nog actief is blijft de aanmelding tot de anonimisering.
  // Dit is het einde van de fiscale bewaarplicht (retentionBookingYears, minimaal 7 jaar): de bedragen en betalingen
  // (booking_charges, payments) gaan dan bewust mee (ON DELETE CASCADE); daarvoor blijven ze altijd staan.
  verlopen: `SELECT b.id FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id
     WHERE b.anonymized_at IS NOT NULL AND ($4::int IS NULL OR b.id = $4) AND b.id > $5
       AND ${BOOKING_END_SQL} + make_interval(years => $2) < $1::date
     ORDER BY b.id LIMIT $3`,
};

/**
 * Wist de persoonsvelden van aanmeldingen, de notities in hun historie en de toelichtingen bij betalingen en bedragen
 * (die kunnen persoonsgegevens bevatten). Reis, bedragen, betalingen, status en tijdstippen blijven.
 * @param {{query: Function}} client Transactie-client.
 * @param {number[]} bookingIds Ids van de aanmeldingen.
 * @returns {Promise<number>} Aantal geanonimiseerde aanmeldingen.
 */
async function anonymizeBookings(client, bookingIds) {
  if (!bookingIds.length) return 0;
  const rows = await client.query(
    `UPDATE bookings SET gender = '', first_names = '', call_name = '', last_name = $2, email = '', mobile = '', phone = '',
       street = '', postal_code = '', city = '', occupation = '', travel_with = '', driver_when = '', cancel_reason = '',
       sensitive_data = NULL, customer_account_id = NULL, anonymized_at = coalesce(anonymized_at, now())
     WHERE id = ANY($1::int[]) RETURNING id`,
    [bookingIds, ANONYMIZED_NAME],
  );
  await client.query("UPDATE booking_events SET note = '' WHERE booking_id = ANY($1::int[]) AND note <> ''", [bookingIds]);
  // Toelichtingen bij betalingen en omschrijvingen bij bedragen kunnen namen bevatten; bedragen en datums blijven.
  await client.query("UPDATE payments SET note = '' WHERE booking_id = ANY($1::int[]) AND note <> ''", [bookingIds]);
  await client.query("UPDATE booking_charges SET description = '' WHERE booking_id = ANY($1::int[]) AND description <> ''", [bookingIds]);
  // Herinneringen bevatten nooit adres of inhoud; de foutmelding van de mailserver gaat voor de zekerheid toch weg.
  // Termijn, tijdstip en uitkomst blijven (horen bij de administratie van de aanmelding, die met de aanmelding vervalt).
  await client.query("UPDATE payment_reminders SET error = '' WHERE booking_id = ANY($1::int[]) AND error <> ''", [bookingIds]);
  return rows.length;
}

/**
 * Anonimiseert een persoon: naam, adres, contact en alle versleutelde blokken weg, een `match_key` die nergens meer op
 * past, geen markering als dubbel; de aanmeldingen van de persoon worden ook geanonimiseerd. Toestemmingen blijven
 * (zonder persoonsgegevens) als bewijs. Wordt ook gebruikt voor een verwijderverzoek. Vergrendel de persoon vooraf.
 * @param {{query: Function}} client Transactie-client.
 * @param {number} personId Id van de persoon.
 * @returns {Promise<{bookings: number}>} Aantal geanonimiseerde aanmeldingen.
 */
async function anonymizePerson(client, personId) {
  await client.query(
    `UPDATE persons SET gender = '', first_names = '', call_name = '', last_name = $2, email = '', mobile = '', phone = '',
       street = '', postal_code = '', city = '', occupation = '', match_key = 'verwijderd:' || id::text, identity_data = NULL,
       special_data = NULL, health_data = NULL, emergency_data = NULL, guardian_data = NULL, duplicate_of = NULL, blocks_purged_at = now(),
       anonymized_at = now(), updated_at = now()
     WHERE id = $1`,
    [personId, ANONYMIZED_NAME],
  );
  await client.query('UPDATE persons SET duplicate_of = NULL WHERE duplicate_of = $1', [personId]);
  const bookings = await client.query('SELECT id FROM bookings WHERE person_id = $1', [personId]);
  return { bookings: await anonymizeBookings(client, bookings.map((row) => row.id)) };
}

/**
 * Maakt de opschoning.
 * @param {{db: object, persons: object, settings: object, today?: () => string}} options Database, de personen
 *   (`persons/persons.js`, voor het openen van het identiteitsblok), de instellingen (termijnen) en (voor tests) de datum van vandaag.
 * @returns {object} `run`, `preview`, `view`, `refresh`, `tick` en `start`.
 */
function createRetention(options) {
  const { db, persons, settings } = options;
  const todayOf = options.today || (() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }));
  let runs = [];
  let running = false;

  /**
   * De termijnen uit de instellingen.
   * @returns {{blokken: number, personen: number, aanmeldingen: number, geannuleerd: number, verlopen: number, contact: number}} Termijnen.
   */
  const terms = () => ({
    blokken: settings.get('retentionSpecialMonths'),
    personen: settings.get('retentionPersonMonths'),
    aanmeldingen: settings.get('retentionPersonMonths'),
    geannuleerd: settings.get('retentionCancelledMonths'),
    verlopen: settings.get('retentionBookingYears'),
    contact: settings.get('retentionContactMonths'),
  });

  /**
   * Zoekt de volgende ids voor een regel.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {string} rule Naam van de regel (sleutel van CANDIDATES).
   * @param {{today: string, term: number, limit: number, onlyId?: number, afterId?: number}} params Parameters.
   * @returns {Promise<number[]>} Ids.
   */
  const candidates = async (client, rule, params) => (await client.query(
    CANDIDATES[rule],
    [params.today, params.term, params.limit, params.onlyId ?? null, params.afterId || 0],
  )).map((row) => row.id);

  /**
   * Verwerkt alle kandidaten van een regel, elk in een eigen transactie met de rij vergrendeld en opnieuw gecontroleerd.
   * @param {string} rule Naam van de regel.
   * @param {string} table Tabel om te vergrendelen (`persons` of `bookings`).
   * @param {{today: string, term: number}} params Datum en termijn.
   * @param {(client: object, id: number, row: object) => Promise<boolean>} handle Verwerkt één record; false = mislukt.
   * @returns {Promise<{done: number, failed: number}>} Aantallen.
   */
  const processRule = async (rule, table, params, handle) => {
    let done = 0;
    let failed = 0;
    let afterId = 0;
    while (done + failed < MAX_PER_RULE) {
      const ids = await candidates(db, rule, { ...params, limit: BATCH_SIZE, afterId });
      if (!ids.length) break;
      for (const id of ids) {
        afterId = id;
        try {
          const outcome = await db.transaction(async (client) => {
            // De tabelnaam komt uit deze module, nooit uit invoer.
            const [row] = await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
            if (!row) return 'weg';
            const [still] = await candidates(client, rule, { ...params, limit: 1, onlyId: id });
            if (!still) return 'weg';
            return (await handle(client, id)) ? 'ok' : 'mislukt';
          });
          if (outcome === 'ok') done++;
          if (outcome === 'mislukt') failed++;
        } catch (error) {
          console.error(`AVG-opschoning: ${rule} ${id} mislukt (${error.code || error.name})`);
          failed++;
        }
      }
    }
    return { done, failed };
  };

  /**
   * Wist de blokken van één persoon; van het identiteitsblok blijft alleen de geboortedatum. Is het identiteitsblok niet
   * te openen (andere hoofdsleutel), dan blijft het staan en telt de persoon als mislukt; de rest wordt wel gewist.
   * @param {{query: Function}} client Transactie-client.
   * @param {number} personId Id van de persoon.
   * @returns {Promise<boolean>} Waar als alles is gewist.
   */
  const purgeBlocks = async (client, personId) => {
    const person = await persons.findPerson(client, personId);
    for (const block of Object.keys(BLOCKS).filter((name) => name !== 'identity_data')) {
      if (person[block]) await persons.writeBlock(client, personId, block, {});
    }
    if (person.identity_data) {
      let identity;
      try {
        identity = persons.openBlock('identity_data', person);
      } catch {
        return false;
      }
      await persons.writeBlock(client, personId, 'identity_data', { birth_date: identity.birth_date || '' });
    }
    await client.query('UPDATE persons SET blocks_purged_at = now(), updated_at = now() WHERE id = $1', [personId]);
    return true;
  };

  /**
   * Eén ronde: alle regels na elkaar, met de aantallen in `retention_runs`.
   * @param {{trigger?: ('dagelijks'|'handmatig'), userId?: (number|null)}} [input] Wie of wat de ronde start.
   * @returns {Promise<({runId: number, counts: Record<string, number>, failed: number, error: string}|null)>} Id van de ronde en
   *   aantallen, of null als er al een ronde loopt.
   */
  const run = async (input = {}) => {
    if (running) return null;
    running = true;
    const today = todayOf();
    const term = terms();
    const counts = Object.fromEntries(Object.keys(COUNT_LABELS).map((key) => [key, 0]));
    let failed = 0;
    let errorText = '';
    const [record] = await db.query(
      'INSERT INTO retention_runs (trigger, user_id) VALUES ($1, $2) RETURNING id',
      [input.trigger === 'handmatig' ? 'handmatig' : 'dagelijks', input.userId || null],
    ).catch((error) => { running = false; throw error; });
    try {
      const add = (key, outcome) => { counts[key] += outcome.done; failed += outcome.failed; };
      add('blokken', await processRule('blokken', 'persons', { today, term: term.blokken }, purgeBlocks));
      add('personen', await processRule('personen', 'persons', { today, term: term.personen }, async (client, id) => {
        await anonymizePerson(client, id);
        return true;
      }));
      add('aanmeldingen', await processRule('aanmeldingen', 'bookings', { today, term: term.aanmeldingen }, async (client, id) => (await anonymizeBookings(client, [id])) === 1));
      add('geannuleerd', await processRule('geannuleerd', 'bookings', { today, term: term.geannuleerd }, async (client, id) => {
        await client.query('DELETE FROM bookings WHERE id = $1', [id]);
        return true;
      }));
      add('verlopen', await processRule('verlopen', 'bookings', { today, term: term.verlopen }, async (client, id) => {
        await client.query('DELETE FROM bookings WHERE id = $1', [id]);
        return true;
      }));
      // Al anoniem en geen aanmeldingen meer: niets meer om te bewaren (toestemmingen gaan mee via de foreign key).
      counts.personenWeg = (await db.query(
        `DELETE FROM persons p WHERE p.anonymized_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.person_id = p.id) RETURNING p.id`,
      )).length;
      const cutoff = `$1::date - make_interval(months => $2)`;
      counts.accounts = (await db.query(
        `DELETE FROM customer_accounts a
          WHERE coalesce(a.last_login_at, a.verified_at, a.created_at) < ${cutoff}
            AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_account_id = a.id AND b.created_at >= ${cutoff})
          RETURNING a.id`,
        [today, term.personen],
      )).length;
      counts.contact = (await db.query(`DELETE FROM contact_messages WHERE created_at < ${cutoff} RETURNING id`, [today, term.contact])).length;
      await db.query("DELETE FROM retention_runs WHERE started_at < now() - interval '24 months'");
    } catch (error) {
      // Alleen de soort fout: een melding kan waarden bevatten.
      errorText = String(error.code || error.name || 'fout').slice(0, 100);
      console.error(`AVG-opschoning mislukt (${errorText})`);
    } finally {
      await db.query(
        'UPDATE retention_runs SET finished_at = now(), counts = $2, failed = $3, error = $4 WHERE id = $1',
        [record.id, JSON.stringify(counts), failed, errorText],
      ).catch(() => {});
      running = false;
    }
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (total || failed) console.log(`AVG-opschoning: ${total} gewist of geanonimiseerd, ${failed} mislukt`);
    await refresh().catch(() => {});
    return { runId: record.id, counts, failed, error: errorText };
  };

  /**
   * Wat een ronde nu zou doen, zonder iets te wijzigen (alleen aantallen, hoogstens `MAX_PER_RULE` per regel).
   * @returns {Promise<Record<string, number>>} Aantallen per onderdeel.
   */
  const preview = async () => {
    const today = todayOf();
    const term = terms();
    const result = {};
    for (const rule of Object.keys(CANDIDATES)) {
      result[rule] = (await candidates(db, rule, { today, term: term[rule], limit: MAX_PER_RULE })).length;
    }
    const [row] = await db.query(
      `SELECT (SELECT count(*)::int FROM persons p WHERE p.anonymized_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.person_id = p.id)) AS personen_weg,
              (SELECT count(*)::int FROM customer_accounts a WHERE coalesce(a.last_login_at, a.verified_at, a.created_at) < $1::date - make_interval(months => $2)
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_account_id = a.id AND b.created_at >= $1::date - make_interval(months => $2))) AS accounts,
              (SELECT count(*)::int FROM contact_messages WHERE created_at < $1::date - make_interval(months => $3)) AS contact`,
      [today, term.personen, term.contact],
    );
    return { ...result, personenWeg: row.personen_weg, accounts: row.accounts, contact: row.contact };
  };

  /**
   * Leest de laatste rondes voor het overzicht in Beheer.
   * @returns {Promise<void>}
   */
  const refresh = async () => {
    runs = await db.query(
      `SELECT r.id, r.started_at, r.finished_at, r.trigger, r.counts, r.failed, r.error, u.name AS user_name
         FROM retention_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.started_at DESC, r.id DESC LIMIT $1`,
      [VIEW_RUNS],
    );
  };

  /**
   * De laatste rondes (uit het geheugen, bijgewerkt na elke ronde en bij het starten).
   * @returns {{runs: object[], running: boolean, enabled: boolean}} Stand.
   */
  const view = () => ({ runs, running, enabled: settings.get('retentionEnabled') });

  /**
   * Eén controle van de planner: start de dagelijkse ronde als de schakelaar aan staat, er geen ronde loopt en de
   * vorige dagelijkse ronde minstens `DAILY_GAP_HOURS` uur geleden begon (uit `retention_runs`, dus ook over een
   * herstart heen).
   * @returns {Promise<boolean>} Waar als er een ronde is gestart.
   */
  const tick = async () => {
    if (!settings.get('retentionEnabled') || running) return false;
    const [recent] = await db.query(
      "SELECT EXISTS (SELECT 1 FROM retention_runs WHERE trigger = 'dagelijks' AND started_at > now() - make_interval(hours => $1)) AS done",
      [DAILY_GAP_HOURS],
    );
    if (recent.done) return false;
    await run({ trigger: 'dagelijks' });
    return true;
  };

  /**
   * Start de planner: de eerste controle na vijf minuten, daarna elk uur; de ronde zelf draait hooguit één keer per dag.
   * @returns {NodeJS.Timeout[]} De timers (houden het proces niet open).
   */
  const start = () => {
    refresh().catch(() => {});
    const check = () => {
      tick().catch((error) => console.error(`AVG-opschoning mislukt (${error.code || error.name})`));
    };
    return [setTimeout(check, FIRST_RUN_MS).unref(), setInterval(check, INTERVAL_MS).unref()];
  };

  return { run, preview, view, refresh, tick, start };
}

module.exports = { createRetention, anonymizePerson, anonymizeBookings, ANONYMIZED_NAME, COUNT_LABELS, CANDIDATES, BOOKING_END_SQL };
