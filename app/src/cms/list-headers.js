// @ts-check
/**
 * Koppen van de lijstpagina's (W28, migratie 34): pretitel, titel, inleiding en foto van Reizen (`/reis/`),
 * Reisleiders (`/reisleider/`), Blog (`/blog/`), Veelgestelde vragen (`/faq/`) en het aanmeldformulier. De rijen staan
 * in `list_headers` en worden in het CRM gewijzigd (`list-header-routes.js`, recht `content`).
 *
 * De site leest ze synchroon met `get(key)` uit een kopie in het geheugen; `load()` vult die kopie (de middleware in
 * `server.js` roept het per verzoek aan, de database wordt hooguit elke `CACHE_MS` opnieuw gelezen) en elke wijziging
 * hier ververst hem meteen. Ontbreekt een rij, dan geldt de standaardtekst hieronder. Gebonden parameters, audit in
 * dezelfde transactie.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');

/** De lijstpagina's: naam in het CRM en het adres op de site (leeg: het aanmeldformulier hangt aan een reis). */
const LIST_PAGES = Object.freeze({
  reis: { label: 'Reizen', path: '/reis/' },
  reisleider: { label: 'Reisleiders', path: '/reisleider/' },
  blog: { label: 'Blog', path: '/blog/' },
  faq: { label: 'Veelgestelde vragen', path: '/faq/' },
  aanmelden: { label: 'Aanmelden (formulier bij een reis)', path: '' },
});

/** Standaardkoppen, gelijk aan de beginwaarden in migratie 34 (de teksten van de huidige site, 21-11-2026). */
const DEFAULT_LIST_HEADERS = Object.freeze({
  reis: { pretitle: '40 jaar wereldwijde ervaring', title: 'Ons reisaanbod', introduction: '', image: '' },
  reisleider: { pretitle: 'Ervaren avanturiers', title: 'Reisleiders', introduction: 'Ontmoet alvast onze reisleiders!', image: '' },
  blog: { pretitle: 'campfire stories', title: 'Weblog', introduction: 'Lees ervaringen van onze reisleiders en deelnemers!', image: '' },
  faq: { pretitle: 'Handig om te weten!', title: 'Veelgestelde vragen', introduction: '', image: '' },
  aanmelden: { pretitle: 'Ja! Ik ga graag mee op reis', title: 'Aanmelden', introduction: 'Doorloop onderstaande stappen om je aan te melden voor de reis.', image: '' },
});

/** Maximale lengtes. */
const LIST_HEADER_LIMITS = Object.freeze({ pretitle: 120, title: 120, introduction: 400 });

/** Breedte van de opgeslagen foto: de kop is volle breedte (`renderPageHeader` kiest daarbinnen 1600). */
const LIST_HEADER_IMAGE_WIDTH = 1600;

/** Hoe lang de kopie in het geheugen geldt voordat de database opnieuw wordt gelezen (een andere container). */
const CACHE_MS = 60_000;

/**
 * Of een sleutel een lijstpagina is.
 * @param {*} key Waarde.
 * @returns {boolean} Bekend.
 */
function isListKey(key) {
  return typeof key === 'string' && Object.hasOwn(LIST_PAGES, key);
}

/**
 * Leest en controleert de velden van een kop uit een formulier.
 * @param {Record<string, *>} body Ingezonden velden.
 * @returns {{values: {pretitle: string, title: string, introduction: string}, errors: Record<string, string>}} Waarden en
 *   fouten per veld.
 */
function validateListHeaderFields(body) {
  /** @type {Record<string, string>} */
  const errors = {};
  /**
   * Eén tekstveld met maximale lengte.
   * @param {('pretitle'|'title'|'introduction')} name Veld.
   * @returns {string} Opgeschoonde tekst.
   */
  const field = (name) => {
    const max = LIST_HEADER_LIMITS[name];
    const value = cleanText(body[name], max + 1);
    if (value.length > max) errors[name] = `Maximaal ${max} tekens.`;
    return value.slice(0, max);
  };
  const values = { pretitle: field('pretitle'), title: field('title'), introduction: field('introduction') };
  if (!values.title && !errors.title) errors.title = 'Vul een titel in.';
  return { values, errors };
}

/**
 * Een rij uit `list_headers` in de vorm die de site gebruikt.
 * @param {{pretitle: string, title: string, introduction: string, image_url: (string|null)}} row Rij.
 * @returns {{pretitle: string, title: string, introduction: string, image: string}} Kop.
 */
function headerFromRow(row) {
  return { pretitle: row.pretitle, title: row.title, introduction: row.introduction, image: row.image_url || '' };
}

/**
 * Maakt de functies voor de koppen van de lijstpagina's.
 * @param {{db: {query: Function, transaction: Function}, now?: () => number}} options Database en klok (tests).
 * @returns {object} Functies.
 */
