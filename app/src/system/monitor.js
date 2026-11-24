/**
 * Bewaking (Beheer > Systeem > Bewaking): elke vijf minuten een reeks controles (back-up, kopie op Google Drive,
 * hersteltest, mail, schijfruimte, fouten in de app, laatste update). Een controle die niet in orde is opent een
 * incident in `monitor_incidents` (hoogstens één open per controle); is ze weer in orde, dan wordt het incident gesloten.
 * Nieuwe, verergerde en gesloten incidenten gaan in één melding per ronde naar het meldadres en de webhook, en zolang er
 * iets open staat volgt een herinnering (instelbaar). De heartbeat-URL wordt aangeroepen zolang er geen ernstig incident
 * open staat: blijft die aanroep weg, dan alarmeert de externe dienst (ook als de hele server plat ligt).
 *
 * Meldingen bevatten nooit persoonsgegevens, adressen of tokens: alleen eigen teksten en de al geschoonde meldingen van
 * de back-up, Drive en de mailer. Webhook- en heartbeat-URL staan versleuteld (`type: 'secret'`) en komen nergens in
 * logboek of uitvoer.
 */
const fs = require('node:fs');
const { formatDateTime } = require('../crm/layout');
const { renderMail } = require('../mail/layout');
const { safeRequest } = require('../security/safe-request');

/** De controles in vaste volgorde. */
const CHECKS = [
  { key: 'back-up', label: 'Back-up' },
  { key: 'google-drive', label: 'Kopie op Google Drive' },
  { key: 'hersteltest', label: 'Hersteltest' },
  { key: 'mail', label: 'Mail versturen' },
  { key: 'schijf', label: 'Schijfruimte' },
  { key: 'fouten', label: 'Fouten in de app' },
  { key: 'update', label: 'Laatste update' },
];
const CHECK_LABELS = Object.fromEntries(CHECKS.map((check) => [check.key, check.label]));
/** Hoe vaak de bewaking draait, en de eerste keer na het starten. */
const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
/** Gesloten incidenten blijven een jaar bewaard. */
const RETENTION_DAYS = 365;
/** Hoeveel meldingen het overzicht onthoudt. */
const RECENT_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Maakt een uitkomst van een controle.
 * @param {('ok'|'warn'|'error'|'uit')} state Uitkomst (`uit` = niet van toepassing).
 * @param {string} message Uitleg in gewone taal.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function outcome(state, message) {
  // eslint-disable-next-line no-control-regex
  return { state, message: String(message || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300) };
}

/**
 * Tijdstip als getal, of NaN.
 * @param {string} value ISO-tijdstip.
 * @returns {number} Milliseconden.
 */
function timeOf(value) {
  return value ? Date.parse(value) : NaN;
}

