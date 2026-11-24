// @ts-check
/**
 * Doorverwijzingen (301/302) en de lijst met niet-gevonden adressen (404), te beheren in Beheer > Vindbaarheid.
 * - Doorverwijzingen staan in de tabel `redirects` en in het geheugen (één proces); de middleware stuurt een bezoeker
 *   van een oud pad naar het nieuwe adres en telt het gebruik.
 * - Een 404 op de site (niet onder `/app/` of `/api/`) komt in `not_found_log`: alleen het pad (zonder querystring),
 *   het aantal keer, eerste/laatste keer en de host van de verwijzende site. Nooit een IP-adres of volledige URL (AVG).
 * - Tellers worden in het geheugen verzameld en per minuut in één keer weggeschreven (`flush`), zodat een bezoek of
 *   een bot nooit een schrijfactie per verzoek kost. De lijst groeit tot hoogstens `MAX_NOT_FOUND_ROWS` regels en
 *   regels die de bewaartermijn (instelling `notFoundRetentionDays`, standaard `NOT_FOUND_RETENTION_DAYS`) niet meer zijn gezien, worden opgeruimd.
 */

/** Hoogste aantal regels in de 404-lijst; daarna worden alleen bestaande regels nog bijgeteld. */
const MAX_NOT_FOUND_ROWS = 5000;

/** Hoogste aantal verschillende paden dat tussen twee keer wegschrijven in het geheugen wordt verzameld. */
const MAX_PENDING_PATHS = 1000;

/** Na zoveel dagen zonder nieuwe 404 verdwijnt een regel uit de lijst. */
const NOT_FOUND_RETENTION_DAYS = 90;

/** Hoogste lengte van een pad (doorverwijzing of 404-regel). */
const MAX_PATH_LENGTH = 300;

/** Bestandsextensies die alleen scanners vragen (de site heeft geen PHP, ASP of configuratiebestanden). */
const NOISE_EXTENSIONS = /\.(php\d?|phtml|asp|aspx|jsp|cgi|pl|env|ini|cfg|conf|sql|bak|old|swp|log|git|htaccess|ds_store)$/i;

/** Paden die alleen scanners vragen: een verborgen map of bestand (`/.env`, `/.git/`) of bekende beheerroutes. */
const NOISE_PREFIXES = ['/wp-admin', '/wp-includes', '/cgi-bin', '/phpmyadmin', '/vendor/phpunit'];

/** Na zoveel dagen mag een regel die maar één keer is gevraagd wijken voor nieuwe, als de lijst vol is. */
const FULL_LIST_SINGLE_HIT_DAYS = 7;

/** Paden die nooit worden doorverwezen of als 404 geteld (CRM, API, beheerbestanden van de site). */
const RESERVED_PREFIXES = ['/app/', '/api/'];

/**
 * Normaliseert een pad zodat dezelfde pagina altijd dezelfde tekst geeft: procentcodering van tekens als ë, zonder
 * querystring of fragment.
 * @param {string} value Pad, gecodeerd of niet.
 * @returns {string} Genormaliseerd pad, of leeg als het geen geldig pad is.
 */
