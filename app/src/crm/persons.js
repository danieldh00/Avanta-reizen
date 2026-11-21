/**
 * Personen van het CRM (tabel `persons`): één persoon, meerdere aanmeldingen. Bijzondere en identiteitsgegevens staan
 * per categorie versleuteld in een eigen blok (zie `docs/OPZET-CRM.md` §3), met AAD `persons:<blok>:<id>` zodat een
 * blok niet naar een ander record te kopiëren is. Ontdubbelen gaat met `match_key`: een HMAC over het e-mailadres en
 * de geboortedatum, zodat zoeken kan zonder de geboortedatum leesbaar op te slaan.
 *
 * Een openbaar formulier mag nooit gegevens van een bestaande persoon overschrijven: bij een gelijke `match_key`
 * worden alleen lege velden aangevuld. Wijkt een ingevuld veld af, of klopt alleen het e-mailadres, dan komt er een
 * nieuwe persoon met `duplicate_of` (mogelijk dubbel) en beslist kantoor.
 */
const crypto = require('node:crypto');
const { FIELDS, CONSENT_TEXT_VERSION } = require('../booking/fields');

/** Velden die leesbaar in `persons` staan (NAW en contact). */
const PLAIN_FIELDS = ['gender', 'first_names', 'call_name', 'last_name', 'email', 'mobile', 'phone', 'street', 'postal_code', 'city', 'occupation'];

/** De versleutelde blokken en welke formuliervelden erin horen. */
const BLOCKS = {
  identity_data: ['birth_date', 'nationality', 'document_type', 'document_number', 'document_valid_until'],
  special_data: ['church'],
  health_data: ['particulars'],
  emergency_data: ['emergency_phone'],
};

/** Welk recht nodig is om een blok in te zien (`crm/rights.js`). */
const BLOCK_RIGHTS = {
  identity_data: 'gegevens.identiteit',
  special_data: 'gegevens.religie',
  health_data: 'gegevens.gezondheid',
  emergency_data: 'gegevens.gezondheid',
};

/** Toestemming die bij een blok met bijzondere gegevens (art. 9) hoort. */
const BLOCK_CONSENTS = { special_data: 'art9_religie', health_data: 'art9_gezondheid' };

/** Advisory lock (eerste sleutel) rond het zoeken en aanmaken van een persoon, tegen dubbel aanmaken bij gelijktijdige aanmeldingen. */
const PERSON_LOCK = 727010;

/** Hoogstens zoveel personen met dezelfde match_key vergelijken bij een aanmelding. */
const MAX_CANDIDATES = 20;

/** Tekstversie voor toestemmingen die uit een aanmelding van vóór de losse vinkjes komen (één vinkje voor alles). */
const LEGACY_TEXT_VERSION = 'oud-formulier';

/**
 * Normaliseert een waarde om twee invoeren te vergelijken: hoofdletterongevoelig, witruimte samengevoegd.
 * @param {*} value Waarde.
 * @returns {string} Genormaliseerde tekst.
 */
