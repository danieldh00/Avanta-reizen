/**
 * Instellingen van de app, te beheren onder Beheer (`/app/beheer/`, recht `systeem`). Opzet:
 * - Elke instelling staat in `SETTING_FIELDS` (per groep in `beheer/instellingen/<groep>.js`) met type, standaardwaarde, eventueel een omgevingsvariabele en grenzen.
 * - Volgorde per instelling: database (tabel `settings`) → omgevingsvariabele → standaardwaarde. De omgeving is dus
 *   alleen een startwaarde; wat in Beheer is opgeslagen gaat voor en werkt zonder herstart.
 * - Geheimen (`type: 'secret'`) staan versleuteld in de database (`vault`, gebonden aan de naam van de instelling) en
 *   gaan nooit volledig naar de browser: `view()` geeft alleen "ingesteld" en de laatste 4 tekens.
 * - De waarden staan in het geheugen (één proces per database); `update()` schrijft de database en het geheugen bij.
 */

const { SETTING_GROUPS, mergeFields } = require('./instellingen');

/** Hoogste lengte van een tekstwaarde als de instelling zelf geen maximum noemt. */
const DEFAULT_MAX_LENGTH = 500;

/** Patroon voor een e-mailadres (zelfde controle als in het CRM). */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** Stuurtekens die nooit in een instelling horen (regeleinden alleen bij `textarea`). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Alle instellingen, samengevoegd uit de groepen in `beheer/instellingen/` (één bestand per groep van Beheer; een
 * nieuwe instelling komt daar, niet hier). Velden per instelling:
 * - `type`: `text` | `email` | `url` | `textarea` | `bool` | `int` | `enum` | `secret`
 * - `label`, `help`: tekst voor het formulier in Beheer
 * - `default`: standaardwaarde; `env`: omgevingsvariabele als startwaarde
 * - `max` (tekens) of `min`/`max` (getal), `values` (keuzes bij `enum`), `pattern` + `patternMessage` (tekst),
 *   `required` (niet leeg), `validate(waarde)` (eigen controle op de schone tekst: geeft een melding of leeg)
 * - `confirmOn` (bij `bool`): aanzetten vraagt het wachtwoord van de beheerder (zie `beheer/routes.js`)
 */
const SETTING_FIELDS = mergeFields(SETTING_GROUPS.map((group) => group.FIELDS));

class SettingsError extends Error {
  /**
   * Fout in een ingevoerde instelling, met de naam van de instelling (voor de melding bij het veld).
   * @param {string} key Naam van de instelling.
   * @param {string} message Melding voor de beheerder.
   */
  constructor(key, message) {
    super(message);
    this.name = 'SettingsError';
    this.key = key;
  }
}

/**
 * Zet een opgeslagen of startwaarde om naar het type van de instelling. Een waarde die niet (meer) past, geeft de
 * standaardwaarde; zo breekt een oude of verkeerde omgevingsvariabele de site nooit.
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {*} raw De ruwe waarde.
 * @returns {*} De waarde in het juiste type.
 */
function coerce(definition, raw) {
  if (definition.type === 'bool') return raw === true || raw === 'true' || raw === '1' || raw === 1;
  if (definition.type === 'int') {
    const number = Number(raw);
    return Number.isInteger(number) && number >= definition.min && number <= definition.max ? number : definition.default;
  }
  if (definition.type === 'enum') return definition.values.includes(raw) ? raw : definition.default;
  if (typeof raw !== 'string') return definition.default;
  try {
    return validateText('', definition, raw);
  } catch (_) {
    return definition.default;
  }
}

/**
 * Controleert een tekstwaarde (tekst, e-mail, URL, tekstvak, geheim) en maakt hem schoon.
 * @param {string} key Naam van de instelling (voor de fout).
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {string} raw Ingevoerde tekst.
 * @returns {string} Schone tekst (zonder witruimte aan de randen; e-mail in kleine letters; URL zonder slash achteraan).
 * @throws {SettingsError} Bij een ongeldige waarde.
 */