/**
 * Controle van de back-ups: de laatste geslaagde is niet ouder dan de drempel en de laatste poging is gelukt.
 * @param {object} sources Bronnen (zie `createMonitor`).
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkBackup({ backups, settings, now, startedAt }) {
  if (!backups || !backups.available() || !settings.get('backupEnabled')) return outcome('uit', 'Automatische back-ups staan uit.');
  const maxHours = settings.get('monitorBackupMaxHours');
  const status = backups.status();
  const newest = backups.list()[0];
  const lastOk = Math.max(timeOf(status.lastOkAt) || 0, newest ? timeOf(newest.createdAt) || 0 : 0);
  if (!lastOk) {
    if (now - startedAt < maxHours * HOUR_MS) return outcome('ok', 'Nog geen back-up; de eerste volgt op het ingestelde uur.');
    return outcome('error', 'Er is nog geen enkele back-up gemaakt.');
  }
  if (now - lastOk > maxHours * HOUR_MS) return outcome('error', `De laatste geslaagde back-up is van ${formatDateTime(new Date(lastOk))}, langer dan ${maxHours} uur geleden.`);
  if (status.lastRun && !status.lastRun.ok && timeOf(status.lastRun.at) > lastOk) {
    return outcome('warn', `De laatste back-up is mislukt (${formatDateTime(status.lastRun.at)})${status.lastRun.message ? `: ${status.lastRun.message}` : '.'}`);
  }
  return outcome('ok', `Laatste back-up: ${formatDateTime(new Date(lastOk))}.`);
}

/**
 * Controle van de kopie op Google Drive (alleen als die aan staat).
 * @param {object} sources Bronnen.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkDrive({ drive, settings, now }) {
  if (!drive || !settings.get('driveEnabled')) return outcome('uit', 'De kopie naar Google Drive staat uit.');
  if (!drive.connected()) return outcome('warn', 'De kopie naar Google Drive staat aan, maar de koppeling is niet gemaakt.');
  const state = drive.state();
  if (state.needsReconnect) return outcome('error', 'De koppeling met Google Drive werkt niet meer; koppel opnieuw onder Back-ups en herstel > Google Drive.');
  const lastOk = timeOf(state.lastOkAt);
  const lastFail = timeOf(state.lastFailAt);
  if (lastFail && (!lastOk || lastFail > lastOk)) {
    const event = state.events.find((entry) => !entry.ok);
    return outcome('warn', `De laatste kopie naar Google Drive is mislukt (${formatDateTime(state.lastFailAt)})${event && event.message ? `: ${event.message}` : '.'}`);
  }
  if (lastOk && now - lastOk > 2 * DAY_MS) return outcome('warn', `De laatste geslaagde kopie naar Google Drive is van ${formatDateTime(state.lastOkAt)}.`);
  return outcome('ok', lastOk ? `Laatste kopie: ${formatDateTime(state.lastOkAt)}.` : 'Gekoppeld; nog geen kopie gemaakt.');
}

/**
 * Controle van de hersteltest op de server (wekelijks) en van de Drive-kopie.
 * @param {object} sources Bronnen.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkRestoreTest({ restoreTests, settings, now }) {
  if (!restoreTests) return outcome('uit', 'Geen hersteltest ingericht.');
  const host = restoreTests.hostRuns().find((run) => run.state !== 'bezig');
  if (!host) return outcome('uit', 'Er is nog geen hersteltest op de server gedraaid.');
  if (host.state === 'mislukt') return outcome('error', `De hersteltest van ${formatDateTime(host.startedAt)} is mislukt${host.message ? `: ${host.message}` : '.'}`);
  if (host.state === 'waarschuwing') return outcome('warn', `De hersteltest van ${formatDateTime(host.startedAt)} gaf een waarschuwing${host.message ? `: ${host.message}` : '.'}`);
  if (now - timeOf(host.startedAt) > 8 * DAY_MS) return outcome('warn', `De laatste hersteltest is van ${formatDateTime(host.startedAt)}, langer dan een week geleden.`);
  if (settings.get('driveEnabled')) {
    const remote = restoreTests.driveRuns().find((run) => run.state !== 'bezig');
    if (remote && remote.state === 'mislukt') return outcome('warn', `De hersteltest van de kopie op Google Drive (${formatDateTime(remote.startedAt)}) is mislukt${remote.message ? `: ${remote.message}` : '.'}`);
  }
  return outcome('ok', `Laatste hersteltest geslaagd: ${formatDateTime(host.startedAt)}.`);
}

/**
 * Controle van het versturen van mail: de laatste verzending sinds de herstart is gelukt.
 * @param {object} sources Bronnen.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkMail({ mailer }) {
  if (!mailer || !mailer.configured()) return outcome('uit', 'Er is geen mailserver ingesteld.');
  const latest = mailer.recent()[0];
  if (!latest) return outcome('ok', 'Sinds de herstart is er nog geen mail verstuurd.');
  if (!latest.ok) return outcome('error', `De laatste mail (${latest.kind}, ${formatDateTime(latest.at)}) is niet verstuurd: ${latest.message}`);
  return outcome('ok', `Laatste mail verstuurd: ${formatDateTime(latest.at)}.`);
}

/**
 * Controle van de vrije ruimte op de schijf van de datamap.
 * @param {object} sources Bronnen.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkDisk({ dataDir, statfs, settings }) {
  const minPercent = settings.get('monitorDiskMinPercent');
  let stats;
  try {
    stats = statfs(dataDir);
  } catch (_) {
    return outcome('warn', 'De vrije schijfruimte is niet te bepalen.');
  }
  const total = Number(stats.blocks) * Number(stats.bsize);
  const free = Number(stats.bavail) * Number(stats.bsize);
  if (!total) return outcome('warn', 'De vrije schijfruimte is niet te bepalen.');
  const percent = (free / total) * 100;
  const text = `${percent.toFixed(1).replace('.', ',')}% vrij (${(free / 1024 ** 3).toFixed(1).replace('.', ',')} GB van ${(total / 1024 ** 3).toFixed(1).replace('.', ',')} GB)`;
  if (percent < minPercent) return outcome('error', `Bijna geen schijfruimte meer: ${text}.`);
  if (percent < minPercent * 2) return outcome('warn', `De schijf raakt vol: ${text}.`);
  return outcome('ok', `Schijf: ${text}.`);
}

/**
 * Controle van het aantal fouten in het logboek in het afgelopen uur (zonder de eigen regels van de bewaking).
 * @param {object} sources Bronnen.
 * @returns {Promise<{state: string, message: string}>} De uitkomst.
 */
