/**
 * Deelnemerslijst per vertrek als Excel-bestand (.xlsx, nooit CSV; zie `docs/OPZET-CRM.md` §2E en §4). Eén rij per
 * aanmelding die niet geannuleerd is, met de actuele gegevens van de persoon (of de momentopname van het formulier als
 * er nog geen persoon aan hangt). Bijzondere en identiteitsgegevens gaan alleen mee als de gebruiker ze per categorie
 * aanvinkt én het recht ervoor heeft; art. 9-gegevens (gezondheid, kerkgenootschap) bovendien alleen bij een niet
 * ingetrokken toestemming. De routes (`crm/participant-list-routes.js`) dwingen de rechten af en loggen elke export.
 */
const { createXlsx } = require('../export/xlsx');
const { FIELDS } = require('../booking/fields');
const { formatDate } = require('../site/format');
const { PLAIN_FIELDS, BLOCK_CONSENTS } = require('./persons');
const { STATUSES } = require('./booking-routes');

/**
 * De categorieën met bijzondere of identiteitsgegevens die een gebruiker los kan aanvinken. `slug` komt in het
 * formulier en in het auditlog; `right` is het recht uit `crm/rights.js`; `blocks` de versleutelde blokken van de persoon.
 */
const CATEGORIES = {
  identiteit: { label: 'Identiteitsgegevens (geboortedatum, nationaliteit, paspoort of ID-kaart)', right: 'gegevens.identiteit', blocks: ['identity_data'] },
  gezondheid: { label: 'Medische bijzonderheden en noodnummer', right: 'gegevens.gezondheid', blocks: ['health_data', 'emergency_data'] },
  religie: { label: 'Kerkgenootschap', right: 'gegevens.religie', blocks: ['special_data'] },
};

/** Keuzelijsten van het formulier (waarde → label), voor leesbare cellen. */
const OPTION_LABELS = Object.fromEntries(FIELDS.filter((field) => field.options).map((field) => [field.name, Object.fromEntries(field.options.map((option) => [option.value, option.label]))]));

/** Tekst in een cel als een blok niet te ontsleutelen is (andere hoofdsleutel of beschadigd). */
const UNREADABLE = '(niet te openen)';

/** Tekst in een cel als een art. 9-toestemming ontbreekt of is ingetrokken. */
const NO_CONSENT = '(geen toestemming)';

/**
 * Een ja/nee-waarde als tekst.
 * @param {*} value Waarde (boolean of leeg).
 * @returns {string} "ja", "nee" of leeg.
 */
function yesNo(value) {
  if (value === null || value === undefined) return '';
  return value ? 'ja' : 'nee';
}

/**
 * Het label van een keuzewaarde, of de waarde zelf als die niet in de lijst staat.
 * @param {string} field Naam van het veld.
 * @param {*} value Waarde.
 * @returns {string} Tekst.
 */
function optionLabel(field, value) {
  const text = String(value ?? '');
  return Object.hasOwn(OPTION_LABELS[field] || {}, text) ? OPTION_LABELS[field][text] : text;
}

/**
 * De vaste kolommen van de lijst (NAW, contact en reisgegevens). `value` krijgt een rij uit `loadParticipants`.
 * @type {Array<{label: string, value: (row: object) => (string|number)}>}
 */
const BASE_COLUMNS = [
  { label: 'Nr.', value: (row) => row.number },
  { label: 'Referentie', value: (row) => row.reference },
  { label: 'Status', value: (row) => STATUSES[row.status] || row.status },
  { label: 'Aangemeld op', value: (row) => formatDate(row.created_at) },
  { label: 'Achternaam', value: (row) => row.plain.last_name },
  { label: 'Roepnaam', value: (row) => row.plain.call_name },
  { label: 'Voornamen', value: (row) => row.plain.first_names },
  { label: 'Geslacht', value: (row) => optionLabel('gender', row.plain.gender) },
  { label: 'E-mailadres', value: (row) => row.plain.email },
  { label: 'Mobiel', value: (row) => row.plain.mobile },
  { label: 'Telefoon', value: (row) => row.plain.phone },
  { label: 'Straat en huisnummer', value: (row) => row.plain.street },
  { label: 'Postcode', value: (row) => row.plain.postal_code },
  { label: 'Woonplaats', value: (row) => row.plain.city },
  { label: 'Beroep', value: (row) => row.plain.occupation },
  { label: 'Reist samen met', value: (row) => row.travel_with },
  { label: 'Eerder mee geweest', value: (row) => yesNo(row.earlier_trip) },
  { label: 'Creditcard', value: (row) => yesNo(row.credit_card) },
  { label: 'Wil chauffeur zijn', value: (row) => yesNo(row.driver_interest) },
  { label: 'Eerder chauffeur', value: (row) => yesNo(row.driver_before) },
  { label: 'Chauffeur wanneer', value: (row) => row.driver_when },
  { label: 'Betaalkeuze', value: (row) => optionLabel('payment_choice', row.payment_choice) },
];