function createListHeaders(options) {
  const { db } = options;
  const now = options.now || Date.now;
  /** @type {{loadedAt: number, headers: Map<string, any>}|null} */
  let cache = null;

  /**
   * Leest alle koppen uit de database en zet ze in het geheugen.
   * @returns {Promise<Map<string, any>>} Koppen per sleutel (met `source` en `updated_at`).
   */
  const reload = async () => {
    const rows = await db.query('SELECT key, pretitle, title, introduction, image_url, source, updated_at FROM list_headers');
    const headers = new Map(rows.map((row) => [row.key, { ...headerFromRow(row), source: row.source, updatedAt: row.updated_at }]));
    cache = { loadedAt: now(), headers };
    return headers;
  };

  /**
   * Zorgt dat de kopie in het geheugen actueel is (hooguit `CACHE_MS` oud). Een databasefout breekt de site niet: dan
   * blijft de vorige kopie staan (of gelden de standaardteksten) en volgt na `CACHE_MS` een nieuwe poging.
   * @returns {Promise<void>}
   */
  const load = async () => {
    if (cache && now() - cache.loadedAt <= CACHE_MS) return;
    try {
      await reload();
    } catch (error) {
      console.error(`lijstkoppen: laden mislukt, vorige kopie blijft (${error.code || error.name})`);
      cache = { loadedAt: now(), headers: cache ? cache.headers : new Map() };
    }
  };

  /**
   * De kop van één lijstpagina voor de site (synchroon, uit het geheugen); de standaard als er (nog) niets is geladen.
   * @param {string} key Sleutel uit `LIST_PAGES`.
   * @returns {{pretitle: string, title: string, introduction: string, image: string}} Kop.
   */
  const get = (key) => {
    /** @type {any} */
    const own = cache && cache.headers.get(key);
    if (!own) return { ...DEFAULT_LIST_HEADERS[/** @type {keyof typeof DEFAULT_LIST_HEADERS} */ (key)] };
    return { pretitle: own.pretitle, title: own.title, introduction: own.introduction, image: own.image };
  };

  /**
   * Alle koppen voor het overzicht in het CRM, in de vaste volgorde, rechtstreeks uit de database.
   * @returns {Promise<any[]>} Koppen (`key`, `label`, `path`, `pretitle`, `title`, `introduction`, `image`, `source`,
   *   `updatedAt`).
   */
  const list = async () => {
    const headers = await reload();
    return Object.entries(LIST_PAGES).map(([key, page]) => {
      const own = headers.get(key);
      return { key, ...page, ...(own || { ...DEFAULT_LIST_HEADERS[/** @type {keyof typeof DEFAULT_LIST_HEADERS} */ (key)], source: 'standaard', updatedAt: null }) };
    });
  };

  /**
   * Schrijft een kop (ook als de rij nog ontbreekt) en ververst de kopie in het geheugen.
   * @param {string} key Sleutel.
   * @param {(client: any) => Promise<(string|undefined)>} change Wijziging in de transactie; geeft een status terug
   *   om af te breken (bijv. `foto-weg`).
   * @param {{audit: (client: object) => Promise<void>}} context Audit.
   * @returns {Promise<string>} `ok`, `weg` of de status van `change`.
   */
  const write = async (key, change, context) => {
    if (!isListKey(key)) return 'weg';
    const outcome = await db.transaction(async (/** @type {any} */ client) => {
      const defaults = DEFAULT_LIST_HEADERS[/** @type {keyof typeof DEFAULT_LIST_HEADERS} */ (key)];
      await client.query(
        'INSERT INTO list_headers (key, pretitle, title, introduction) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
        [key, defaults.pretitle, defaults.title, defaults.introduction],
      );
      await client.query('SELECT key FROM list_headers WHERE key = $1 FOR UPDATE', [key]);
      const status = await change(client);
      if (status) return status;
      await context.audit(client);
      return 'ok';
    });
    await reload();
    return outcome;
  };

  /**
   * Wijzigt de teksten van een kop.
   * @param {string} key Sleutel.
   * @param {{pretitle: string, title: string, introduction: string}} values Uit `validateListHeaderFields`.
   * @param {{userId: number, audit: (client: object) => Promise<void>}} context Gebruiker en audit.
   * @returns {Promise<string>} `ok` of `weg`.
   */
  const update = (key, values, context) => write(key, async (client) => {
    await client.query(
      `UPDATE list_headers SET pretitle = $2, title = $3, introduction = $4, source = 'crm', updated_at = now(), updated_by = $5
        WHERE key = $1`,
      [key, values.pretitle, values.title, values.introduction, context.userId],
    );
    return undefined;
  }, context);

  /**
   * Kiest de foto van een kop uit de bibliotheek (of geen foto).
   * @param {string} key Sleutel.
   * @param {(number|null)} mediaId Foto, of null voor geen.
   * @param {{userId: number, audit: (client: object) => Promise<void>}} context Gebruiker en audit.
   * @returns {Promise<string>} `ok`, `weg` of `foto-weg`.
   */
  const setImage = (key, mediaId, context) => write(key, async (client) => {
    let url = null;
    if (mediaId !== null) {
      /** @type {any} */
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      url = mediaUrl(photo, LIST_HEADER_IMAGE_WIDTH);
    }
    await client.query("UPDATE list_headers SET image_url = $2, source = 'crm', updated_at = now(), updated_by = $3 WHERE key = $1", [key, url, context.userId]);
    return undefined;
  }, context);

  return { load, reload, get, list, update, setImage };
}

module.exports = { createListHeaders, validateListHeaderFields, isListKey, LIST_PAGES, DEFAULT_LIST_HEADERS, LIST_HEADER_LIMITS, LIST_HEADER_IMAGE_WIDTH };
