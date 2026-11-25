// @ts-check
/**
 * Onderhoudsmodus: zolang die aan staat weigert de server schrijfverzoeken (503 met Retry-After), zodat er tijdens het
 * wisselen van de container of tijdens onderhoud niets half wordt opgeslagen. Lezen blijft werken; de layouts tonen
 * een balk (via de verzoekcontext, `system/request-context.js`).
 *
 * Twee bronnen:
 * - de host tijdens een uitrol (`maintenance.json`, zie `system/system-update.js`): alleen inloggen en uitloggen werken;
 * - de beheerder met de hand (instelling `maintenanceMode`, Beheer > Systeem > Updates): dan werkt ook de knop om de
 *   onderhoudsmodus weer uit te zetten.
 */
const { html } = require('../site/html');
const { renderPage, renderPageHeader } = require('../site/layout');
const { sendApiError } = require('../api/errors');

/** Paden waar een schrijfverzoek altijd mag (sessie beginnen of beëindigen, zodat de beheerder kan blijven volgen). */
const ALWAYS_OPEN = ['/app/inloggen/', '/app/uitloggen/'];
/** Paden die alleen bij handmatig onderhoud open blijven: het uitzetten zelf. */
const MANUAL_OPEN = ['/app/beheer/updates/onderhoud/'];

/** Standaardtekst van de balk en de foutpagina. */
const DEFAULT_MESSAGE = 'Er wordt onderhoud uitgevoerd. Versturen en opslaan kan even niet; probeer het over een paar minuten opnieuw.';
const UPDATE_MESSAGE = 'Er wordt een update geïnstalleerd. Versturen en opslaan kan even niet; probeer het over een minuut opnieuw.';

/**
 * De huidige onderhoudsstand.
 * @param {{settings: any, systemUpdate: any}} sources Instellingen en de koppeling met het hostscript.
 * @returns {{active: boolean, source: (''|'update'|'handmatig'), message: string}} De stand.
 */
function maintenanceState({ settings, systemUpdate }) {
  if (systemUpdate.hostMaintenance().active) return { active: true, source: 'update', message: UPDATE_MESSAGE };
  if (settings.get('maintenanceMode') === true) return { active: true, source: 'handmatig', message: settings.get('maintenanceMessage') || DEFAULT_MESSAGE };
  return { active: false, source: '', message: '' };
}

/**
 * Middleware die schrijfverzoeken weigert tijdens onderhoud. Elk antwoord krijgt dan de kop `X-Avanta-Maintenance`.
 * @param {(req: any) => any} stateOf Geeft de stand voor dit verzoek (al berekend door de contextmiddleware).
 * @returns {Function} Express-middleware.
 */
function maintenanceGuard(stateOf) {
  return (req, res, next) => {
    const state = stateOf(req);
    if (!state.active) return next();
    res.set('X-Avanta-Maintenance', state.source);
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    // Express routeert ook zonder afsluitende slash (en hoofdletterongevoelig): vergelijk genormaliseerd.
    const lowerPath = req.path.toLowerCase().replace(/\/?$/, '/');
    if (ALWAYS_OPEN.includes(lowerPath)) return next();
    if (state.source === 'handmatig' && MANUAL_OPEN.includes(lowerPath)) return next();
    res.set({ 'Retry-After': '60', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    // De JSON-API van het CRM krijgt het foutformaat van de API, met de melding van het onderhoud.
    if (lowerPath.startsWith('/app/api/')) return sendApiError(res, 'onderhoud', { message: state.message });
    return res.status(503).send(renderPage({
      title: 'Even geduld',
      path: req.path,
      site: res.locals.site,
      header: renderPageHeader({ title: 'Even geduld' }),
      body: html`<div class="container section"><p>${state.message}</p></div>`,
    }));
  };
}

module.exports = { maintenanceState, maintenanceGuard, DEFAULT_MESSAGE, UPDATE_MESSAGE, ALWAYS_OPEN, MANUAL_OPEN };
