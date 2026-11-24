// @ts-check
/**
 * Versturen van infobrieven in de achtergrond. Een ronde pakt ontvangers uit de wachtrij (`infobrief_recipients` met
 * status *wachtrij*), hoogstens zoveel per minuut als Beheer > E-mail > Infobrief toestaat, en verstuurt ze één voor één.
 *
 * Nooit dubbel: een ontvanger gaat eerst op *bezig* (met `FOR UPDATE SKIP LOCKED`, zodat twee rondes of twee processen
 * nooit dezelfde regel pakken) en pas na het versturen op *verzonden* of *mislukt*. Blijft een regel door een herstart
 * op *bezig* staan, dan wordt hij *niet zeker verzonden* en niet opnieuw verstuurd. Het adres wordt pas bij het
 * versturen opgezocht en nergens opgeslagen; een fout komt zonder adres in de opmerking (`mailFailure`).
 * Zonder mailserver blijft alles in de wachtrij staan tot er een is ingesteld.
 */
const { mailFailure } = require('../mail/mailer');
const infobrieven = require('./infobrieven');

/** Elke zoveel milliseconden een ronde (de limiet per minuut telt over de laatste 60 seconden). */
const TICK_MS = 15 * 1000;

/** Venster van de limiet (milliseconden). */
const WINDOW_MS = 60 * 1000;

/** Na zoveel minuten op *bezig* geldt een regel als afgebroken. */
const STALE_MINUTES = 15;

/** Opmerking bij een afgebroken regel. */
const STALE_NOTE = 'afgebroken tijdens het versturen; niet zeker verzonden';

/**
 * Maakt de verzender.
 * @param {{db: any, mailer: {configured: () => boolean, send: Function}, settings: {get: (key: string) => any}, persons: {openBlock: Function}, now?: () => number}} options
 *   Database, mailer, instellingen, personen (voor het adres van de ouder) en (voor tests) de klok.
 * @returns {{runOnce: () => Promise<{sent: number, failed: number, skipped: number}>, kick: () => void, start: () => NodeJS.Timeout, idle: () => Promise<void>}}
 *   Een ronde draaien, een ronde aanstoten (na het in de wachtrij zetten), de timer starten en (voor tests) wachten tot
 *   een lopende ronde klaar is.
 */