async function checkErrors({ db, settings, now }) {
  const limit = settings.get('monitorErrorsPerHour');
  if (!limit) return outcome('uit', 'Deze controle staat uit (drempel 0).');
  const [row] = await db.query("SELECT COALESCE(SUM(repeat_count), 0)::int AS count FROM app_logs WHERE level = 'error' AND source <> 'bewaking' AND created_at > $1", [new Date(now - HOUR_MS)]);
  const count = row ? row.count : 0;
  if (count >= limit) return outcome('warn', `${count} fouten in het afgelopen uur (drempel ${limit}). Zie Systeem > Logboek.`);
  return outcome('ok', count === 1 ? '1 fout in het afgelopen uur.' : `${count} fouten in het afgelopen uur.`);
}

/**
 * Controle van de laatste update vanuit de app.
 * @param {object} sources Bronnen.
 * @returns {{state: string, message: string}} De uitkomst.
 */
function checkUpdate({ systemUpdate }) {
  if (!systemUpdate || !systemUpdate.configured) return outcome('uit', 'Updates vanuit de app zijn niet ingericht.');
  const { status } = systemUpdate.view();
  if (status.state === 'mislukt') return outcome('warn', `De laatste update is mislukt${status.message ? `: ${status.message}` : '.'}`);
  return outcome('ok', status.state === 'idle' ? 'Geen update bezig.' : `Laatste update: ${status.state}.`);
}

/** De controlefuncties per sleutel. */
const CHECK_FUNCTIONS = {
  'back-up': checkBackup,
  'google-drive': checkDrive,
  hersteltest: checkRestoreTest,
  mail: checkMail,
  schijf: checkDisk,
  fouten: checkErrors,
  update: checkUpdate,
};

/**
 * Draait alle controles; een controle die zelf faalt telt als waarschuwing (zonder de foutmelding, die kan iets
 * gevoeligs bevatten).
 * @param {object} sources Bronnen.
 * @returns {Promise<Array<{key: string, label: string, state: string, message: string}>>} De uitkomsten.
 */
async function runChecks(sources) {
  const results = [];
  for (const check of CHECKS) {
    let result;
    try {
      result = await CHECK_FUNCTIONS[check.key](sources);
    } catch (_) {
      result = outcome('warn', 'Deze controle kon niet worden uitgevoerd.');
    }
    results.push({ key: check.key, label: check.label, ...result });
  }
  return results;
}

/**
 * Maakt de bewaking.
 * @param {{db: object, settings: object, mailer?: object, appLog?: object, backups?: object, drive?: object,
 *   restoreTests?: object, systemUpdate?: object, dataDir: string, now?: () => number, statfs?: Function,
 *   request?: Function}} options Database, instellingen, de bronnen van de controles, de datamap en voor tests een
 *   eigen klok, `statfs` en verzendfunctie (standaard `safeRequest`).
 * @returns {object} `run`, `test`, `view`, `incidents`, `start`, `stop`.
 */