/**
 * De kolommen per categorie met bijzondere of identiteitsgegevens: blok en veld in dat blok.
 * @type {Record<string, Array<{label: string, block: string, field: string, date?: boolean, options?: boolean}>>}
 */
const CATEGORY_COLUMNS = {
  identiteit: [
    { label: 'Geboortedatum', block: 'identity_data', field: 'birth_date', date: true },
    { label: 'Nationaliteit', block: 'identity_data', field: 'nationality' },
    { label: 'Paspoort of ID-kaart', block: 'identity_data', field: 'document_type', options: true },
    { label: 'Documentnummer', block: 'identity_data', field: 'document_number' },
    { label: 'Document geldig tot', block: 'identity_data', field: 'document_valid_until', date: true },
  ],
  gezondheid: [
    { label: 'Medische bijzonderheden', block: 'health_data', field: 'particulars' },
    { label: 'Noodnummer', block: 'emergency_data', field: 'emergency_phone' },
  ],
  religie: [
    { label: 'Kerkgenootschap', block: 'special_data', field: 'church' },
  ],
};

/** Overige kolommen van de aanmelding die in de lijst komen. */
const BOOKING_EXTRA = ['travel_with', 'earlier_trip', 'credit_card', 'driver_interest', 'driver_before', 'driver_when', 'payment_choice'];

/**
 * Leest de reis en de deelnemers (aanmeldingen die niet geannuleerd zijn) van één vertrek, in één query.
 * @param {{query: Function}} db Database.
 * @param {number} tripId Id van de reis.
 * @returns {Promise<Array<object>>} Rijen op achternaam; `plain` bevat de NAW-velden (persoon, anders formulier).
 */
async function loadParticipants(db, tripId) {
  const rows = await db.query(
    `SELECT b.id, b.reference, b.status, b.created_at, b.person_id, ${BOOKING_EXTRA.map((name) => `b.${name}`).join(', ')},
            ${PLAIN_FIELDS.map((name) => `b.${name} AS booking_${name}, p.${name} AS person_${name}`).join(', ')},
            p.identity_data, p.special_data, p.health_data, p.emergency_data,
            EXISTS (SELECT 1 FROM consents c WHERE c.person_id = p.id AND c.kind = $2 AND c.withdrawn_at IS NULL) AS consent_special,
            EXISTS (SELECT 1 FROM consents c WHERE c.person_id = p.id AND c.kind = $3 AND c.withdrawn_at IS NULL) AS consent_health
       FROM bookings b LEFT JOIN persons p ON p.id = b.person_id
      WHERE b.trip_id = $1 AND b.status <> 'geannuleerd'
      ORDER BY lower(coalesce(p.last_name, b.last_name)), lower(coalesce(p.first_names, b.first_names)), b.id`,
    [tripId, BLOCK_CONSENTS.special_data, BLOCK_CONSENTS.health_data],
  );
  return rows.map((row, index) => ({
    ...row,
    number: index + 1,
    plain: Object.fromEntries(PLAIN_FIELDS.map((name) => [name, (row.person_id ? row[`person_${name}`] : row[`booking_${name}`]) || ''])),
  }));
}

/**
 * Of een art. 9-blok van een rij mee mag: blokken zonder toestemmingsplicht altijd, anders alleen met een niet
 * ingetrokken toestemming.
 * @param {object} row Rij uit `loadParticipants`.
 * @param {string} block Naam van het blok.
 * @returns {boolean} Waar als het blok mee mag.
 */