function comparable(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Maakt het hulpmiddel voor personen.
 * @param {{vault: {seal: Function, open: Function, deriveKey: Function}}} options De kluis (`security/vault.js`).
 * @returns {object} Functies voor de opslag van personen.
 */
function createPersons(options) {
  const { vault } = options;
  const matchSecret = vault.deriveKey('persons:match');

  /**
   * Berekent de sleutel om dezelfde persoon terug te vinden.
   * @param {string} email E-mailadres.
   * @param {string} birthDate Geboortedatum (jjjj-mm-dd), mag leeg zijn.
   * @returns {string} HMAC-SHA256 in hex.
   */
  const matchKey = (email, birthDate) => crypto.createHmac('sha256', matchSecret)
    .update(`${comparable(email)}\n${String(birthDate || '').trim()}`)
    .digest('hex');

  /**
   * De context (AAD) van een blok van één persoon.
   * @param {string} block Naam van het blok.
   * @param {number} personId Id van de persoon.
   * @returns {string} Context.
   */
  const contextOf = (block, personId) => `persons:${block}:${personId}`;

  /**
   * Versleutelt een blok; een blok zonder ingevulde velden wordt null (niets opslaan).
   * @param {string} block Naam van het blok.
   * @param {number} personId Id van de persoon.
   * @param {Record<string, string>} data Velden van het blok.
   * @returns {(string|null)} Versleutelde tekst of null.
   */
  const sealBlock = (block, personId, data) => {
    const filled = Object.fromEntries(Object.entries(data).filter(([, value]) => value));
    return Object.keys(filled).length ? vault.seal(filled, contextOf(block, personId)) : null;
  };

  /**
   * Ontsleutelt een blok van een persoon.
   * @param {string} block Naam van het blok.
   * @param {{id: number}} person De persoon met de versleutelde kolom.
   * @returns {Record<string, string>} De velden; leeg als het blok leeg is.
   */
  const openBlock = (block, person) => {
    if (!Object.hasOwn(BLOCKS, block)) throw new Error('onbekend blok');
    return person[block] ? vault.open(person[block], contextOf(block, person.id)) : {};
  };

  /**
   * Verdeelt de waarden van het aanmeldformulier over de leesbare velden en de blokken.
   * @param {Record<string, string>} values Gecontroleerde waarden (`booking/fields.js`).
   * @returns {{plain: Record<string, string>, blocks: Record<string, Record<string, string>>}} Verdeling.
   */
  const splitValues = (values) => {
    const plain = Object.fromEntries(PLAIN_FIELDS.map((name) => [name, String(values[name] || '')]));
    plain.email = plain.email.toLowerCase();
    plain.postal_code = plain.postal_code.toUpperCase();
    const blocks = Object.fromEntries(Object.entries(BLOCKS).map(([block, names]) => [block, Object.fromEntries(names.map((name) => [name, String(values[name] || '')]))]));
    return { plain, blocks };
  };

  /**
   * Voegt nieuwe gegevens samen met een bestaande persoon, maar alleen als niets wat al is ingevuld wordt overschreven.
   * @param {object} existing Bestaande persoon (met versleutelde blokken).
   * @param {{plain: object, blocks: object}} incoming Nieuwe gegevens.
   * @returns {({plain: object, blocks: object}|null)} De aangevulde gegevens, of null als er een ingevuld veld afwijkt of
   *   een blok van de bestaande persoon niet te openen is.
   */
  const mergeInto = (existing, incoming) => {
    let opened;
    try {
      opened = Object.fromEntries(Object.keys(BLOCKS).map((block) => [block, openBlock(block, existing)]));
    } catch {
      // Een blok dat niet te openen is (andere hoofdsleutel, beschadigd): niet samenvoegen, de aanmelding gaat gewoon door.
      console.error(`personen: blok van persoon ${existing.id} niet te openen; nieuwe aanmelding als mogelijk dubbel opgeslagen`);
      return null;
    }
    const plain = {};
    for (const name of PLAIN_FIELDS) {
      const current = existing[name] || '';
      const next = incoming.plain[name] || '';
      if (current && next && comparable(current) !== comparable(next)) return null;
      plain[name] = current || next;
    }
    const blocks = {};
    for (const block of Object.keys(BLOCKS)) {
      const current = opened[block];
      const merged = {};
      for (const name of BLOCKS[block]) {
        const before = current[name] || '';
        const next = incoming.blocks[block][name] || '';
        if (before && next && comparable(before) !== comparable(next)) return null;
        merged[name] = before || next;
      }
      blocks[block] = merged;
    }
    return { plain, blocks };
  };

  /**
   * Slaat een nieuwe persoon op.
   * @param {{query: Function}} client Transactie-client.
   * @param {{plain: object, blocks: object}} data Gegevens.
   * @param {string} key De match_key.
   * @param {(number|null)} duplicateOf Mogelijk dezelfde persoon als deze id.
   * @returns {Promise<number>} Id van de nieuwe persoon.
   */
  const insertPerson = async (client, data, key, duplicateOf) => {
    // Eerst het id, want de versleuteling van de blokken hoort bij dat id (AAD).
    const [{ id }] = await client.query("SELECT nextval(pg_get_serial_sequence('persons', 'id'))::int AS id");
    const { plain } = data;
    await client.query(
      `INSERT INTO persons (id, gender, first_names, call_name, last_name, email, mobile, phone, street, postal_code, city,
         occupation, match_key, identity_data, special_data, health_data, emergency_data, duplicate_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, plain.gender, plain.first_names, plain.call_name, plain.last_name, plain.email, plain.mobile, plain.phone,
        plain.street, plain.postal_code, plain.city, plain.occupation, key,
        sealBlock('identity_data', id, data.blocks.identity_data), sealBlock('special_data', id, data.blocks.special_data),
        sealBlock('health_data', id, data.blocks.health_data), sealBlock('emergency_data', id, data.blocks.emergency_data), duplicateOf],
    );
    return id;
  };

  /**
   * Werkt een bestaande persoon bij met aangevulde gegevens.
   * @param {{query: Function}} client Transactie-client.
   * @param {number} id Id van de persoon.
   * @param {{plain: object, blocks: object}} data Aangevulde gegevens.
   * @returns {Promise<void>}
   */
  const updatePerson = async (client, id, data) => {
    const { plain } = data;
    await client.query(
      `UPDATE persons SET gender = $2, first_names = $3, call_name = $4, last_name = $5, email = $6, mobile = $7, phone = $8,
         street = $9, postal_code = $10, city = $11, occupation = $12, identity_data = $13, special_data = $14,
         health_data = $15, emergency_data = $16, updated_at = now(), last_activity_at = now()
       WHERE id = $1`,
      [id, plain.gender, plain.first_names, plain.call_name, plain.last_name, plain.email, plain.mobile, plain.phone,
        plain.street, plain.postal_code, plain.city, plain.occupation,
        sealBlock('identity_data', id, data.blocks.identity_data), sealBlock('special_data', id, data.blocks.special_data),
        sealBlock('health_data', id, data.blocks.health_data), sealBlock('emergency_data', id, data.blocks.emergency_data)],
    );
  };

  /** De kolommen die nodig zijn om een bestaande persoon te vergelijken. */
  const PERSON_COLUMNS = `id, ${PLAIN_FIELDS.join(', ')}, ${Object.keys(BLOCKS).join(', ')}`;

  /**
   * Zoekt of maakt de persoon bij een aanmelding (in de transactie van de aanmelding).
   * @param {{query: Function}} client Transactie-client.
   * @param {Record<string, string>} values Gecontroleerde waarden van het aanmeldformulier.
   * @returns {Promise<{personId: number, outcome: ('nieuw'|'bestaand'|'mogelijk-dubbel')}>} De persoon en wat er gebeurde.
   */
  const savePerson = async (client, values) => {
    const incoming = splitValues(values);
    const key = matchKey(incoming.plain.email, incoming.blocks.identity_data.birth_date);
    // Slot per e-mailadres: twee gelijktijdige aanmeldingen van dezelfde persoon maken niet elk een eigen persoon.
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [PERSON_LOCK, incoming.plain.email]);
    // Eerst de oorspronkelijke persoon, daarna de al bestaande mogelijke dubbelen met dezelfde sleutel: wie twee keer
    // met hetzelfde nieuwe adres boekt, komt zo bij dat ene dubbel uit in plaats van steeds een nieuwe persoon te maken.
    const candidates = await client.query(
      `SELECT ${PERSON_COLUMNS}, duplicate_of FROM persons WHERE match_key = $1
        ORDER BY (duplicate_of IS NOT NULL), id LIMIT $2 FOR UPDATE`,
      [key, MAX_CANDIDATES],
    );
    for (const candidate of candidates) {
      const merged = mergeInto(candidate, incoming);
      if (merged) {
        await updatePerson(client, candidate.id, merged);
        return { personId: candidate.id, outcome: candidate.duplicate_of ? 'mogelijk-dubbel' : 'bestaand' };
      }
    }
    if (candidates.length) {
      const original = candidates[0].duplicate_of || candidates[0].id;
      return { personId: await insertPerson(client, incoming, key, original), outcome: 'mogelijk-dubbel' };
    }
    const [sameEmail] = await client.query(
      'SELECT id FROM persons WHERE lower(email) = $1 AND duplicate_of IS NULL ORDER BY id LIMIT 1',
      [incoming.plain.email],
    );
    const personId = await insertPerson(client, incoming, key, sameEmail ? sameEmail.id : null);
    return { personId, outcome: sameEmail ? 'mogelijk-dubbel' : 'nieuw' };
  };

  /**
   * Legt de toestemmingen van een aanmelding vast: altijd de voorwaarden, en art. 9 alleen als het vinkje aan stond.
   * @param {{query: Function}} client Transactie-client.
   * @param {{personId: number, bookingId: number, values: Record<string, string>, textVersion?: string, givenAt?: Date}} consent
   *   Persoon, aanmelding, de formulierwaarden en (bij het omzetten van oude aanmeldingen) de tekstversie en het tijdstip.
   * @returns {Promise<string[]>} De vastgelegde soorten.
   */
  const recordConsents = async (client, consent) => {
    const kinds = ['voorwaarden'];
    for (const field of FIELDS.filter((item) => item.consentFor)) {
      const block = Object.keys(BLOCKS).find((name) => BLOCKS[name].includes(field.consentFor));
      if (consent.values[field.name] === 'ja' && consent.values[field.consentFor]) kinds.push(BLOCK_CONSENTS[block]);
    }
    await client.query(
      `INSERT INTO consents (person_id, booking_id, kind, text_version, given_at)
       SELECT $1, $2, kind, $4, coalesce($5::timestamptz, now()) FROM unnest($3::text[]) AS kind`,
      [consent.personId, consent.bookingId, kinds, consent.textVersion || CONSENT_TEXT_VERSION, consent.givenAt || null],
    );
    return kinds;
  };

  /**
   * Zet aanmeldingen van vóór de personen-tabel om: per aanmelding de persoon zoeken of maken, de bijzondere gegevens
   * naar de blokken van de persoon en `bookings.sensitive_data` leeg. Art. 9-gegevens (kerkgenootschap,
   * bijzonderheden) gaan niet mee: daarvoor was geen losse toestemming. Draait bij het starten; elke aanmelding in een
   * eigen transactie, dus een onderbreking is veilig. Een aanmelding die niet te ontsleutelen of op te slaan is blijft
   * staan en wordt geteld.
   * @param {{query: Function, transaction: Function}} db Database.
   * @param {{batchSize?: number}} [settings] Aantal per ronde.
   * @returns {Promise<{converted: number, failed: number}>} Aantallen (nooit persoonsgegevens).
   */
  const backfillPersons = async (db, settings = {}) => {
    const batchSize = settings.batchSize || 100;
    let converted = 0;
    let failed = 0;
    let afterId = 0;
    for (;;) {
      const rows = await db.query(
        `SELECT id, gender, first_names, call_name, last_name, email, mobile, phone, street, postal_code, city, occupation,
                sensitive_data, consent_at
           FROM bookings WHERE person_id IS NULL AND sensitive_data IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`,
        [afterId, batchSize],
      );
      if (!rows.length) break;
      for (const row of rows) {
        afterId = row.id;
        let sensitive;
        try {
          sensitive = vault.open(row.sensitive_data);
        } catch {
          failed++;
          continue;
        }
        // Het oude formulier had één vinkje voor alles en geen uitdrukkelijke toestemming voor art. 9. Kerkgenootschap en
        // bijzonderheden gaan daarom niet mee naar de persoon (en verdwijnen met sensitive_data); kantoor vraagt ze zo
        // nodig opnieuw, met toestemming. Alleen de voorwaarden worden vastgelegd, met tekstversie 'oud-formulier'.
        const values = { ...row, ...sensitive, church: '', particulars: '', consent_religion: '', consent_health: '' };
        try {
          await db.transaction(async (client) => {
            const [current] = await client.query('SELECT id FROM bookings WHERE id = $1 AND person_id IS NULL AND sensitive_data IS NOT NULL FOR UPDATE', [row.id]);
            if (!current) return;
            const { personId } = await savePerson(client, values);
            await client.query('UPDATE bookings SET person_id = $2, sensitive_data = NULL WHERE id = $1', [row.id, personId]);
            await recordConsents(client, { personId, bookingId: row.id, values, textVersion: LEGACY_TEXT_VERSION, givenAt: row.consent_at });
          });
        } catch {
          // Eén onbruikbare aanmelding houdt de rest niet tegen; hij blijft staan en wordt bij de volgende start opnieuw geprobeerd.
          failed++;
          continue;
        }
        converted++;
      }
    }
    return { converted, failed };
  };

  return { matchKey, openBlock, savePerson, recordConsents, backfillPersons, splitValues };
}

module.exports = { createPersons, PLAIN_FIELDS, BLOCKS, BLOCK_RIGHTS, BLOCK_CONSENTS, LEGACY_TEXT_VERSION };