function normalizePath(value) {
  const text = String(value || '').trim().split(/[?#]/)[0];
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\') || /[\s<>"]/.test(text)) return '';
  let decoded;
  try {
    decoded = decodeURI(text);
  } catch (_) {
    return '';
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return '';
  // `decodeURI` laat gereserveerde codes als %2F staan; zet die na `encodeURI` terug, zodat normaliseren herhaalbaar is.
  const normalized = encodeURI(decoded).replace(/%25([0-9A-Fa-f]{2})/g, (match, hex) => `%${hex.toUpperCase()}`);
  return normalized.length <= MAX_PATH_LENGTH ? normalized : '';
}

/**
 * Of een pad gereserveerd is (CRM of API).
 * @param {string} path Pad.
 * @returns {boolean} Waar als het pad onder `/app/` of `/api/` valt (of precies `/app` of `/api` is), ongeacht hoofdletters.
 */
function isReservedPath(path) {
  // Express routeert hoofdletterongevoelig: `/APP/` is ook het CRM.
  const lower = String(path || '').toLowerCase();
  return RESERVED_PREFIXES.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix));
}

/**
 * Of een (genormaliseerd) pad ruis van scanners is die niet in de 404-lijst hoort: een verborgen map of bestand, een
 * extensie van een andere techniek (PHP, ASP, configuratie) of een bekende beheerroute. Oude WordPress-adressen zoals
 * `/wp-content/uploads/…` en gewone pagina's tellen wel.
 * @param {string} path Genormaliseerd pad.
 * @returns {boolean} Waar als het pad wordt overgeslagen.
 */
function isNoisePath(path) {
  const lower = path.toLowerCase();
  if (lower.split('/').some((segment) => segment.startsWith('.') || segment.startsWith('%2e'))) return true;
  if (NOISE_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}.`))) return true;
  return NOISE_EXTENSIONS.test(lower.replace(/\/+$/, ''));
}

/**
 * Controleert een nieuwe doorverwijzing.
 * @param {{from: *, to: *, status: *}} input Invoer uit het formulier.
 * @returns {{values: {fromPath: string, toUrl: string, status: number}, errors: any}} Schone waarden en fouten per veld.
 */
function validateRedirect(input) {
  const errors = {};
  const fromPath = typeof input.from === 'string' ? normalizePath(input.from) : '';
  if (!fromPath) errors.from = 'Vul een pad in dat met / begint, zonder spaties (de querystring telt niet mee).';
  else if (isReservedPath(fromPath)) errors.from = 'Adressen onder /app/ en /api/ kunnen niet worden doorverwezen.';
  let toUrl = '';
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  if (to.startsWith('/') && !to.startsWith('//')) {
    const [pathPart, ...rest] = to.split('?');
    const path = normalizePath(pathPart);
    const query = rest.join('?');
    if (!path || /[\s<>"#\\]/.test(query)) errors.to = 'Dit pad klopt niet.';
    else toUrl = query ? `${path}?${query}` : path;
  } else if (/^https:\/\//i.test(to)) {
    try {
      const url = new URL(to);
      if (url.username || url.password) errors.to = 'Een adres met een gebruikersnaam of wachtwoord kan niet.';
      else toUrl = url.toString();
    } catch (_) {
      errors.to = 'Dit adres klopt niet.';
    }
  } else {
    errors.to = 'Vul een pad op de site in (begint met /) of een volledig adres dat met https:// begint.';
  }
  if (toUrl.length > 500) errors.to = 'Dit adres is te lang.';
  if (!errors.from && !errors.to && toUrl.split('?')[0] === fromPath) errors.to = 'Het nieuwe adres is gelijk aan het oude.';
  const status = input.status === '302' ? 302 : 301;
  return { values: { fromPath, toUrl, status }, errors };
}

/**
 * Alleen de host van een verwijzende pagina (zonder pad of querystring), en niet als het de eigen site is.
 * @param {string} referrer Waarde van de `Referer`-kop.
 * @param {string} ownHost Host van het verzoek.
 * @returns {string} Host, of leeg.
 */
function referrerHostOf(referrer, ownHost) {
  try {
    const url = new URL(String(referrer || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const host = url.hostname.toLowerCase().slice(0, 100);
    return host && host !== String(ownHost || '').toLowerCase().split(':')[0] ? host : '';
  } catch (_) {
    return '';
  }
}

/**
 * Maakt de laag voor doorverwijzingen en de 404-lijst.
 * @param {{db: any, settings?: any}} options Database en de instellingen (bewaartermijn van de 404-lijst).
 * @returns {any} Functies: `ready`, `reload`, `middleware`, `recordNotFound`, `flush`, `purge`, `forgetKnownNotFound`,
 *   `startTimers`.
 */
function createRedirects(options) {
  const { db } = options;
  /** Doorverwijzingen per genormaliseerd pad. */
  let table = new Map();
  let loading = null;
  /** Gebruik van doorverwijzingen sinds de laatste keer wegschrijven (id → aantal). */
  const pendingHits = new Map();
  /** 404's sinds de laatste keer wegschrijven (pad → {hits, referrerHost}). */
  const pendingNotFound = new Map();
  /** Paden die al in de 404-lijst staan (na de eerste keer wegschrijven); die tellen ook door als het geheugen vol is. */
  let knownNotFound = null;

  /**
   * Leest alle doorverwijzingen in het geheugen.
   * @returns {Promise<void>}
   */
  const reload = async () => {
    const rows = await db.query('SELECT id, from_path, to_url, status FROM redirects');
    table = new Map(rows.map((row) => [row.from_path, { id: row.id, toUrl: row.to_url, status: row.status }]));
  };

  /**
   * Wacht tot de doorverwijzingen één keer zijn geladen; bij een fout probeert het volgende verzoek het opnieuw.
   * @returns {Promise<void>}
   */
  const ready = () => {
    if (!loading) loading = reload().catch((error) => { loading = null; throw error; });
    return loading;
  };

  /**
   * Middleware: stuurt een GET/HEAD op een bekend oud pad door (met de querystring van het verzoek als het doel er
   * zelf geen heeft). Een pad zonder slash aan het eind telt ook met slash.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {Promise<void>}
   */
  const middleware = async (req, res, next) => {
    try {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || isReservedPath(req.path)) return next();
      await ready();
      if (!table.size) return next();
      const path = normalizePath(req.path);
      const match = table.get(path) || (path && !path.endsWith('/') ? table.get(`${path}/`) : undefined);
      if (!match) return next();
      pendingHits.set(match.id, (pendingHits.get(match.id) || 0) + 1);
      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const target = match.toUrl.includes('?') || !query ? match.toUrl : match.toUrl + query;
      // Kort en alleen in de browser: een gecorrigeerde of verwijderde doorverwijzing werkt zo binnen vijf minuten.
      res.set('Cache-Control', match.status === 301 ? 'private, max-age=300' : 'no-store');
      return res.redirect(match.status, target);
    } catch (error) {
      return next(error);
    }
  };

  /**
   * Telt een 404 op de site (in het geheugen; `flush` schrijft weg).
   * @param {any} req Express-verzoek.
   * @returns {void}
   */
  const recordNotFound = (req) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isReservedPath(req.path)) return;
    const path = normalizePath(req.path);
    if (!path || isNoisePath(path)) return;
    const entry = pendingNotFound.get(path);
    if (entry) entry.hits += 1;
    else if (pendingNotFound.size < MAX_PENDING_PATHS || (knownNotFound && knownNotFound.has(path))) {
      pendingNotFound.set(path, { hits: 1, referrerHost: referrerHostOf(req.get('referer'), req.hostname) });
    }
  };

  /**
   * Schrijft de verzamelde tellers weg: gebruik van doorverwijzingen en de 404-lijst (nieuwe paden alleen zolang de
   * lijst onder het maximum zit). Mislukt het, dan gaan de tellers van deze ronde verloren (niet erg: het zijn tellers).
   * @returns {Promise<void>}
   */
  const flush = async () => {
    const hits = [...pendingHits];
    const notFound = [...pendingNotFound];
    pendingHits.clear();
    pendingNotFound.clear();
    if (hits.length) {
      await db.query(
        `UPDATE redirects r SET hits = r.hits + h.hits, last_hit_at = now()
           FROM unnest($1::int[], $2::int[]) AS h(id, hits) WHERE r.id = h.id`,
        [hits.map(([id]) => id), hits.map(([, count]) => count)],
      );
    }
    if (notFound.length) {
      // Bekende paden worden altijd bijgeteld; nieuwe alleen zolang er ruimte is onder het maximum (de vaakst gevraagde eerst).
      if (!knownNotFound) knownNotFound = new Set((await db.query('SELECT path FROM not_found_log')).map((row) => row.path));
      const written = await db.query(
        `WITH input AS (
           SELECT n.path, n.hits, n.referrer_host, n.ord, EXISTS (SELECT 1 FROM not_found_log e WHERE e.path = n.path) AS known
             FROM unnest($1::text[], $2::int[], $3::text[]) WITH ORDINALITY AS n(path, hits, referrer_host, ord)
         ), ranked AS (
           SELECT input.*, row_number() OVER (PARTITION BY known ORDER BY hits DESC, ord) AS rank FROM input
         ), room AS (
           SELECT GREATEST(0, $4 - count(*)) AS free FROM not_found_log
         )
         INSERT INTO not_found_log (path, hits, referrer_host)
           SELECT ranked.path, ranked.hits, ranked.referrer_host FROM ranked, room WHERE ranked.known OR ranked.rank <= room.free
         ON CONFLICT (path) DO UPDATE SET hits = not_found_log.hits + EXCLUDED.hits, last_seen_at = now(),
           referrer_host = CASE WHEN EXCLUDED.referrer_host <> '' THEN EXCLUDED.referrer_host ELSE not_found_log.referrer_host END
         RETURNING path`,
        [notFound.map(([path]) => path), notFound.map(([, entry]) => entry.hits), notFound.map(([, entry]) => entry.referrerHost), MAX_NOT_FOUND_ROWS],
      );
      for (const row of written) knownNotFound.add(row.path);
    }
  };

  /**
   * Ruimt 404-regels op die langer dan de bewaartermijn niet zijn gezien. Is de lijst vol, dan wijken ook regels die
   * maar één keer zijn gevraagd en een week niet meer zijn gezien, zodat eenmalige ruis echte oude adressen niet
   * maandenlang buiten houdt.
   * @returns {Promise<void>}
   */
  const purge = async () => {
    if (options.settings) await options.settings.ready();
    const retentionDays = options.settings ? options.settings.get('notFoundRetentionDays') : NOT_FOUND_RETENTION_DAYS;
    await db.query('DELETE FROM not_found_log WHERE last_seen_at < now() - make_interval(days => $1)', [retentionDays]);
    await db.query(
      `DELETE FROM not_found_log WHERE (SELECT count(*) FROM not_found_log) >= $1
          AND hits <= 1 AND last_seen_at < now() - make_interval(days => $2)`,
      [MAX_NOT_FOUND_ROWS, FULL_LIST_SINGLE_HIT_DAYS],
    );
    knownNotFound = null;
  };

  /**
   * Vergeet welke paden in de 404-lijst staan (na verwijderen of leegmaken in Beheer); de volgende keer wegschrijven
   * leest dat opnieuw.
   * @returns {void}
   */
  const forgetKnownNotFound = () => { knownNotFound = null; };

  /**
   * Start het wegschrijven (elke minuut) en het opruimen (dagelijks). De timers houden het proces niet open.
   * @returns {NodeJS.Timeout[]} De timers.
   */
  const startTimers = () => {
    /**
     * Voert een taak uit en logt een fout zonder gegevens.
     * @param {Function} task Taak.
     * @param {string} label Naam voor het log.
     * @returns {void}
     */
    const run = (task, label) => task().catch((error) => console.error(`${label} mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`));
    run(purge, '404-lijst opruimen');
    return [
      setInterval(() => run(flush, 'Tellers wegschrijven'), 60 * 1000).unref(),
      setInterval(() => run(purge, '404-lijst opruimen'), 24 * 60 * 60 * 1000).unref(),
    ];
  };

  return { ready, reload, middleware, recordNotFound, flush, purge, forgetKnownNotFound, startTimers };
}

module.exports = {
  createRedirects, validateRedirect, normalizePath, isReservedPath, isNoisePath, referrerHostOf,
  MAX_NOT_FOUND_ROWS, MAX_PENDING_PATHS, NOT_FOUND_RETENTION_DAYS, MAX_PATH_LENGTH,
};
