// @ts-check
/**
 * Controle voor de livegang (plan P6.3 en P6.5): welke stappen uit `docs/GO-LIVE.md` de app zelf kan nagaan, en of de
 * vaste inhoud van de huidige site in het CRM staat (bevinding F09, W28: overgezet en de homepage gepubliceerd).
 *
 * Elke controle geeft een regel met een stand:
 * - `klaar`: in orde voor de livegang;
 * - `open`: moet nog vóór (of op) de dag van de overstap;
 * - `handmatig`: de app kan het niet beoordelen, controleer het zelf (bijv. of het venster de afspraak met Avanta is);
 * - `later`: nog geen plek in het CRM; wordt in een later pakket opgeruimd en blokkeert de livegang niet.
 *
 * Alleen lezen: geen wijzigingen, geen persoonsgegevens (alleen aantallen en instellingen zonder geheimen).
 */

/** Rollen met toegang tot bijzondere gegevens (gelijk aan de keuze `gegevens` bij tweestapsverificatie). */
const SPECIAL_DATA_ROLES = ['beheerder', 'kantoor', 'reisleider'];

/** Het productiedomein van de site. */
const PRODUCTION_HOST = 'www.avantareizen.nl';

const { TRANSFER_PARTS } = require('../site/content-transfer');

/**
 * Maakt een regel van de controle.
 * @param {string} label Wat er gecontroleerd wordt.
 * @param {('klaar'|'open'|'handmatig'|'later')} state Stand.
 * @param {string} detail Uitleg bij de stand (gewone tekst).
 * @param {string} href Waar je het regelt (pad in het CRM).
 * @returns {{label: string, state: string, detail: string, href: string}} Regel.
 */
function checkRow(label, state, detail, href) {
  return { label, state, detail, href };
}

/**
 * Maakt een regel die klaar is of niet, met een eigen uitleg voor beide gevallen.
 * @param {{label: string, ready: boolean, readyText: string, openText: string, href: string, notReady?: ('open'|'later')}} row
 *   Wat er gecontroleerd wordt, of het klaar is, de uitleg bij klaar en bij niet klaar, waar je het regelt en de stand
 *   als het niet klaar is (standaard `open`).
 * @returns {{label: string, state: string, detail: string, href: string}} Regel.
 */
function readinessRow({ label, ready, readyText, openText, href, notReady = 'open' }) {
  return checkRow(label, ready ? 'klaar' : notReady, ready ? readyText : openText, href);
}

/**
 * Of een https-adres is ingevuld.
 * @param {*} value Waarde van een instelling.
 * @returns {boolean} Waar als het een niet-lege tekst is.
 */
function filled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * De hostnaam van een adres, of een lege tekst bij een ongeldig adres.
 * @param {string} url Adres.
 * @returns {string} Hostnaam in kleine letters.
 */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * De instellingen voor de livegang (`docs/GO-LIVE.md` §1 en §2), beoordeeld op de huidige waarden.
 * @param {{get: (key: string) => *}} settings Instellingen (synchroon geladen).
 * @param {{usersWithout2fa: number}} counts Aantal actieve gebruikers met bijzondere gegevens zonder tweestapsverificatie.
 * @returns {any[]} Regels, in de volgorde van het draaiboek.
 */
