/**
 * Controle voor de livegang (plan P6.3 en P6.5): welke stappen uit `docs/GO-LIVE.md` de app zelf kan nagaan, en welke
 * vaste inhoud nog uit de terugvalbestanden in DATA_DIR komt in plaats van uit het CRM (bevinding F09).
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
 * @returns {object[]} Regels, in de volgorde van het draaiboek.
 */
function settingsChecks(settings, counts) {
  const mfa = settings.get('mfaRequiredFor');
  const siteHost = hostOf(settings.get('siteUrl'));
  const mailReady = filled(settings.get('mailFromAddress')) && (settings.get('mailMode') === 'connector' || filled(settings.get('mailHost')));
  const captchaReady = settings.get('captchaEnabled') === true && filled(settings.get('captchaSiteKey'));
  return [
    checkRow('Mailserver en afzender', mailReady ? 'klaar' : 'open', mailReady ? 'Ingesteld; verstuur een testmail om het te bevestigen.' : 'Geen mailserver of afzender ingesteld: de app verstuurt dan geen mail.', '/app/beheer/mailserver/'),
    checkRow('Meldadres voor de bewaking', filled(settings.get('monitorEmail')) ? 'klaar' : 'open', filled(settings.get('monitorEmail')) ? 'Ingevuld.' : 'Leeg: meldingen gaan naar het adres van kantoor, als dat er is.', '/app/beheer/bewaking/'),
    checkRow('Heartbeat naar een externe dienst', filled(settings.get('monitorHeartbeatUrl')) ? 'klaar' : 'open', filled(settings.get('monitorHeartbeatUrl')) ? 'Ingevuld.' : 'Leeg: niemand merkt het als de hele server uit staat.', '/app/beheer/bewaking/'),
    checkRow('Captcha op de formulieren', captchaReady ? 'klaar' : 'open', captchaReady ? 'Aan met een sitesleutel.' : 'Uit of zonder sitesleutel.', '/app/beheer/captcha/'),
    checkRow('Iedereen met bijzondere gegevens heeft tweestapsverificatie', counts.usersWithout2fa === 0 ? 'klaar' : 'open', counts.usersWithout2fa === 0 ? 'Alle actieve beheerders, kantoormedewerkers en reisleiders hebben het aan.' : `${counts.usersWithout2fa} actieve gebruiker(s) met rol beheerder, kantoor of reisleider zonder tweestapsverificatie.`, '/app/gebruikers/'),
    checkRow('Tweestapsverificatie verplicht', mfa === 'niemand' ? 'open' : 'klaar', mfa === 'niemand' ? 'Nog optioneel; zet het op de dag van de overstap op "Rollen met toegang tot bijzondere gegevens".' : `Verplicht voor: ${mfa}.`, '/app/beheer/tweestaps/'),
    checkRow('Venster voor de reisleider', 'handmatig', `Nu ${settings.get('guideWindowDaysBefore')} dag(en) vóór vertrek tot ${settings.get('guideWindowDaysAfter')} dag(en) na terugkomst; controleer of dit de afspraak met Avanta is.`, '/app/beheer/reisleider/'),
    checkRow('Balk "in ontwikkeling" uit', settings.get('devBannerEnabled') ? 'open' : 'klaar', settings.get('devBannerEnabled') ? 'De balk staat nog bovenaan de publieke site.' : 'Uit.', '/app/beheer/ontwikkeling/'),
    checkRow('Basisadres is het productiedomein', siteHost === PRODUCTION_HOST ? 'klaar' : 'open', siteHost === PRODUCTION_HOST ? `https://${PRODUCTION_HOST}` : `Nu ${siteHost || 'ongeldig'}; zet het op de dag van de overstap op https://${PRODUCTION_HOST}.`, '/app/beheer/zoekmachines/'),
    checkRow('HSTS-preload (na een stabiele periode)', settings.get('hstsPreload') ? 'klaar' : 'later', settings.get('hstsPreload') ? 'Aan; vraag de opname aan op hstspreload.org (stap 4.5).' : 'Uit; pas aanzetten na een stabiele periode in productie, als elk subdomein https heeft (stap 4.5).', '/app/beheer/hsts/'),
    checkRow('Zoekmachines toegelaten (als laatste stap)', settings.get('seoIndexing') ? 'klaar' : 'open', settings.get('seoIndexing') ? 'Aan.' : 'Uit (noindex). Pas aanzetten als de DNS om is en de rooktest goed is.', '/app/beheer/zoekmachines/'),
  ];
}

/**
 * De vaste inhoud: wat al in het CRM staat en wat nog uit `homepage.json` of `site-content.json` komt (F09).
 * @param {object} fixed Gecontroleerde inhoud van `site-content.json` (`normalizeSiteContent`).
 * @param {{homeInCrm: boolean, postTags: number, featuredPosts: number, guides: number, guidesInFile: number}} counts
 *   Uit de database: homepage als blokpagina online, aantal tags, uitgelichte berichten, reisleiders en reisleiders
 *   die nog niet in het CRM worden beheerd.
 * @returns {object[]} Regels.
 */
