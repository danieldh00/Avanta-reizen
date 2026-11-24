// @ts-check
/**
 * De diensten van de app: alles wat één keer wordt aangemaakt en daarna door de routes en de achtergrondtaken wordt
 * gedeeld (instellingen, logboek, mail, back-ups, bewaking, betalingen, …), gegroepeerd per module. `server.js` bouwt
 * de Express-app en koppelt de routes; een nieuwe dienst komt hier bij zijn module, een nieuwe achtergrondtaak in
 * `startBackgroundTasks`.
 */
const path = require('node:path');
const { createVault } = require('./security/vault');
const { createCaptcha } = require('./security/captcha');
const { createPasswordCheck } = require('./security/password-check');
const { createSettings } = require('./beheer/settings');
const { startUpdateSync } = require('./beheer/update-routes');
const { createAppLog } = require('./system/app-log');
const { createSystemUpdate } = require('./system/system-update');
const { createHostTasks } = require('./system/host-tasks');
const { createMonitor } = require('./system/monitor');
const { createRedirects } = require('./site/redirects');
const { createListHeaders } = require('./cms/list-headers');
const { createMenus } = require('./cms/menus');
const { createMediaLibrary } = require('./media/library');
const { createImageFormats } = require('./media/formats');
const { createMailer } = require('./mail/mailer');
const { createWanIp } = require('./mail/wan-ip');
const { createNotifications } = require('./mail/notifications');
const { createBackupService } = require('./backup/backups');
const { createDrive } = require('./backup/drive');
const { createRestoreTests } = require('./backup/restore-test');
const { roleHasRight } = require('./crm/rights');
const { startCrmMaintenance } = require('./crm/auth');
const { createPersons } = require('./persons/persons');
const { createRetention } = require('./persons/retention');
const { createPaymentReminders } = require('./payments/payment-reminders');
const { createMollie } = require('./payments/mollie');
const { createOnlinePayments } = require('./payments/online-payments');
const { createInfobriefSender } = require('./infobrief/sender');
const { createAccounts } = require('./account/accounts');
const { startAccountMaintenance } = require('./account/routes');
const { MEDIA_DIR, DATA_DIR } = require('./paths');

/**
 * Maakt alle diensten aan. Er start hier nog niets op de achtergrond: timers en planners starten pas in
 * `startBackgroundTasks`, zodat de tests een app kunnen bouwen zonder achtergrondwerk.
 * @param {any} options De opties van `createApp` (`server.js`): database, hoofdsleutel en wat de tests vervangen
 *   (eigen instellingen, logboek, mailer, fetch-functies, mappen, klok).
 * @returns {any} De diensten op naam.
 */
function createServices(options) {
  // Platform: kluis, instellingen, logboek, captcha en wachtwoordcontrole.
  // Instellingen uit Beheer: één keer geladen, daarna uit het geheugen (Beheer schrijft het geheugen bij). De opties
  // `indexable` en `siteUrl` (of SITE_INDEXABLE/SITE_URL) zijn alleen de startwaarde; Beheer gaat voor.
  // Na een sleutelrotatie leest de kluis ook met de vorige sleutels (`previousKeys`, security/key-rotation.js).
  const vault = createVault(options.masterKey, { previousKeys: options.previousKeys });
  const startValues = {
    ...process.env,
    SITE_INDEXABLE: options.indexable ? 'true' : 'false',
    SITE_URL: options.siteUrl ?? process.env.SITE_URL ?? '',
  };
  const settings = options.settings || createSettings({ db: options.db, vault, env: startValues });
  const appLog = options.appLog || createAppLog({ db: options.db, settings });
  // Onzichtbare captcha op de formulieren (tests geven een eigen fetch mee voor de controle bij Google).
  const captcha = options.captcha || createCaptcha({ settings, fetchImpl: options.captchaFetch });
  // Controle van nieuwe wachtwoorden op gelekte en veelgebruikte wachtwoorden (CRM en reizigersaccount).
  const passwordCheck = createPasswordCheck({ settings, appLog, fetchImpl: options.passwordCheckFetch, now: options.now });

  // Menu's van de site uit het CRM (`cms/menus.js`), één keer geladen; lukt dat niet, dan toont de site het vaste menu.
  const menus = createMenus({ db: options.db });

  // Updates vanuit de app en servertaken: de gedeelde mappen met het hostscript (leeg = niet ingericht, bijv. lokaal).
  const updateStatusDir = options.updateStatusDir ?? process.env.UPDATE_STATUS_DIR ?? '';
  const systemUpdate = options.systemUpdate || createSystemUpdate({
    statusDir: updateStatusDir, requestDir: options.updateRequestDir ?? process.env.UPDATE_REQUEST_DIR ?? '',
    currentVersion: require('../package.json').version, now: options.now,
  });
  const hostTasks = createHostTasks({ statusDir: updateStatusDir, settings });

  // Doorverwijzingen uit Beheer (oude adressen naar nieuwe).
  const redirects = createRedirects({ db: options.db, settings });

  // Afbeeldingen: import en fotobibliotheek (tests geven een eigen map mee).
  const mediaDir = options.mediaDir || MEDIA_DIR;
  const mediaLibrary = createMediaLibrary({ db: options.db, mediaDir, appLog });
  // Lichtere formaten (WebP in vaste breedtes, kleinere JPEG) van importfoto's, en de index voor `srcset`.
  const imageFormats = createImageFormats({ db: options.db, mediaDir, appLog });

  // E-mail via de mailserver uit Beheer (tests geven een eigen mailer en WAN-IP-opzoeker mee).
  const mailer = options.mailer || createMailer({ settings });
  const wanIp = options.wanIp || createWanIp();
  const notifications = createNotifications({ mailer, settings, appLog });
  const { drive, backups, restoreTests } = createBackupServices(options, settings);
  // Bewaking (Beheer > Systeem > Bewaking): de planner start pas in `start()`; tests geven een eigen statfs/verzender mee.
  const monitor = createMonitor({
    db: options.db, settings, mailer, appLog, backups, drive, restoreTests, systemUpdate,
    dataDir: options.monitorDataDir || DATA_DIR, now: options.now, statfs: options.statfs, request: options.monitorRequest,
  });
  // AVG-opschoning (Beheer > AVG en bewaartermijnen): de dagelijkse ronde start pas in `start()`.
  const retention = createRetention({ db: options.db, persons: createPersons({ vault }), settings, today: options.retentionToday });
  // Online betalen via Mollie (Beheer > CRM > Online betalen), standaard uit.
  const mollie = createMollie({ settings, fetchImpl: options.mollieFetch });
  const onlinePayments = createOnlinePayments({ db: options.db, settings, mollie, masterKey: options.masterKey, previousKeys: options.previousKeys, appLog, now: options.now });
  // Betaalherinneringen (Beheer > CRM > Betalingen): de dagelijkse ronde start pas in `start()`.
  const paymentReminders = createPaymentReminders({ db: options.db, mailer, settings, onlinePayments, now: options.now });
  // Infobrief aan de deelnemers van een vertrek: versturen in de achtergrond; de rondes starten pas in `start()`.
  const infobriefSender = options.infobriefSender || createInfobriefSender({ db: options.db, mailer, settings, persons: createPersons({ vault }), now: options.now });

  // Koppen van de lijstpagina's (W28): uit de database, in het geheugen voor de site (`listHeaders.get`).
  const listHeaders = createListHeaders({ db: options.db });
  // Reizigersaccounts onder /account/ (eigen sessies, los van het CRM).
  const accounts = createAccounts({ db: options.db });

  return {
    vault, settings, appLog, captcha, passwordCheck, menus, systemUpdate, hostTasks, redirects, mediaDir, mediaLibrary, imageFormats,
    mailer, wanIp, notifications, drive, backups, restoreTests, monitor, retention, onlinePayments, paymentReminders,
    infobriefSender, listHeaders, accounts,
  };
}

