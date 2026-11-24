// @ts-check
/**
 * De infobrief aan de deelnemers van een vertrek (migratie 32): opstellen als concept, de ontvangers bepalen, in de
 * wachtrij zetten en het verzendoverzicht lezen. Alleen de logica en de queries; de schermen staan in
 * `infobrief-routes.js`, het versturen in de achtergrond in `sender.js`.
 *
 * Ontvangers zijn de aanmeldingen van de reis die niet geannuleerd en niet geanonimiseerd zijn (status *nieuw* alleen
 * als kantoor dat aanvinkt: zo'n adres heeft nog niemand gecontroleerd), plus de ouder of voogd als die bij de
 * deelnemer is vastgelegd (deelnemers onder de 16, blok `guardian_data`). Het e-mailadres komt van de persoon, anders
 * van het formulier; de ouder uit het versleutelde blok. Adressen worden nooit opgeslagen of getoond in het overzicht:
 * de wachtrij bevat alleen aanmelding en rol. Hetzelfde adres krijgt de brief één keer.
 */
const { validEmail } = require('../mail/mailer');
const { renderMail } = require('../mail/layout');
const { mailHtmlFromRichText, plainTextFromRichText } = require('../mail/rich-text');
const { normalizeSiteUrl } = require('../site/seo');
const { sanitizeHtml, plainText } = require('../../tools/import/sanitize');
const { formatDate } = require('../site/format');

/** Status van een infobrief. */
const STATUSES = { concept: 'Concept', verzenden: 'Wordt verzonden', verzonden: 'Verzonden' };

/** Status van een ontvanger. */
const RECIPIENT_STATUSES = {
  wachtrij: 'In de wachtrij',
  bezig: 'Bezig',
  verzonden: 'Verzonden',
  mislukt: 'Mislukt',
  overgeslagen: 'Overgeslagen',
  onzeker: 'Niet zeker verzonden',
};

/** Rol van een ontvanger. */
const ROLE_LABELS = { deelnemer: 'Deelnemer', ouder_voogd: 'Ouder of voogd' };

/** Hoogste lengte van onderwerp en tekst (tekens). */
const LIMITS = { subject: 200, body: 100_000 };

/** Hoogstens zoveel aanmeldingen per vertrek (een vertrek heeft er veel minder; dit begrenst ontsleutelen en geheugen). */
const MAX_BOOKINGS = 1000;

/** Hoogstens zoveel infobrieven per pagina van het overzicht. */
const PAGE_SIZE = 50;

/** Hoogstens zoveel reizen in de keuzelijst voor een nieuwe infobrief. */
const MAX_TRIPS = 300;

/** Velden van de aanmelding en de persoon die het opzoeken van een ontvanger nodig heeft (persoon gaat voor formulier). */
const RECIPIENT_COLUMNS = `b.id AS booking_id, b.status AS booking_status, b.anonymized_at, b.person_id,
  coalesce(nullif(p.call_name, ''), nullif(b.call_name, ''), nullif(p.first_names, ''), b.first_names) AS call_name,
  trim(concat_ws(' ', coalesce(nullif(p.call_name, ''), nullif(b.call_name, ''), nullif(p.first_names, ''), b.first_names), coalesce(nullif(p.last_name, ''), b.last_name))) AS display_name,
  coalesce(nullif(p.email, ''), b.email) AS email, p.guardian_data`;

/**
 * Leest en controleert het formulier van een concept. De tekst wordt opgeschoond met de allowlist van de site.
 * @param {Record<string, any>} body Formulier (`req.body`).
 * @returns {{values: {subject: string, bodyHtml: string, includeNew: boolean, includeGuardians: boolean}, errors: Record<string, string>}}
 *   Waarden en foutmeldingen per veld.
 */