function contentChecks(fixed, counts) {
  const galleryGuides = [...fixed.guides.values()].filter((guide) => guide.gallery && guide.gallery.length).length;
  const rows = [
    checkRow('Homepage', counts.homeInCrm ? 'klaar' : 'open', counts.homeInCrm ? 'Gepubliceerd als blokpagina in het CRM.' : 'Komt nog uit homepage.json. Zet hem over met "Homepage in blokken" bij Pagina\'s en publiceer hem.', '/app/paginas/'),
    checkRow('Reisleiders', counts.guidesInFile === 0 ? 'klaar' : 'open', counts.guidesInFile === 0 ? `Alle ${counts.guides} reisleider(s) worden in het CRM beheerd.` : `${counts.guidesInFile} van de ${counts.guides} reisleider(s) tonen nog de gegevens uit site-content.json. Open ze in het CRM en sla ze op.`, '/app/reisleiders/'),
  ];
  if (counts.postTags > 0) rows.push(checkRow('Tags van het blog', 'klaar', `${counts.postTags} tag(s) in het CRM.`, '/app/blog/categorieen-en-tags/'));
  else rows.push(checkRow('Tags van het blog', fixed.blogTags.length ? 'open' : 'klaar', fixed.blogTags.length ? `${fixed.blogTags.length} tag(s) komen nog uit site-content.json. Neem ze over bij Categorieën en tags.` : 'Geen tags.', '/app/blog/categorieen-en-tags/'));
  if (counts.featuredPosts > 0) rows.push(checkRow('Uitgelicht bericht', 'klaar', 'Gekozen in het CRM.', '/app/blog/'));
  else rows.push(checkRow('Uitgelicht bericht', fixed.featuredPost ? 'open' : 'klaar', fixed.featuredPost ? 'Komt nog uit site-content.json. Kies een uitgelicht bericht in het blog.' : 'Geen uitgelicht bericht.', '/app/blog/'));
  rows.push(
    checkRow('Koppen van de lijstpagina\'s', 'later', 'De koppen van Reizen, Reisleiders, Blog, FAQ en Aanmelden komen uit site-content.json (of de standaardteksten); er is nog geen plek in het CRM.', ''),
    checkRow('Volgorde en galerij van reisleiders', fixed.guideOrder.length || galleryGuides ? 'later' : 'klaar', fixed.guideOrder.length || galleryGuides ? `Volgorde (${fixed.guideOrder.length} reisleider(s)) en galerij (${galleryGuides} reisleider(s)) komen uit site-content.json.` : 'Niets meer uit het bestand.', ''),
    checkRow('Fotogalerijen onder berichten en pagina\'s', fixed.galleries.size ? 'later' : 'klaar', fixed.galleries.size ? `${fixed.galleries.size} galerij(en) komen uit site-content.json.` : 'Niets meer uit het bestand.', ''),
  );
  return rows;
}

/**
 * Haalt de aantallen voor beide controles in één ronde uit de database.
 * @param {{query: Function}} db Database.
 * @returns {Promise<{usersWithout2fa: number, homeInCrm: boolean, postTags: number, featuredPosts: number, guides: number, guidesInFile: number}>}
 *   Aantallen.
 */
async function loadCounts(db) {
  const [row] = await db.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE active AND role = ANY($1::text[]) AND totp_enabled_at IS NULL) AS "usersWithout2fa",
       EXISTS (SELECT 1 FROM pages WHERE path = '/' AND managed_in_crm AND published) AS "homeInCrm",
       (SELECT count(*)::int FROM post_terms WHERE kind = 'tag') AS "postTags",
       (SELECT count(*)::int FROM posts WHERE featured) AS "featuredPosts",
       (SELECT count(*)::int FROM guides) AS guides,
       (SELECT count(*)::int FROM guides WHERE NOT managed_in_crm) AS "guidesInFile"`,
    [SPECIAL_DATA_ROLES],
  );
  return row;
}

/**
 * Voert de hele controle uit.
 * @param {{db: {query: Function}, settings: {get: Function}, siteContent: {load: Function}}} options Database,
 *   instellingen en de lezer van `site-content.json`.
 * @returns {Promise<{settings: object[], content: object[], open: number}>} Regels per blok en het aantal open regels.
 */
async function runGoLiveCheck({ db, settings, siteContent }) {
  const counts = await loadCounts(db);
  const result = { settings: settingsChecks(settings, counts), content: contentChecks(siteContent.load(), counts) };
  result.open = [...result.settings, ...result.content].filter((row) => row.state === 'open').length;
  return result;
}

module.exports = { runGoLiveCheck, settingsChecks, contentChecks, SPECIAL_DATA_ROLES, PRODUCTION_HOST };
