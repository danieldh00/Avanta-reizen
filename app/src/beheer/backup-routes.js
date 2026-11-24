// @ts-check
/**
 * Extra's van Beheer > Back-ups en herstel > Back-ups (recht `systeem`): status van de laatste back-up, *Nu maken*, de
 * lijst met back-ups en downloaden (versleuteld). Maken en downloaden komen in het auditlog. De instellingen (aan/uit,
 * uur, bewaartermijn) staan in het gewone instellingenformulier (`beheer/routes.js`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { createRateLimiter } = require('../security/rate-limit');
const { amsterdamParts } = require('../backup/backups');

/** Omschrijving van de aanleiding van een back-up. */
const TRIGGER_LABELS = { automatisch: 'automatisch', handmatig: 'handmatig', update: 'vóór een update' };

/**
 * Een bestandsgrootte in leesbare eenheden.
 * @param {number} bytes Grootte.
 * @returns {string} Bijvoorbeeld `1,4 MB`.
 */
function formatBytes(bytes) {
  const units = ['bytes', 'kB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} bytes` : `${value.toFixed(1).replace('.', ',')} ${units[unit]}`;
}

/**
 * Wanneer de volgende automatische back-up ongeveer komt.
 * @param {{enabled: boolean, hour: number, now: number, doneToday: boolean}} input Of het aan staat, het uur, nu en of
 *   de back-up van vandaag al gemaakt is.
 * @returns {string} Omschrijving.
 */
function describeNext({ enabled, hour, now, doneToday }) {
  if (!enabled) return 'Automatische back-ups staan uit.';
  const time = `${String(hour).padStart(2, '0')}:00 uur`;
  if (doneToday) return `Morgen rond ${time}.`;
  return amsterdamParts(now).hour < hour ? `Vandaag rond ${time}.` : 'Binnen een kwartier (het uur is al bereikt).';
}

/**
 * De lijst met back-ups op de server, met een downloadlink per bestand.
 * @param {Array<{name: string, createdAt: string, size: number}>} items Back-ups, nieuwste eerst.
 * @returns {any} HTML.
 */
function renderBackupList(items) {
  return html`<h2>Back-ups op de server</h2>
      ${items.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Gemaakt</th><th scope="col">Bestand</th><th scope="col">Grootte</th><th scope="col"><span class="visually-hidden">Downloaden</span></th></tr></thead>
        <tbody>${items.map((item) => html`<tr>
          <td>${formatDateTime(item.createdAt)}</td>
          <td><code>${item.name}</code></td>
          <td>${formatBytes(item.size)}</td>
          <td><a href="/app/beheer/back-ups/download/${item.name}">Downloaden</a></td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">Een download blijft versleuteld; terugzetten staat in het draaiboek (docs/DRAAIBOEK-VPS-VERHUIZING.md). Afbeeldingen (media) zitten niet in de back-up; die zijn opnieuw te importeren.</p>` : html`<p>Er staan nog geen back-ups op de server.</p>`}`;
}

/**
 * Maakt de routes en het paneel van de back-ups.
 * @param {{auth: any, guard: Function, settings: any, backups: any, renderSettingsSection: Function, notFound: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, instellingen, back-updienst (`backup/backups.js`), weergave van een instellingensectie,
 *   de 404 van Beheer en (voor tests) de klok.
 * @returns {{router: express.Router, renderPanel: Function}} Router en paneel (voor onder het formulier).
 */
function createBackupRoutes(options) {
  const { auth, guard, settings, backups } = options;
  const now = options.now || Date.now;
  const router = express.Router();
  // Handmatige back-ups: hoogstens 6 per uur per gebruiker (elke back-up is een volledige dump).
  const createLimiter = createRateLimiter({ limit: 6, windowMs: 60 * 60 * 1000, now: options.now });
  // Downloaden: hoogstens 10 per uur per gebruiker (de hele database, versleuteld).
  const downloadLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000, now: options.now });
  const section = findSection('back-ups');

  /**
   * Het paneel onder het formulier: status, Nu maken en de lijst.
   * @param {any} req Express-verzoek.
   * @param {{result?: {ok: boolean, message: string}}} [state] Uitkomst van *Nu maken*.
   * @returns {any} HTML.
   */
  const renderPanel = (req, state = {}) => {
    if (!backups.available()) return html`<h2>Status</h2><p>Back-ups zijn op deze installatie niet beschikbaar (geen databaseverbinding ingesteld).</p>`;
    const items = backups.list();
    const status = backups.status();
    const newest = items[0];
    const today = amsterdamParts(now());
    const hour = settings.get('backupHour');
    const doneToday = items.some((item) => {
      const made = amsterdamParts(Date.parse(item.createdAt));
      return made.date === today.date && made.hour >= hour;
    });
    const failed = status.lastRun && !status.lastRun.ok;
    return html`<h2 id="status">Status</h2>
      ${state.result ? html`<p class="${state.result.ok ? 'notice' : 'form-alert'}" role="${state.result.ok ? 'status' : 'alert'}">${state.result.message}</p>` : ''}
      ${status.running ? html`<p class="notice" role="status">Er wordt nu een back-up gemaakt. Ververs deze pagina over een minuut.</p>` : ''}
      ${!status.running && req.query.gestart === '1' && status.lastRun ? html`<p class="${status.lastRun.ok ? 'notice' : 'form-alert'}" role="${status.lastRun.ok ? 'status' : 'alert'}">${status.lastRun.ok ? `Back-up gemaakt: ${status.lastRun.name}.` : `De back-up is mislukt: ${status.lastRun.message}`}</p>` : ''}
      <div class="crm-table-wrap"><table class="crm-table beheer-facts"><tbody>
        <tr><th scope="row">Laatste back-up</th><td>${newest ? `${formatDateTime(newest.createdAt)} (${formatBytes(newest.size)})` : 'Nog geen'}</td></tr>
        <tr><th scope="row">Laatste poging</th><td>${status.lastRun ? html`${formatDateTime(status.lastRun.at)}, ${TRIGGER_LABELS[status.lastRun.trigger]}: ${status.lastRun.ok ? 'gelukt' : html`<strong>mislukt</strong>: ${status.lastRun.message}`}` : '–'}</td></tr>
        <tr><th scope="row">Volgende automatische</th><td>${describeNext({ enabled: settings.get('backupEnabled'), hour, now: now(), doneToday })}${failed && settings.get('backupEnabled') ? ' Na een mislukte poging wordt het na een uur opnieuw geprobeerd.' : ''}</td></tr>
        <tr><th scope="row">Sleutel-id</th><td><code>${backups.keyId()}</code> <span class="field__help">Vingerafdruk van de hoofdsleutel (geen geheim). Een back-up is alleen te openen met de hoofdsleutel met dit id.</span></td></tr>
      </tbody></table></div>
      <form method="post" action="/app/beheer/back-ups/nu/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <button class="btn btn--outline btn--small" type="submit"${status.running ? raw(' disabled') : ''}>Nu een back-up maken</button>
      </form>
      ${renderBackupList(items)}`;
  };

  // Nu maken: de back-up loopt op de achtergrond (een grote dump kan langer duren dan een verzoek); de pagina toont de
  // status. Een lopende back-up telt niet opnieuw mee voor de limiet. `starting` sluit de tijd tussen de controle en de
  // start af (de auditregel `backup.gestart` komt daartussen), zodat twee gelijktijdige verzoeken er één worden. Na
  // afloop schrijft de route via de service `backup.gemaakt`, met gebruiker en IP-voorvoegsel.
  let starting = false;
  router.post('/beheer/back-ups/nu/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!backups.available()) return options.notFound(req, res);
      if (!backups.status().running && !starting) {
        if (!createLimiter.hit(`gebruiker:${req.user.id}`)) {
          return res.status(429).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Te veel back-ups in korte tijd. Probeer het over een uur opnieuw.' } } }));
        }
        starting = true;
        try {
          await auth.audit(req, { userId: req.user.id, action: 'backup.gestart', entity: 'backup' });
          backups.run({
            trigger: 'handmatig',
            audit: (backup) => auth.audit(req, { userId: req.user.id, action: 'backup.gemaakt', entity: 'backup', entityId: backup.name }),
          }).catch(() => {});
        } finally {
          starting = false;
        }
      }
      return res.redirect(303, '/app/beheer/back-ups/?gestart=1#status');
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/beheer/back-ups/download/:name([a-z0-9.-]{1,60})'), guard, async (req, res, next) => {
    try {
      if (!downloadLimiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).type('text').send('Te veel downloads. Probeer het over een uur opnieuw.');
      const file = backups.fileOf(req.params.name);
      if (!file) return options.notFound(req, res);
      await auth.audit(req, { userId: req.user.id, action: 'backup.gedownload', entity: 'backup', entityId: req.params.name });
      res.set('Cache-Control', 'no-store');
      return res.download(file, req.params.name, { headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (error) {
      return next(error);
    }
  });

  return { router, renderPanel };
}

module.exports = { createBackupRoutes, formatBytes, describeNext };