function parseInput(body) {
  const subject = String(body.onderwerp ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const rawBody = String(body.tekst ?? '');
  const errors = {};
  if (subject.length > LIMITS.subject) errors.onderwerp = `Het onderwerp mag hoogstens ${LIMITS.subject} tekens hebben.`;
  if (rawBody.length > LIMITS.body) errors.tekst = `De tekst mag hoogstens ${LIMITS.body.toLocaleString('nl-NL')} tekens hebben.`;
  return {
    values: {
      subject: errors.onderwerp ? subject.slice(0, LIMITS.subject) : subject,
      bodyHtml: errors.tekst ? '' : sanitizeHtml(rawBody),
      includeNew: body.nieuw === 'ja',
      includeGuardians: body.ouders === 'ja',
    },
    errors,
  };
}

/**
 * Of een concept compleet genoeg is om te versturen.
 * @param {{subject: string, body_html: string}} infobrief De infobrief.
 * @returns {string} Foutmelding, of leeg als hij verstuurd kan worden.
 */
function readyToSend(infobrief) {
  if (!infobrief.subject.trim()) return 'Geef de infobrief eerst een onderwerp.';
  if (!plainText(infobrief.body_html) && !/<img\s/.test(infobrief.body_html)) return 'De infobrief heeft nog geen tekst.';
  return '';
}

/**
 * De reizen waarvoor een nieuwe infobrief kan worden gemaakt: met minstens één aanmelding die niet geannuleerd is,
 * eerst de komende vertrekken (vroegste eerst), dan de vertrekken van de laatste twee maanden.
 * @param {{query: Function}} db Database.
 * @returns {Promise<Array<{id: number, title: string, trip_code: string, departure_date: any, participant_count: number}>>} Reizen.
 */
async function listTrips(db) {
  return db.query(
    `SELECT t.id, t.title, t.trip_code, t.departure_date, count(b.id)::int AS participant_count
       FROM trips t JOIN bookings b ON b.trip_id = t.id AND b.status <> 'geannuleerd' AND b.anonymized_at IS NULL
      WHERE t.departure_date IS NULL OR t.departure_date >= (now() AT TIME ZONE 'Europe/Amsterdam')::date - 60
      GROUP BY t.id
      ORDER BY (t.departure_date IS NULL OR t.departure_date < (now() AT TIME ZONE 'Europe/Amsterdam')::date), t.departure_date ASC, t.id
      LIMIT $1`,
    [MAX_TRIPS],
  );
}

/**
 * Een pagina infobrieven, nieuwste eerst, eventueel van één reis, met de tellingen van het versturen.
 * @param {{query: Function}} db Database.
 * @param {{tripId?: (number|null), page?: number}} filter Reis en paginanummer (vanaf 1).
 * @returns {Promise<{rows: any[], hasNext: boolean}>} Regels en of er een volgende pagina is.
 */
async function listInfobrieven(db, filter) {
  const page = Math.max(1, filter.page || 1);
  const rows = await db.query(
    `SELECT i.id, i.subject, i.status, i.updated_at, i.send_started_at, i.send_finished_at, t.id AS trip_id, t.title AS trip_title,
            t.trip_code, t.departure_date, u.name AS sent_by_name,
            (SELECT count(*) FROM infobrief_recipients r WHERE r.infobrief_id = i.id AND r.status = 'verzonden')::int AS sent_count,
            (SELECT count(*) FROM infobrief_recipients r WHERE r.infobrief_id = i.id AND r.status IN ('mislukt', 'onzeker'))::int AS failed_count
       FROM infobrieven i JOIN trips t ON t.id = i.trip_id LEFT JOIN users u ON u.id = i.sent_by
      WHERE ($1::int IS NULL OR i.trip_id = $1)
      ORDER BY i.id DESC
      LIMIT $2 OFFSET $3`,
    [filter.tripId ?? null, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
  );
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

/**
 * Leest één infobrief met de reis en de namen van de medewerkers.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {number} id Id.
 * @param {{lock?: boolean}} [options] De infobrief vergrendelen (binnen een transactie).
 * @returns {Promise<any>} Infobrief of null.
 */
async function findInfobrief(client, id, options = {}) {
  const [row] = await client.query(
    `SELECT i.id, i.trip_id, i.subject, i.body_html, i.include_new, i.include_guardians, i.status, i.created_at, i.updated_at,
            i.send_started_at, i.send_finished_at, t.title AS trip_title, t.trip_code, t.departure_date,
            cu.name AS created_by_name, uu.name AS updated_by_name, su.name AS sent_by_name
       FROM infobrieven i JOIN trips t ON t.id = i.trip_id
       LEFT JOIN users cu ON cu.id = i.created_by LEFT JOIN users uu ON uu.id = i.updated_by LEFT JOIN users su ON su.id = i.sent_by
      WHERE i.id = $1${options.lock ? ' FOR UPDATE OF i' : ''}`,
    [id],
  );
  return row || null;
}

/**
 * Maakt een leeg concept voor een reis.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {{tripId: number, userId: number}} input Reis en medewerker.
 * @returns {Promise<(number|null)>} Id van het concept, of null als de reis niet bestaat.
 */
async function createInfobrief(client, input) {
  const [row] = await client.query(
    `INSERT INTO infobrieven (trip_id, created_by, updated_by)
     SELECT t.id, $2, $2 FROM trips t WHERE t.id = $1 RETURNING id`,
    [input.tripId, input.userId],
  );
  return row ? row.id : null;
}

/**
 * Slaat een concept op. Alleen een concept verandert: na het versturen ligt de inhoud vast.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {number} id Id.
 * @param {{subject: string, bodyHtml: string, includeNew: boolean, includeGuardians: boolean}} values Waarden uit `parseInput`.
 * @param {number} userId Medewerker.
 * @returns {Promise<boolean>} Waar als het concept is opgeslagen.
 */
async function updateInfobrief(client, id, values, userId) {
  const rows = await client.query(
    `UPDATE infobrieven SET subject = $2, body_html = $3, include_new = $4, include_guardians = $5, updated_by = $6, updated_at = now()
      WHERE id = $1 AND status = 'concept' RETURNING id`,
    [id, values.subject, values.bodyHtml, values.includeNew, values.includeGuardians, userId],
  );
  return rows.length > 0;
}

/**
 * Verwijdert een concept (een verstuurde infobrief blijft altijd bewaard, met zijn verzendoverzicht).
 * @param {{query: Function}} client Database of transactie-client.
 * @param {number} id Id.
 * @returns {Promise<boolean>} Waar als het concept is verwijderd.
 */
async function deleteInfobrief(client, id) {
  const rows = await client.query("DELETE FROM infobrieven WHERE id = $1 AND status = 'concept' RETURNING id", [id]);
  return rows.length > 0;
}

/**
 * Het e-mailadres van de ouder of voogd uit het versleutelde blok van de persoon.
 * @param {{openBlock: Function}} persons Personen (`persons/persons.js`).
 * @param {{person_id: (number|null), guardian_data: (string|null)}} row Rij met persoon en blok.
 * @returns {{email: string, unreadable: boolean}} Adres (leeg als er geen ouder is) en of het blok niet te openen was.
 */
function guardianAddress(persons, row) {
  if (!row.person_id || !row.guardian_data) return { email: '', unreadable: false };
  try {
    const data = persons.openBlock('guardian_data', { id: row.person_id, guardian_data: row.guardian_data });
    return { email: String((data && data.guardian_email) || '').trim(), unreadable: false };
  } catch {
    // Alleen het id in het log, nooit inhoud.
    console.error(`infobrief: blok guardian_data van persoon ${row.person_id} niet te openen`);
    return { email: '', unreadable: true };
  }
}

/**
 * Bepaalt de ontvangers van een infobrief zoals ze nu zijn: per aanmelding de deelnemer en (als dat aan staat en er een
 * is) de ouder of voogd, met wie wordt overgeslagen en waarom. Hetzelfde adres (ook deelnemer en ouder) telt één keer.
 * De adressen blijven in het geheugen en gaan niet mee naar buiten.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {{trip_id: number, include_new: boolean, include_guardians: boolean}} infobrief De infobrief.
 * @param {{openBlock: Function}} persons Personen (`persons/persons.js`).
 * @returns {Promise<{list: Array<{bookingId: number, role: string, name: string, status: string, note: string}>, tooMany: boolean}>}
 *   Ontvangers op naam, en of het vertrek meer dan `MAX_BOOKINGS` aanmeldingen heeft (dan wordt er niet verstuurd:
 *   liever weigeren dan stil afkappen).
 */
async function recipientCandidates(client, infobrief, persons) {
  const rows = await client.query(
    `SELECT ${RECIPIENT_COLUMNS}
       FROM bookings b LEFT JOIN persons p ON p.id = b.person_id
      WHERE b.trip_id = $1 AND b.status <> 'geannuleerd' AND b.anonymized_at IS NULL AND ($2::boolean OR b.status <> 'nieuw')
      ORDER BY lower(coalesce(nullif(p.last_name, ''), b.last_name)), lower(coalesce(nullif(p.first_names, ''), b.first_names)), b.id
      LIMIT $3`,
    [infobrief.trip_id, infobrief.include_new, MAX_BOOKINGS + 1],
  );
  if (rows.length > MAX_BOOKINGS) return { list: [], tooMany: true };
  const seen = new Set();
  const list = [];
  /**
   * Voegt een ontvanger toe; een ontbrekend, ongeldig of al gezien adres wordt overgeslagen met de reden.
   * @param {number} bookingId Aanmelding.
   * @param {string} role Rol.
   * @param {string} name Naam voor het overzicht.
   * @param {string} email Adres (alleen in het geheugen).
   * @param {string} [missing] Reden als er geen adres is.
   * @returns {void}
   */
  const add = (bookingId, role, name, email, missing = 'geen e-mailadres') => {
    const key = email.trim().toLowerCase();
    let note = '';
    if (!key) note = missing;
    else if (!validEmail(email)) note = 'geen geldig e-mailadres';
    else if (seen.has(key)) note = 'zelfde e-mailadres als een andere ontvanger';
    if (!note) seen.add(key);
    list.push({ bookingId, role, name, status: note ? 'overgeslagen' : 'wachtrij', note });
  };
  for (const row of rows) {
    add(row.booking_id, 'deelnemer', row.display_name, String(row.email || ''));
    if (infobrief.include_guardians && row.guardian_data) {
      const guardian = guardianAddress(persons, row);
      add(row.booking_id, 'ouder_voogd', `Ouder of voogd van ${row.display_name}`, guardian.email, guardian.unreadable ? 'gegevens van de ouder niet te openen' : 'geen e-mailadres');
    }
  }
  return { list, tooMany: false };
}

/**
 * Telt de ontvangers per rol en hoeveel er worden overgeslagen.
 * @param {Array<{role: string, status: string}>} list Uitkomst van `recipientCandidates`.
 * @returns {{total: number, participants: number, guardians: number, skipped: number}} Aantallen; `total` = wie de brief krijgt.
 */
function countCandidates(list) {
  const sending = list.filter((item) => item.status === 'wachtrij');
  return {
    total: sending.length,
    participants: sending.filter((item) => item.role === 'deelnemer').length,
    guardians: sending.filter((item) => item.role === 'ouder_voogd').length,
    skipped: list.length - sending.length,
  };
}

/**
 * Zet een concept in de wachtrij: schrijft de ontvangers weg (zonder adressen) en zet de status op *verzenden*. Moet
 * binnen een transactie draaien met de infobrief vergrendeld (`findInfobrief` met `lock`); de unieke sleutel op
 * ontvanger en de statuscontrole maken dubbel versturen onmogelijk.
 * @param {{query: Function}} client Transactie-client.
 * @param {number} id Id van de infobrief.
 * @param {Array<{bookingId: number, role: string, status: string, note: string}>} list Ontvangers.
 * @param {number} userId Wie verstuurt.
 * @returns {Promise<boolean>} Waar als de infobrief in de wachtrij staat; onwaar als hij geen concept meer was.
 */
async function queueInfobrief(client, id, list, userId) {
  const updated = await client.query(
    "UPDATE infobrieven SET status = 'verzenden', sent_by = $2, send_started_at = now(), send_finished_at = NULL WHERE id = $1 AND status = 'concept' RETURNING id",
    [id, userId],
  );
  if (!updated.length) return false;
  if (list.length) {
    await client.query(
      `INSERT INTO infobrief_recipients (infobrief_id, booking_id, role, status, note)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::text[]), unnest($5::text[])`,
      [id, list.map((item) => item.bookingId), list.map((item) => item.role), list.map((item) => item.status), list.map((item) => item.note)],
    );
  }
  // Zonder iemand in de wachtrij is hij meteen klaar.
  await client.query(
    `UPDATE infobrieven SET status = 'verzonden', send_finished_at = now()
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM infobrief_recipients r WHERE r.infobrief_id = $1 AND r.status IN ('wachtrij', 'bezig'))`,
    [id],
  );
  return true;
}

/**
 * Zet de mislukte ontvangers van een verstuurde infobrief opnieuw in de wachtrij (niet de onzekere: die zijn misschien
 * wel aangekomen).
 * @param {{query: Function}} client Transactie-client.
 * @param {number} id Id van de infobrief.
 * @returns {Promise<number>} Aantal ontvangers dat opnieuw in de wachtrij staat.
 */
async function retryFailed(client, id) {
  const rows = await client.query(
    "UPDATE infobrief_recipients SET status = 'wachtrij', note = '', updated_at = now() WHERE infobrief_id = $1 AND status = 'mislukt' RETURNING id",
    [id],
  );
  if (rows.length) {
    await client.query("UPDATE infobrieven SET status = 'verzenden', send_finished_at = NULL WHERE id = $1 AND status <> 'concept'", [id]);
  }
  return rows.length;
}

/**
 * Het verzendoverzicht: elke ontvanger met naam, rol, status, opmerking en tijdstip, en de tellingen per status.
 * Zonder adressen.
 * @param {{query: Function}} db Database.
 * @param {number} id Id van de infobrief.
 * @returns {Promise<{rows: any[], counts: Record<string, number>}>} Regels (op naam) en aantallen per status.
 */
async function recipientOverview(db, id) {
  const rows = await db.query(
    `SELECT r.id, r.role, r.status, r.note, r.sent_at, r.updated_at, b.id AS booking_id, b.reference, b.anonymized_at,
            trim(concat_ws(' ', coalesce(nullif(p.call_name, ''), nullif(b.call_name, ''), nullif(p.first_names, ''), b.first_names), coalesce(nullif(p.last_name, ''), b.last_name))) AS display_name
       FROM infobrief_recipients r LEFT JOIN bookings b ON b.id = r.booking_id LEFT JOIN persons p ON p.id = b.person_id
      WHERE r.infobrief_id = $1
      ORDER BY lower(coalesce(nullif(p.last_name, ''), b.last_name, '')), lower(coalesce(nullif(p.first_names, ''), b.first_names, '')), r.booking_id, r.role`,
    [id],
  );
  const counts = Object.fromEntries(Object.keys(RECIPIENT_STATUSES).map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return { rows, counts };
}

/**
 * De naam van een ontvanger in het overzicht.
 * @param {{role: string, display_name: (string|null), booking_id: (number|null), anonymized_at: any}} row Regel uit `recipientOverview`.
 * @returns {string} Naam.
 */
function recipientName(row) {
  if (!row.booking_id) return '(aanmelding verwijderd)';
  if (row.anonymized_at) return '(gegevens gewist)';
  return row.role === 'ouder_voogd' ? `Ouder of voogd van ${row.display_name}` : String(row.display_name || '');
}

/**
 * Bouwt de mail van een infobrief voor één ontvanger: aanhef (deelnemer bij roepnaam, ouder of voogd met de naam van
 * de deelnemer), de reis, de opgemaakte tekst en de vaste opmaak van de app.
 * @param {{infobrief: {subject: string, body_html: string, trip_title: string, trip_code?: string, departure_date?: any}, recipient: {role: string, callName: string, test?: boolean}, settings: {get: (key: string) => any}}} input
 *   Infobrief (met reis), ontvanger en instellingen (opmaak en basisadres).
 * @returns {{subject: string, html: string, text: string, attachments: any[]}} Onderwerp en de gerenderde mail.
 */
function buildMail(input) {
  const { infobrief, recipient, settings } = input;
  const siteUrl = normalizeSiteUrl(settings.get('siteUrl'));
  const richHtml = mailHtmlFromRichText(infobrief.body_html, siteUrl);
  const greeting = recipient.role === 'ouder_voogd'
    ? `Beste ouder of voogd,\n\nU ontvangt deze infobrief als ouder of voogd van ${recipient.callName}, die meegaat met ${infobrief.trip_title}.`
    : `Beste ${recipient.callName},`;
  const departure = formatDate(infobrief.departure_date);
  const rendered = renderMail({
    headerColor: settings.get('mailHeaderColor'),
    footerText: settings.get('mailFooterText'),
    siteName: settings.get('siteName'),
    title: infobrief.subject,
    intro: greeting,
    rows: [['Reis', infobrief.trip_title], ['Vertrek', departure]],
    richHtml,
    richText: plainTextFromRichText(richHtml),
  });
  return { subject: `${recipient.test ? '[Test] ' : ''}${infobrief.subject}`, ...rendered };
}

module.exports = {
  STATUSES, RECIPIENT_STATUSES, ROLE_LABELS, LIMITS, MAX_BOOKINGS, PAGE_SIZE, RECIPIENT_COLUMNS,
  parseInput, readyToSend, listTrips, listInfobrieven, findInfobrief, createInfobrief, updateInfobrief, deleteInfobrief,
  guardianAddress, recipientCandidates, countCandidates, queueInfobrief, retryFailed, recipientOverview, recipientName, buildMail,
};