function validateText(key, definition, raw) {
  let value = String(raw).trim();
  if (definition.type === 'textarea') value = value.replace(/\r\n?/g, '\n');
  const max = definition.max || DEFAULT_MAX_LENGTH;
  if (value.length > max) throw new SettingsError(key, `Gebruik hoogstens ${max} tekens.`);
  if (CONTROL_CHARACTERS.test(value) || (definition.type !== 'textarea' && /[\r\n]/.test(value))) {
    throw new SettingsError(key, 'Deze tekst bevat ongeldige tekens.');
  }
  if (!value) {
    if (definition.required) throw new SettingsError(key, 'Vul dit veld in.');
    return '';
  }
  if (definition.type === 'secret' && definition.min && value.length < definition.min) {
    throw new SettingsError(key, `Gebruik minimaal ${definition.min} tekens.`);
  }
  if (definition.type === 'email') {
    value = value.toLowerCase();
    if (!EMAIL_PATTERN.test(value)) throw new SettingsError(key, 'Vul een geldig e-mailadres in.');
  }
  if (definition.type === 'url') {
    let url;
    try {
      url = new URL(value);
    } catch (_) {
      throw new SettingsError(key, 'Vul een volledig webadres in, beginnend met https://.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SettingsError(key, 'Vul een webadres in dat begint met https://.');
    if (url.username || url.password) throw new SettingsError(key, 'Een webadres met een gebruikersnaam of wachtwoord kan niet.');
    value = `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }
  if (definition.pattern && !definition.pattern.test(value)) throw new SettingsError(key, definition.patternMessage || 'Deze waarde klopt niet.');
  const problem = definition.validate ? definition.validate(value) : '';
  if (problem) throw new SettingsError(key, problem);
  return value;
}

/**
 * Controleert een ingevoerde waarde voor een instelling.
 * @param {string} key Naam van de instelling.
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {*} raw Ingevoerde waarde (uit het formulier: tekst; bij `bool` ook true/false).
 * @returns {*} De waarde in het juiste type.
 * @throws {SettingsError} Bij een ongeldige waarde.
 */
function validateValue(key, definition, raw) {
  if (definition.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'ja' || raw === '') return raw === 'ja';
    throw new SettingsError(key, 'Ongeldige waarde.');
  }
  if (typeof raw !== 'string') throw new SettingsError(key, 'Ongeldige waarde.');
  if (definition.type === 'int') {
    const text = raw.trim();
    const number = /^-?\d{1,9}$/.test(text) ? Number(text) : NaN;
    if (!Number.isInteger(number) || number < definition.min || number > definition.max) {
      throw new SettingsError(key, `Kies een geheel getal van ${definition.min} tot ${definition.max}.`);
    }
    return number;
  }
  if (definition.type === 'enum') {
    if (!definition.values.includes(raw)) throw new SettingsError(key, 'Kies een van de mogelijkheden.');
    return raw;
  }
  return validateText(key, definition, raw);
}

/**
 * Maakt de instellingenlaag.
 * @param {{db: object, vault: {seal: Function, open: Function}, env?: object, fields?: object}} options Database, kluis
 *   voor geheimen, omgevingsvariabelen (standaard `process.env`) en (voor tests) een eigen lijst instellingen.
 * @returns {object} Functies: `load`, `ready`, `get`, `source`, `view`, `update`, `fields`.
 */
function createSettings(options) {
  const { db, vault } = options;
  const env = options.env || process.env;
  const fields = options.fields || SETTING_FIELDS;
  /** Waarden uit de database (geheimen ontsleuteld), per naam. */
  let stored = new Map();
  /** Lopende of afgeronde eerste lading. */
  let loading = null;

  /**
   * Of een naam een bekende instelling is (niet via het prototype).
   * @param {string} key Naam.
   * @returns {boolean} Waar als de instelling bestaat.
   */
  const known = (key) => typeof key === 'string' && Object.hasOwn(fields, key);

  /**
   * Zet een waarde om naar de tekst voor de database; een geheim versleuteld en gebonden aan de naam.
   * @param {string} key Naam van de instelling.
   * @param {*} value De waarde.
   * @returns {string} JSON-tekst.
   */
  const encode = (key, value) => JSON.stringify(fields[key].type === 'secret' ? { enc: vault.seal({ key, value }) } : value);

  /**
   * Leest een opgeslagen waarde terug. Een geheim dat bij een andere instelling hoort of met een andere hoofdsleutel
   * is versleuteld, telt als niet opgeslagen.
   * @param {string} key Naam van de instelling.
   * @param {string} text JSON-tekst uit de database.
   * @returns {{ok: boolean, value?: *}} De waarde, of `ok: false`.
   */
  const decode = (key, text) => {
    try {
      const parsed = JSON.parse(text);
      if (fields[key].type !== 'secret') return { ok: true, value: parsed };
      const opened = parsed && typeof parsed.enc === 'string' ? vault.open(parsed.enc) : null;
      if (!opened || opened.key !== key || typeof opened.value !== 'string') return { ok: false };
      return { ok: true, value: opened.value };
    } catch (_) {
      return { ok: false };
    }
  };

  /**
   * Leest alle instellingen uit de database in het geheugen. Onleesbare regels worden overgeslagen (met een melding
   * zonder waarde in het log).
   * @returns {Promise<void>}
   */
  const load = async () => {
    const rows = await db.query('SELECT key, value FROM settings');
    const next = new Map();
    for (const row of rows) {
      if (!known(row.key)) continue;
      const result = decode(row.key, row.value);
      if (result.ok) next.set(row.key, result.value);
      else console.warn(`Instelling ${row.key} is onleesbaar (of versleuteld met een andere hoofdsleutel) en wordt genegeerd.`);
    }
    stored = next;
  };

  /**
   * Wacht tot de instellingen één keer zijn geladen. Mislukt dat, dan probeert het volgende verzoek het opnieuw.
   * @returns {Promise<void>}
   */
  const ready = () => {
    if (!loading) loading = load().catch((error) => { loading = null; throw error; });
    return loading;
  };

  /**
   * Waar de huidige waarde vandaan komt.
   * @param {string} key Naam van de instelling.
   * @returns {'database'|'omgeving'|'standaard'} De bron.
   */
  const source = (key) => {
    if (!known(key)) throw new Error(`Onbekende instelling ${key}`);
    if (stored.has(key)) return 'database';
    const definition = fields[key];
    if (definition.env && env[definition.env] !== undefined && env[definition.env] !== '') return 'omgeving';
    return 'standaard';
  };

  /**
   * De waarde van een instelling (synchroon; vereist dat `ready()` klaar is, anders geldt omgeving/standaard).
   * @param {string} key Naam van de instelling.
   * @returns {*} De waarde.
   * @throws {Error} Bij een onbekende instelling.
   */
  const get = (key) => (source(key) === 'database' ? coerce(fields[key], stored.get(key)) : startValue(key));

  /**
   * De startwaarde van een instelling: wat geldt zonder waarde in de database (omgeving, anders standaard). Dit is
   * ook de waarde na "terugzetten".
   * @param {string} key Naam van de instelling.
   * @returns {*} De waarde.
   * @throws {Error} Bij een onbekende instelling.
   */
  const startValue = (key) => {
    if (!known(key)) throw new Error(`Onbekende instelling ${key}`);
    const definition = fields[key];
    if (definition.env && env[definition.env] !== undefined && env[definition.env] !== '') return coerce(definition, env[definition.env]);
    return definition.default;
  };

  /**
   * De waarde voor het scherm: een geheim alleen als "ingesteld" met de laatste 4 tekens.
   * @param {string} key Naam van de instelling.
   * @returns {*} Waarde, of bij een geheim `{set: boolean, last4: string}`.
   */
  const view = (key) => {
    const value = get(key);
    if (fields[key].type !== 'secret') return value;
    return { set: Boolean(value), last4: value ? value.slice(-4) : '' };
  };

  /**
   * Slaat wijzigingen op. Een geheim: weglaten of lege tekst = ongewijzigd, `clear` = leegmaken. `reset` zet een
   * instelling terug naar de startwaarde (omgeving of standaard) door de databaseregel te verwijderen. Een waarde die
   * gelijk is aan wat er al geldt, telt niet als wijziging.
   * @param {{values?: object, clear?: string[], reset?: string[]}} patch Nieuwe waarden, te legen geheimen en terug te zetten instellingen.
   * @param {{userId?: (number|null), inTransaction?: Function}} [context] Wie het doet en een functie
   *   `(client, changed) => Promise` die in dezelfde transactie draait (bijv. het auditlog): mislukt die, dan wordt niets opgeslagen.
   * @returns {Promise<string[]>} Namen van de gewijzigde instellingen.
   * @throws {SettingsError} Bij een onbekende instelling of ongeldige waarde (er wordt dan niets opgeslagen).
   */
  const update = async (patch, context = {}) => {
    await ready();
    const writes = new Map();
    const removals = new Set();
    // Terugzetten gaat altijd voor: een teruggezette instelling neemt nooit de waarde uit het formulier over, ook niet
    // als er geen rij in de database is.
    const resetKeys = new Set(patch.reset || []);
    for (const key of resetKeys) {
      if (!known(key)) throw new SettingsError(key, 'Onbekende instelling.');
      if (stored.has(key)) removals.add(key);
    }
    for (const key of patch.clear || []) {
      if (!known(key) || fields[key].type !== 'secret') throw new SettingsError(key, 'Onbekende instelling.');
      if (!resetKeys.has(key) && get(key) !== '') writes.set(key, '');
    }
    for (const [key, raw] of Object.entries(patch.values || {})) {
      if (!known(key)) throw new SettingsError(key, 'Onbekende instelling.');
      if (resetKeys.has(key) || writes.has(key)) continue;
      const definition = fields[key];
      if (definition.type === 'secret' && (raw === undefined || raw === '')) continue;
      const value = validateValue(key, definition, raw);
      if (value === get(key)) continue;
      writes.set(key, value);
    }
    const changed = [...removals, ...writes.keys()];
    if (!changed.length) return [];
    await db.transaction(async (client) => {
      for (const key of removals) await client.query('DELETE FROM settings WHERE key = $1', [key]);
      for (const [key, value] of writes) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
          [key, encode(key, value), context.userId ?? null],
        );
      }
      if (context.inTransaction) await context.inTransaction(client, changed);
    });
    for (const key of removals) stored.delete(key);
    for (const [key, value] of writes) stored.set(key, value);
    return changed;
  };

  return { load, ready, get, source, startValue, view, update, fields };
}

module.exports = { SETTING_FIELDS, SettingsError, createSettings, validateValue, coerce };