/**
 * Maakt de diensten voor back-ups aan: Google Drive, de back-ups zelf en de hersteltest.
 * @param {any} options De opties van `createServices`.
 * @param {any} settings De instellingen uit Beheer.
 * @returns {{drive: any, backups: any, restoreTests: any}} De drie diensten.
 */
function createBackupServices(options, settings) {
  // Versleutelde back-ups (Beheer > Back-ups en herstel); alleen met een verbindings-URL voor pg_dump. Na elke back-up
  // gaat er een kopie naar Google Drive als die gekoppeld is (tests geven een eigen fetch mee als nep-Google).
  const backupDir = options.backupDir || path.join(DATA_DIR, 'backups');
  const drive = createDrive({
    settings, dir: backupDir, fetchImpl: options.googleFetch, now: options.now,
    audit: (entry, client) => client.query('INSERT INTO audit_log (user_id, action, entity) VALUES ($1, $2, $3)', [entry.userId ?? null, entry.action, 'google-drive']),
    isAllowed: async (userId) => {
      const [user] = await options.db.query('SELECT role, active FROM users WHERE id = $1', [userId]);
      return Boolean(user && user.active && roleHasRight(user.role, 'systeem'));
    },
  });
  const backups = options.backups || createBackupService({
    db: options.db, settings, dir: backupDir, masterKey: options.masterKey,
    connectionString: options.databaseUrl, pgDumpPath: options.pgDumpPath, now: options.now,
    onCreated: () => drive.sync().catch((error) => console.error(`Google Drive: ${String(error.message).replace(/[\r\n]/g, ' ')}`)),
  });
  const restoreTests = createRestoreTests({ dir: backupDir, masterKey: options.masterKey, previousKeys: options.previousKeys, drive, now: options.now });
  return { drive, backups, restoreTests };
}

/**
 * Start het achtergrondwerk van de diensten: opschonen van sessies, tellers, back-ups, kopie naar Google Drive,
 * hersteltest, bewaking, AVG-opschoning, betaalherinneringen, infobrieven, opruimen van foto's en de koppeling met het updatescript.
 * @param {any} services De diensten uit `createServices`.
 * @param {any} db De database.
 * @returns {void}
 */
function startBackgroundTasks(services, db) {
  startCrmMaintenance(db, services.settings);
  startAccountMaintenance(services.accounts);
  services.redirects.startTimers();
  services.backups.startTimer();
  services.drive.startTimer();
  services.restoreTests.startTimer(() => services.settings.get('driveEnabled'));
  services.monitor.start();
  services.retention.start();
  services.paymentReminders.start();
  services.infobriefSender.start();
  services.mediaLibrary.startCleanupTimer();
  services.imageFormats.startTimer();
  // Updates: de stand van "automatisch bijwerken" naar het hostscript en een afgeronde uitrol in het auditlog (elke minuut).
  startUpdateSync({ db, settings: services.settings, systemUpdate: services.systemUpdate });
}

module.exports = { createServices, startBackgroundTasks };