function settingsChecks(settings, counts) {
  const mfa = settings.get('mfaRequiredFor');
  const siteHost = hostOf(settings.get('siteUrl'));
  const mailReady = filled(settings.get('mailFromAddress')) && (settings.get('mailMode') === 'connector' || filled(settings.get('mailHost')));
  const captchaReady = settings.get('captchaEnabled') === true && filled(settings.get('captchaSiteKey'));
  return [
    readinessRow({ label: 'Mailserver en afzender', ready: mailReady, readyText: 'Ingesteld; verstuur een testmail om het te bevestigen.', openText: 'Geen mailserver of afzender ingesteld: de app verstuurt dan geen mail.', href: '/app/beheer/mailserver/' }),
    readinessRow({ label: 'Meldadres voor de bewaking', ready: filled(settings.get('monitorEmail')), readyText: 'Ingevuld.', openText: 'Leeg: meldingen gaan naar het adres van kantoor, als dat er is.', href: '/app/beheer/bewaking/' }),
    readinessRow({ label: 'Heartbeat naar een externe dienst', ready: filled(settings.get('monitorHeartbeatUrl')), readyText: 'Ingevuld.', openText: 'Leeg: niemand merkt het als de hele server uit staat.', href: '/app/beheer/bewaking/' }),
    readinessRow({ label: 'Captcha op de formulieren', ready: captchaReady, readyText: 'Aan met een sitesleutel.', openText: 'Uit of zonder sitesleutel.', href: '/app/beheer/captcha/' }),
    readinessRow({ label: 'Iedereen met bijzondere gegevens heeft tweestapsverificatie', ready: counts.usersWithout2fa === 0, readyText: 'Alle actieve beheerders, kantoormedewerkers en reisleiders hebben het aan.', openText: `${counts.usersWithout2fa} actieve gebruiker(s) met rol beheerder, kantoor of reisleider zonder tweestapsverificatie.`, href: '/app/gebruikers/' }),
    readinessRow({ label: 'Tweestapsverificatie verplicht', ready: mfa !== 'niemand', readyText: `Verplicht voor: ${mfa}.`, openText: 'Nog optioneel; zet het op de dag van de overstap op "Rollen met toegang tot bijzondere gegevens".', href: '/app/beheer/tweestaps/' }),
    checkRow('Venster voor de reisleider', 'handmatig', `Nu ${settings.get('guideWindowDaysBefore')} dag(en) vóór vertrek tot ${settings.get('guideWindowDaysAfter')} dag(en) na terugkomst; controleer of dit de afspraak met Avanta is.`, '/app/beheer/reisleider/'),
    readinessRow({ label: 'Balk "in ontwikkeling" uit', ready: !settings.get('devBannerEnabled'), readyText: 'Uit.', openText: 'De balk staat nog bovenaan de publieke site.', href: '/app/beheer/ontwikkeling/' }),
    readinessRow({ label: 'Basisadres is het productiedomein', ready: siteHost === PRODUCTION_HOST, readyText: `https://${PRODUCTION_HOST}`, openText: `Nu ${siteHost || 'ongeldig'}; zet het op de dag van de overstap op https://${PRODUCTION_HOST}.`, href: '/app/beheer/zoekmachines/' }),
    readinessRow({ label: 'HSTS-preload (na een stabiele periode)', ready: Boolean(settings.get('hstsPreload')), readyText: 'Aan; vraag de opname aan op hstspreload.org (stap 4.5).', openText: 'Uit; pas aanzetten na een stabiele periode in productie, als elk subdomein https heeft (stap 4.5).', href: '/app/beheer/hsts/', notReady: 'later' }),
    readinessRow({ label: 'Zoekmachines toegelaten (als laatste stap)', ready: Boolean(settings.get('seoIndexing')), readyText: 'Aan.', openText: 'Uit (noindex). Pas aanzetten als de DNS om is en de rooktest goed is.', href: '/app/beheer/zoekmachines/' }),
  ];
}

/**
 * De vaste inhoud (F09, W28): alles staat in het CRM; de app controleert of het eenmalig overzetten uit
 * `site-content.json` en `homepage.json` is gebeurd en of de homepage als blokpagina online staat.
 * @param {{homeInCrm: boolean, transfersDone: number}} counts Uit de database: homepage als blokpagina online en het
 *   aantal overgezette delen (`content_transfers`).
 * @returns {any[]} Regels.
 */
function contentChecks(counts) {
  const transferred = counts.transfersDone >= TRANSFER_PARTS.length;
  return [
    checkRow('Homepage', counts.homeInCrm ? 'klaar' : 'open', counts.homeInCrm ? 'Gepubliceerd als blokpagina in het CRM.' : 'Staat offline of ontbreekt; de site toont dan de vaste homepage met de standaardteksten. Publiceer hem bij Pagina\'s.', '/app/paginas/'),
    checkRow('Vaste inhoud van de huidige site overgezet', transferred ? 'klaar' : 'open', transferred ? 'Koppen van de lijstpagina\'s, reisleiders (met volgorde en galerij), tags, uitgelicht bericht, fotogalerijen en homepage staan in het CRM.' : `${counts.transfersDone} van de ${TRANSFER_PARTS.length} delen overgezet. De rest gebeurt bij de volgende start van de app, zodra site-content.json en homepage.json in de datamap staan.`, '/app/lijstpaginas/'),
  ];
}

/**
 * Haalt de aantallen voor beide controles in één ronde uit de database.
 * @param {{query: Function}} db Database.
 * @returns {Promise<{usersWithout2fa: number, homeInCrm: boolean, transfersDone: number}>}
 *   Aantallen.
 */
async function loadCounts(db) {
  const [row] = await db.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE active AND role = ANY($1::text[]) AND totp_enabled_at IS NULL) AS "usersWithout2fa",
       EXISTS (SELECT 1 FROM pages WHERE path = '/' AND managed_in_crm AND published) AS "homeInCrm",
       (SELECT count(*)::int FROM content_transfers WHERE part = ANY($2::text[])) AS "transfersDone"`,
    [SPECIAL_DATA_ROLES, TRANSFER_PARTS],
  );
  return row;
}

/**
 * Voert de hele controle uit.
 * @param {{db: {query: Function}, settings: {get: (key: string) => any}}} options Database en instellingen.
 * @returns {Promise<{settings: any[], content: any[], open: number}>} Regels per blok en het aantal open regels.
 */
async function runGoLiveCheck({ db, settings }) {
  const counts = await loadCounts(db);
  const result = { settings: settingsChecks(settings, counts), content: contentChecks(counts) };
  const open = [...result.settings, ...result.content].filter((row) => row.state === 'open').length;
  return { ...result, open };
}

module.exports = { runGoLiveCheck, settingsChecks, contentChecks, SPECIAL_DATA_ROLES, PRODUCTION_HOST };