function consentAllows(row, block) {
  if (block === 'special_data') return Boolean(row.consent_special);
  if (block === 'health_data') return Boolean(row.consent_health);
  return true;
}

/**
 * Bouwt de werkmap: blad *Deelnemers* met de gekozen kolommen en blad *Over deze lijst* met reis, moment, maker en
 * de opgenomen categorieën.
 * @param {{trip: object, rows: object[], categories: string[], openBlock: Function, userName: string, now?: Date}} input
 *   De reis, de rijen, de gekozen categorieën (sleutels van CATEGORIES, al op rechten gecontroleerd), de functie
 *   `persons.openBlock`, de naam van de maker en (voor tests) het moment.
 * @returns {Buffer} Het .xlsx-bestand.
 */
function buildParticipantWorkbook(input) {
  const { trip, rows, categories, openBlock, userName } = input;
  const now = input.now || new Date();
  const extra = categories.flatMap((category) => CATEGORY_COLUMNS[category]);
  const header = [...BASE_COLUMNS.map((column) => column.label), ...extra.map((column) => column.label)];
  const body = rows.map((row) => {
    const opened = {};
    /**
     * Opent een blok van de rij één keer; null als dat niet lukt.
     * @param {string} block Naam van het blok.
     * @returns {(Record<string, string>|null)} Velden of null.
     */
    const blockOf = (block) => {
      if (!Object.hasOwn(opened, block)) {
        try {
          opened[block] = row.person_id ? openBlock(block, { id: row.person_id, [block]: row[block] }) : {};
        } catch {
          // Alleen ids in het log, nooit inhoud.
          console.error(`deelnemerslijst: blok ${block} van persoon ${row.person_id} niet te openen`);
          opened[block] = null;
        }
      }
      return opened[block];
    };
    const cells = extra.map((column) => {
      if (!row.person_id) return '';
      if (!consentAllows(row, column.block)) return row[column.block] ? NO_CONSENT : '';
      const data = blockOf(column.block);
      if (!data) return UNREADABLE;
      const value = data[column.field] || '';
      if (column.date) return formatDate(value) || value;
      return column.options ? optionLabel(column.field, value) : value;
    });
    return [...BASE_COLUMNS.map((column) => column.value(row)), ...cells];
  });
  const made = now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const about = [
    ['Onderdeel', 'Waarde'],
    ['Reis', trip.title],
    ['Reiscode', trip.trip_code || ''],
    ['Vertrek', formatDate(trip.departure_date)],
    ['Aantal deelnemers', rows.length],
    ['Gemaakt op', made],
    ['Gemaakt door', userName],
    ['Bijzondere gegevens', categories.length ? categories.map((category) => CATEGORIES[category].label).join('; ') : 'geen'],
    ['Let op', categories.length
      ? 'Vertrouwelijk: deze lijst bevat bijzondere of identiteitsgegevens. Niet doorsturen en na de reis verwijderen.'
      : 'Vertrouwelijk: persoonsgegevens. Niet doorsturen en na de reis verwijderen.'],
    ['Niet in de lijst', 'Geannuleerde aanmeldingen'],
  ];
  return createXlsx([{ name: 'Deelnemers', rows: [header, ...body] }, { name: 'Over deze lijst', rows: about }]);
}

/**
 * Bestandsnaam van de lijst: alleen kleine letters, cijfers en streepjes.
 * @param {{trip_code?: string, slug?: string, id: number}} trip De reis.
 * @param {Date} [now] Moment (voor tests).
 * @returns {string} Bestandsnaam met `.xlsx`.
 */
function participantFileName(trip, now = new Date()) {
  const base = String(trip.trip_code || trip.slug || `reis-${trip.id}`).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `reis-${trip.id}`;
  const day = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  return `deelnemerslijst-${base}-${day}.xlsx`;
}

module.exports = { CATEGORIES, CATEGORY_COLUMNS, BASE_COLUMNS, loadParticipants, buildParticipantWorkbook, participantFileName, consentAllows, NO_CONSENT, UNREADABLE };