function createInfobriefSender(options) {
  const { db, mailer, settings, persons } = options;
  const now = options.now || Date.now;
  /** Tijdstippen van de verzendingen in het laatste venster (limiet per minuut). */
  let recent = [];
  /** De lopende ronde, als die er is (nooit twee tegelijk in één proces). */
  let running = null;

  /**
   * Hoeveel mails er nu nog mogen binnen de limiet per minuut.
   * @returns {number} Aantal (0 of meer).
   */
  const budget = () => {
    const from = now() - WINDOW_MS;
    recent = recent.filter((at) => at > from);
    const perMinute = Math.max(1, Number(settings.get('infobriefPerMinute')) || 1);
    return Math.max(0, perMinute - recent.length);
  };

  /**
   * Zet de infobrieven zonder ontvangers in de wachtrij of bezig op *verzonden*.
   * @returns {Promise<void>}
   */
  const finish = async () => {
    await db.query(
      `UPDATE infobrieven i SET status = 'verzonden', send_finished_at = $1
        WHERE i.status = 'verzenden' AND NOT EXISTS (SELECT 1 FROM infobrief_recipients r WHERE r.infobrief_id = i.id AND r.status IN ('wachtrij', 'bezig'))`,
      [new Date(now()).toISOString()],
    );
  };

  /**
   * Verstuurt één ontvanger die al op *bezig* staat en legt de uitkomst vast.
   * @param {any} row Regel met ontvanger, aanmelding, persoon en infobrief (uit de query in `round`).
   * @returns {Promise<('sent'|'failed'|'skipped')>} Uitkomst.
   */
  const deliver = async (row) => {
    /**
     * Legt de uitkomst van een ontvanger vast.
     * @param {string} status Nieuwe status.
     * @param {string} note Opmerking (zonder adres).
     * @returns {Promise<void>}
     */
    const settle = (status, note) => db.query(
      'UPDATE infobrief_recipients SET status = $2, note = $3, sent_at = $4, updated_at = $5 WHERE id = $1',
      [row.id, status, note.slice(0, 300), status === 'verzonden' ? new Date(now()).toISOString() : null, new Date(now()).toISOString()],
    );
    if (!row.booking_id) {
      await settle('overgeslagen', 'aanmelding verwijderd');
      return 'skipped';
    }
    if (row.booking_status === 'geannuleerd' || row.anonymized_at) {
      await settle('overgeslagen', row.anonymized_at ? 'gegevens gewist' : 'aanmelding geannuleerd');
      return 'skipped';
    }
    const address = row.role === 'ouder_voogd' ? infobrieven.guardianAddress(persons, row).email : String(row.email || '').trim();
    if (!address) {
      await settle('overgeslagen', 'geen e-mailadres');
      return 'skipped';
    }
    try {
      const mail = infobrieven.buildMail({ infobrief: row, recipient: { role: row.role, callName: row.call_name }, settings });
      recent.push(now());
      await mailer.send({ kind: 'infobrief', to: address, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
      await settle('verzonden', '');
      return 'sent';
    } catch (error) {
      // mailFailure noemt nooit een e-mailadres of wachtwoord.
      await settle('mislukt', mailFailure(error));
      return 'failed';
    }
  };

  /**
   * Eén ronde: afgebroken regels markeren, dan ontvangers uit de wachtrij versturen binnen de limiet.
   * @returns {Promise<{sent: number, failed: number, skipped: number}>} Aantallen.
   */
  const round = async () => {
    const counts = { sent: 0, failed: 0, skipped: 0 };
    await db.query(
      `UPDATE infobrief_recipients SET status = 'onzeker', note = $2, updated_at = $1
        WHERE status = 'bezig' AND updated_at < $1::timestamptz - make_interval(mins => $3)`,
      [new Date(now()).toISOString(), STALE_NOTE, STALE_MINUTES],
    );
    if (!mailer.configured()) {
      await finish();
      return counts;
    }
    const limit = budget();
    if (limit > 0) {
      const claimed = await db.query(
        `UPDATE infobrief_recipients SET status = 'bezig', attempts = attempts + 1, updated_at = $2
          WHERE id IN (SELECT id FROM infobrief_recipients WHERE status = 'wachtrij' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
          RETURNING id`,
        [limit, new Date(now()).toISOString()],
      );
      if (claimed.length) {
        const rows = await db.query(
          `SELECT r.id, r.role, ${infobrieven.RECIPIENT_COLUMNS},
                  i.subject, i.body_html, t.title AS trip_title, t.trip_code, t.departure_date
             FROM infobrief_recipients r JOIN infobrieven i ON i.id = r.infobrief_id JOIN trips t ON t.id = i.trip_id
             LEFT JOIN bookings b ON b.id = r.booking_id LEFT JOIN persons p ON p.id = b.person_id
            WHERE r.id = ANY($1::int[]) ORDER BY r.id`,
          [claimed.map((row) => row.id)],
        );
        for (const row of rows) {
          const outcome = await deliver(row);
          counts[outcome]++;
        }
      }
    }
    await finish();
    return counts;
  };

  /**
   * Draait een ronde, of wacht op de lopende.
   * @returns {Promise<{sent: number, failed: number, skipped: number}>} Aantallen van deze ronde (0 als er al een liep).
   */
  const runOnce = async () => {
    if (running) {
      await running;
      return { sent: 0, failed: 0, skipped: 0 };
    }
    running = round();
    try {
      return await running;
    } finally {
      running = null;
    }
  };

  /**
   * Draait een ronde op de achtergrond en schrijft alleen aantallen of de soort fout in het serverlog.
   * @returns {void}
   */
  const kick = () => {
    runOnce()
      .then((counts) => { if (counts.sent || counts.failed) console.log(`infobrief: ${counts.sent} verzonden, ${counts.failed} mislukt`); })
      .catch((error) => console.error(`infobrief: versturen mislukt (${error.code || error.name})`));
  };

  /**
   * Start de vaste rondes.
   * @returns {NodeJS.Timeout} De timer (houdt het proces niet open).
   */
  const start = () => setInterval(kick, TICK_MS).unref();

  /**
   * Wacht tot een lopende ronde klaar is (voor tests en netjes afsluiten).
   * @returns {Promise<void>}
   */
  const idle = async () => {
    if (running) await running.catch(() => {});
  };

  return { runOnce, kick, start, idle };
}

module.exports = { createInfobriefSender, TICK_MS, STALE_MINUTES, STALE_NOTE };