function createMonitor(options) {
  const { db, settings } = options;
  const now = options.now || Date.now;
  const request = options.request || safeRequest;
  const sources = {
    db, settings, now: 0, startedAt: now(),
    mailer: options.mailer, backups: options.backups, drive: options.drive, restoreTests: options.restoreTests,
    systemUpdate: options.systemUpdate, dataDir: options.dataDir, statfs: options.statfs || fs.statfsSync,
  };
  let lastChecks = [];
  let lastRunAt = null;
  let lastHeartbeat = null;
  let running = null;
  let timers = [];
  /** Open incidenten en de laatste gesloten, na elke ronde opnieuw gelezen (zodat de pagina niet hoeft te wachten). */
  let cached = { open: [], closed: [] };
  /** Laatste meldingen, nieuwste eerst: `{at, channel, kind, ok, message}` (nooit adressen of URL's). */
  const deliveries = [];

  /**
   * Schrijft een regel in het logboek (als dat er is).
   * @param {string} level Niveau.
   * @param {string} message Tekst.
   * @returns {void}
   */
  const log = (level, message) => {
    if (options.appLog) options.appLog.log(level, 'bewaking', message);
  };

  /**
   * Onthoudt een verzonden of mislukte melding.
   * @param {string} channel `mail`, `webhook` of `heartbeat`.
   * @param {string} kind Soort (`incidenten`, `test`, `heartbeat`).
   * @param {boolean} ok Gelukt.
   * @param {string} message Uitleg.
   * @returns {void}
   */
  const remember = (channel, kind, ok, message) => {
    deliveries.unshift({ at: new Date(now()), channel, kind, ok, message: String(message).slice(0, 200) });
    deliveries.length = Math.min(deliveries.length, RECENT_LIMIT);
    if (!ok) log('warn', `Melding via ${channel} mislukt: ${message}`);
  };

  /**
   * Adres van de pagina Bewaking (als het basisadres is ingesteld).
   * @returns {string} Volledig adres of leeg.
   */
  const pageUrl = () => {
    const base = settings.get('siteUrl');
    return base ? `${base.replace(/\/+$/, '')}/app/beheer/bewaking/` : '';
  };

  /**
   * Verstuurt een melding naar het meldadres en de webhook. Gooit nooit.
   * @param {{kind: string, subject: string, intro: string, items: Array<{status: string, key: string, severity: string, message: string, since: (Date|string)}>}} notice
   *   Soort, onderwerp, inleiding en de incidenten.
   * @returns {Promise<{mail: (boolean|null), webhook: (boolean|null)}>} Per kanaal: gelukt, mislukt of niet ingesteld (null).
   */
  const deliver = async (notice) => {
    const STATUS_TEXT = { geopend: 'Nieuw', verergerd: 'Ernstiger', herinnering: 'Nog open', opgelost: 'Opgelost', test: 'Test' };
    const lines = notice.items.map((item) => `${STATUS_TEXT[item.status] || item.status}: ${CHECK_LABELS[item.key] || item.key}: ${item.message}`);
    const link = pageUrl();
    const result = { mail: null, webhook: null };
    const to = settings.get('monitorEmail') || settings.get('notifyEmail');
    if (to && options.mailer && options.mailer.configured()) {
      try {
        const rendered = renderMail({
          headerColor: settings.get('mailHeaderColor'), footerText: settings.get('mailFooterText'), siteName: settings.get('siteName'),
          title: notice.subject,
          intro: notice.intro,
          rows: notice.items.map((item) => [`${STATUS_TEXT[item.status] || item.status}: ${CHECK_LABELS[item.key] || item.key}`, `${item.message} (sinds ${formatDateTime(item.since)})`]),
          body: link ? `Bekijk de stand in Beheer: ${link}` : 'Bekijk de stand in Beheer > Systeem > Bewaking.',
        });
        await options.mailer.send({ kind: 'bewaking', to, subject: notice.subject, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
        result.mail = true;
        remember('mail', notice.kind, true, 'Verstuurd.');
      } catch (error) {
        result.mail = false;
        remember('mail', notice.kind, false, error.code === 'not_configured' ? 'Geen mailserver ingesteld.' : 'Versturen mislukt; zie E-mail > Mailserver.');
      }
    }
    const webhook = settings.get('monitorWebhookUrl');
    if (webhook) {
      const text = `${notice.subject}\n${lines.join('\n')}${link ? `\n${link}` : ''}`.slice(0, 1900);
      try {
        const response = await request(webhook, {
          json: {
            source: 'avanta-reizen', site: settings.get('siteName'), event: notice.kind, at: new Date(now()).toISOString(),
            text, content: text,
            incidents: notice.items.map((item) => ({ check: item.key, label: CHECK_LABELS[item.key] || item.key, status: item.status, severity: item.severity, message: item.message, since: new Date(item.since).toISOString() })),
          },
        });
        result.webhook = response.status >= 200 && response.status < 300;
        remember('webhook', notice.kind, result.webhook, result.webhook ? `Afgeleverd (HTTP ${response.status}).` : `Geweigerd (HTTP ${response.status}).`);
      } catch (error) {
        result.webhook = false;
        remember('webhook', notice.kind, false, error.code ? `${error.message}` : 'Versturen mislukt.');
      }
    }
    return result;
  };

  /**
   * Roept de heartbeat-URL aan. Gooit nooit.
   * @returns {Promise<(boolean|null)>} Gelukt, mislukt of niet ingesteld (null).
   */
  const heartbeat = async () => {
    const url = settings.get('monitorHeartbeatUrl');
    if (!url) return null;
    try {
      const response = await request(url, { method: 'GET' });
      const ok = response.status >= 200 && response.status < 300;
      lastHeartbeat = { at: new Date(now()), ok, message: ok ? `HTTP ${response.status}` : `Geweigerd (HTTP ${response.status})` };
    } catch (error) {
      lastHeartbeat = { at: new Date(now()), ok: false, message: error.code ? error.message : 'Niet bereikbaar.' };
    }
    if (!lastHeartbeat.ok) log('warn', `Heartbeat mislukt: ${lastHeartbeat.message}`);
    return lastHeartbeat.ok;
  };

  /**
   * Eén ronde: controles, incidenten openen/bijwerken/sluiten, melden, heartbeat en opschonen.
   * @returns {Promise<{checks: object[], notified: number}>} De uitkomsten en het aantal gemelde incidenten.
   */
  const runOnce = async () => {
    await settings.ready();
    const at = now();
    const checks = await runChecks({ ...sources, now: at });
    lastChecks = checks;
    lastRunAt = new Date(at);
    if (!settings.get('monitorEnabled')) {
      cached = await incidents();
      return { checks, notified: 0 };
    }
    const atDate = new Date(at);
    const repeatMs = settings.get('monitorRepeatHours') * HOUR_MS;
    const items = [];
    const toMark = [];
    for (const check of checks) {
      if (check.state === 'warn' || check.state === 'error') {
        const [previous] = await db.query('SELECT id, severity FROM monitor_incidents WHERE check_key = $1 AND resolved_at IS NULL', [check.key]);
        const [incident] = await db.query(`INSERT INTO monitor_incidents (check_key, severity, message, opened_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)
          ON CONFLICT (check_key) WHERE resolved_at IS NULL DO UPDATE SET severity = EXCLUDED.severity, message = EXCLUDED.message, last_seen_at = EXCLUDED.last_seen_at
          RETURNING id, opened_at, notified_at`, [check.key, check.state, check.message, atDate]);
        let status = '';
        if (!incident.notified_at) status = 'geopend';
        else if (previous && previous.severity === 'warn' && check.state === 'error') status = 'verergerd';
        else if (repeatMs && at - Date.parse(incident.notified_at) >= repeatMs) status = 'herinnering';
        if (status) {
          items.push({ status, key: check.key, severity: check.state, message: check.message, since: incident.opened_at });
          toMark.push(incident.id);
        }
        if (!previous) log(check.state === 'error' ? 'error' : 'warn', `Incident geopend: ${check.label}: ${check.message}`);
      } else {
        const closed = await db.query('UPDATE monitor_incidents SET resolved_at = $2 WHERE check_key = $1 AND resolved_at IS NULL RETURNING id, severity, opened_at, notified_at', [check.key, atDate]);
        for (const incident of closed) {
          log('info', `Incident gesloten: ${check.label}`);
          if (incident.notified_at) items.push({ status: 'opgelost', key: check.key, severity: incident.severity, message: check.message, since: incident.opened_at });
        }
      }
    }
    if (items.length) {
      const opened = items.filter((item) => item.status !== 'opgelost').length;
      const solved = items.length - opened;
      const parts = [opened ? `${opened} ${opened === 1 ? 'incident' : 'incidenten'}` : '', solved ? `${solved} opgelost` : ''].filter(Boolean);
      await deliver({
        kind: 'incidenten',
        subject: `Bewaking ${settings.get('siteName')}: ${parts.join(', ')}`,
        intro: opened ? 'De bewaking van de website heeft iets gevonden dat aandacht vraagt.' : 'Wat de bewaking eerder meldde, is weer in orde.',
        items,
      });
      // Ook bij een mislukte melding: anders volgt elke vijf minuten een nieuwe poging (de mislukking staat in het logboek).
      if (toMark.length) await db.query('UPDATE monitor_incidents SET notified_at = $2, notify_count = notify_count + 1 WHERE id = ANY($1::bigint[])', [toMark, atDate]);
    }
    const [{ count: openErrors }] = await db.query("SELECT COUNT(*)::int AS count FROM monitor_incidents WHERE resolved_at IS NULL AND severity = 'error'");
    if (!openErrors) await heartbeat();
    await db.query('DELETE FROM monitor_incidents WHERE resolved_at < $1', [new Date(at - RETENTION_DAYS * DAY_MS)]);
    cached = await incidents();
    return { checks, notified: items.length };
  };

  /**
   * Draait een ronde, of wacht op de lopende.
   * @returns {Promise<{checks: object[], notified: number}>} De uitkomst.
   */
  const run = () => {
    if (!running) running = runOnce().finally(() => { running = null; });
    return running;
  };

  /**
   * Verstuurt een testmelding naar alle ingestelde kanalen en roept de heartbeat aan.
   * @returns {Promise<{mail: (boolean|null), webhook: (boolean|null), heartbeat: (boolean|null)}>} Per kanaal de uitkomst.
   */
  const test = async () => {
    await settings.ready();
    const result = await deliver({
      kind: 'test',
      subject: `Bewaking ${settings.get('siteName')}: testmelding`,
      intro: 'Dit is een testmelding vanuit Beheer > Systeem > Bewaking. Komt deze aan, dan werken de meldingen.',
      items: [{ status: 'test', key: 'test', severity: 'warn', message: 'Testmelding.', since: new Date(now()) }],
    });
    return { ...result, heartbeat: await heartbeat() };
  };

  /**
   * De stand voor de pagina.
   * @returns {{enabled: boolean, lastRunAt: (Date|null), checks: object[], deliveries: object[], heartbeat: (object|null), open: object[], closed: object[]}}
   *   De stand, met de incidenten van de laatste ronde.
   */
  const view = () => ({
    enabled: settings.get('monitorEnabled'),
    lastRunAt,
    open: cached.open.map((incident) => ({ ...incident })),
    closed: cached.closed.map((incident) => ({ ...incident })),
    checks: lastChecks.map((check) => ({ ...check })),
    deliveries: deliveries.map((entry) => ({ ...entry })),
    heartbeat: lastHeartbeat ? { ...lastHeartbeat } : null,
  });

  /**
   * Open incidenten en de laatste gesloten.
   * @param {number} [limit] Hoeveel gesloten incidenten (standaard 30).
   * @returns {Promise<{open: object[], closed: object[]}>} De incidenten.
   */
  const incidents = async (limit = 30) => {
    const open = await db.query('SELECT id, check_key, severity, message, opened_at, last_seen_at, notified_at, notify_count FROM monitor_incidents WHERE resolved_at IS NULL ORDER BY opened_at DESC');
    const closed = await db.query('SELECT id, check_key, severity, message, opened_at, resolved_at, notify_count FROM monitor_incidents WHERE resolved_at IS NOT NULL ORDER BY opened_at DESC LIMIT $1', [limit]);
    return { open, closed };
  };

  /**
   * Draait een ronde zonder te gooien (voor de timer).
   * @returns {Promise<void>}
   */
  const safeRun = () => run().then(() => {}, () => log('error', 'Ronde van de bewaking mislukt.'));

  /**
   * Start de planner: na een minuut de eerste ronde, daarna elke vijf minuten.
   * @returns {void}
   */
  const start = () => {
    if (timers.length) return;
    timers = [setTimeout(safeRun, FIRST_RUN_MS).unref(), setInterval(safeRun, INTERVAL_MS).unref()];
  };

  /**
   * Stopt de planner.
   * @returns {void}
   */
  const stop = () => {
    clearTimeout(timers[0]);
    clearInterval(timers[1]);
    timers = [];
  };

  return { run, test, view, incidents, start, stop };
}

module.exports = { createMonitor, runChecks, CHECKS, CHECK_LABELS, INTERVAL_MS, RETENTION_DAYS };
