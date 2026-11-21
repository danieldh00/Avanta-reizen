/**
 * Betaalherinneringen aan de reiziger (migratie 27): een mail met het openstaande bedrag van de aanbetaling of het
 * restant, de vervaldatum en de betaalinstructie uit de bevestiging (`bookingPaymentText`). Kantoor stuurt er een met
 * de hand vanaf de betaalpagina; met `paymentReminderAuto` aan stuurt de app elke dag een herinnering voor te late
 * termijnen, hoogstens `paymentReminderMax` keer per termijn en niet vaker dan elke `paymentReminderEveryDays` dagen.
 * Elke poging staat in `payment_reminders` (termijn, wanneer, wie, gelukt of de foutmelding zonder adres); nooit het
 * adres of de inhoud. Geen herinnering bij een geannuleerde of geanonimiseerde aanmelding of als er niets openstaat.
 * Bijzondere gegevens staan nooit in de mail.
 */
const { renderMail } = require('../mail/layout');
const { mailFailure } = require('../mail/mailer');
const { formatDate } = require('../site/format');
const payments = require('./payments');
const { loadOverview } = require('./payment-overview-routes');

/** Hoogstens zoveel automatische herinneringen per dagelijkse ronde. */
const MAX_PER_RUN = 200;

/** Binnen zoveel minuten geen tweede herinnering met de hand voor dezelfde termijn (dubbelklik, twee tabbladen). */
const MANUAL_GAP_MINUTES = 10;

/** Eerste automatische ronde na het starten, en daarna elke dag. */
const FIRST_RUN_MS = 10 * 60 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Naam van de termijn in de mail en op het scherm. */
const KIND_LABELS = { aanbetaling: 'aanbetaling', restant: 'restant' };

/**
 * Welke termijn een herinnering krijgt: de te late, anders de eerste die nog openstaat.
 * @param {object} summary Uitkomst van `payments.summarize`.
 * @returns {(''|'aanbetaling'|'restant')} Termijn, of leeg als er niets openstaat.
 */
function reminderKind(summary) {
  if (summary.overdue) return summary.overdue;
  if (summary.depositOpenCents > 0) return 'aanbetaling';
  return summary.balanceCents > 0 ? 'restant' : '';
}

/**
 * De inhoud van een herinnering voor `renderMail`.
 * @param {{booking: object, summary: object, kind: string, paymentText: string}} input Aanmelding, stand, termijn en betaalinstructie.
 * @returns {{subject: string, content: object}} Onderwerp en inhoud.
 */
function reminderContent({ booking, summary, kind, paymentText }) {
  const amount = kind === 'aanbetaling' ? summary.depositOpenCents : summary.balanceCents;
  const due = kind === 'aanbetaling' ? summary.depositDueOn : summary.balanceDueOn;
  const late = summary.overdue === kind;
  return {
    subject: `Herinnering: ${KIND_LABELS[kind]} voor ${booking.trip_title} (${booking.reference})`,
    content: {
      title: `Herinnering ${KIND_LABELS[kind]}`,
      intro: `Beste ${booking.call_name || booking.first_names},\n\n${late
        ? `Volgens onze administratie hebben we de ${KIND_LABELS[kind]} voor je reis nog niet (helemaal) ontvangen. Wil je het bedrag zo snel mogelijk overmaken?`
        : `Een vriendelijke herinnering: binnenkort vervalt de ${KIND_LABELS[kind]} voor je reis.`} Heb je al betaald, dan kun je deze mail als niet verzonden beschouwen; antwoord gerust als er iets niet klopt.`,
      rows: [
        ['Referentie', booking.reference],
        ['Reis', booking.trip_title],
        ['Vertrek', formatDate(booking.departure_date)],
        ['Totaal', payments.formatAmount(summary.totalCents)],
        ['Al ontvangen', payments.formatAmount(summary.paidCents)],
        [`Nu te betalen (${KIND_LABELS[kind]})`, payments.formatAmount(amount)],
        ['Uiterlijk', due ? formatDate(due) : '–'],
      ],
      body: `${paymentText}\n\nReferentie voor de omschrijving: ${booking.reference}`,
    },
  };
}

/**
 * Maakt de herinneringen.
 * @param {{db: object, mailer: object, settings: object, now?: () => number}} options Database, mailer, instellingen en klok.
 * @returns {{send: Function, runDaily: Function, list: Function, start: Function}} Functies.
 */
function createPaymentReminders(options) {
  const { db, mailer, settings } = options;
  const now = options.now || Date.now;
  const today = () => payments.localDay(now());

  /**
   * Leest een aanmelding met het actuele e-mailadres (van de persoon, anders van het formulier).
   * @param {{query: Function}} client Database of transactie-client.
   * @param {number} bookingId Id.
   * @param {boolean} lock De aanmelding vergrendelen.
   * @returns {Promise<(object|null)>} Aanmelding of null.
   */
  const findBooking = async (client, bookingId, lock) => {
    const [booking] = await client.query(
      `SELECT b.id, b.reference, b.trip_title, b.departure_date, b.status, b.created_at, b.first_names, b.call_name, b.payment_choice,
              b.deposit_cents, b.anonymized_at, coalesce(nullif(p.email, ''), b.email) AS email
         FROM bookings b LEFT JOIN persons p ON p.id = b.person_id
        WHERE b.id = $1${lock ? ' FOR UPDATE OF b' : ''}`,
      [bookingId],
    );
    return booking || null;
  };

  /**
   * Stuurt één herinnering. De poging wordt eerst vastgelegd (onder slot van de aanmelding, zodat twee gelijktijdige
   * verzoeken niet allebei versturen) en na het versturen bijgewerkt met de uitkomst.
   * @param {{bookingId: number, trigger: ('handmatig'|'automatisch'), userId?: (number|null), kind?: string}} input
   *   Aanmelding, wie of wat, en (automatisch) de termijn.
   * @returns {Promise<{status: string, kind?: string, error?: string}>} `ok`, `weg`, `geen-mailserver`, `geen-adres`,
   *   `geannuleerd`, `niets-open`, `te-snel` of `mislukt` (met de melding).
   */
  const send = async (input) => {
    if (!mailer.configured()) return { status: 'geen-mailserver' };
    const prepared = await db.transaction(async (client) => {
      const booking = await findBooking(client, input.bookingId, true);
      if (!booking) return { status: 'weg' };
      if (booking.status === 'geannuleerd') return { status: 'geannuleerd' };
      if (booking.anonymized_at || !booking.email) return { status: 'geen-adres' };
      const lines = await payments.loadLines(client, booking.id);
      const summary = payments.summarize({ booking, ...lines, terms: payments.termsFrom(settings), today: today() });
      const kind = input.kind || reminderKind(summary);
      if (!kind || (kind === 'aanbetaling' ? summary.depositOpenCents : summary.balanceCents) <= 0) return { status: 'niets-open' };
      if (input.trigger === 'handmatig') {
        const [recent] = await client.query(
          `SELECT 1 AS hit FROM payment_reminders WHERE booking_id = $1 AND kind = $2 AND created_at > $3::timestamptz - make_interval(mins => $4)`,
          [booking.id, kind, new Date(now()).toISOString(), MANUAL_GAP_MINUTES],
        );
        if (recent) return { status: 'te-snel', kind };
      }
      const [row] = await client.query(
        "INSERT INTO payment_reminders (booking_id, kind, trigger, sent, error, created_by, created_at) VALUES ($1, $2, $3, false, 'bezig met versturen', $4, $5) RETURNING id",
        [booking.id, kind, input.trigger, input.userId ?? null, new Date(now()).toISOString()],
      );
      return { status: 'klaar', booking, summary, kind, rowId: row.id };
    });
    if (prepared.status !== 'klaar') return prepared;
    const { booking, summary, kind, rowId } = prepared;
    const mail = reminderContent({ booking, summary, kind, paymentText: settings.get('bookingPaymentText') });
    try {
      const rendered = renderMail({ headerColor: settings.get('mailHeaderColor'), footerText: settings.get('mailFooterText'), siteName: settings.get('siteName'), ...mail.content });
      await mailer.send({ kind: 'herinnering-betaling', to: booking.email, subject: mail.subject, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
      await db.query("UPDATE payment_reminders SET sent = true, error = '' WHERE id = $1", [rowId]);
      return { status: 'ok', kind };
    } catch (error) {
      // mailFailure noemt nooit een e-mailadres of wachtwoord.
      const message = mailFailure(error).slice(0, 200);
      await db.query('UPDATE payment_reminders SET error = $2 WHERE id = $1', [rowId, message]);
      return { status: 'mislukt', kind, error: message };
    }
  };

  /**
   * De dagelijkse ronde: herinnert elke aanmelding met een te late termijn, als de laatste automatische herinnering
   * voor die termijn lang genoeg geleden is en het maximum niet is bereikt. Doet niets als de schakelaar uit staat.
   * @returns {Promise<{sent: number, failed: number, skipped: number}>} Aantallen.
   */
  const runDaily = async () => {
    const counts = { sent: 0, failed: 0, skipped: 0 };
    if (!settings.get('paymentReminderAuto') || !mailer.configured()) return counts;
    const { rows } = await loadOverview(db, { view: 'te-laat', tripId: null, terms: payments.termsFrom(settings), today: today() });
    if (!rows.length) return counts;
    const history = await db.query(
      `SELECT booking_id, kind, count(*)::int AS total, max(created_at) AS last_at FROM payment_reminders
        WHERE booking_id = ANY($1::int[]) AND trigger = 'automatisch' AND sent GROUP BY booking_id, kind`,
      [rows.map((row) => row.id)],
    );
    const byKey = new Map(history.map((entry) => [`${entry.booking_id}:${entry.kind}`, entry]));
    const gapMs = settings.get('paymentReminderEveryDays') * 24 * 60 * 60 * 1000;
    for (const row of rows) {
      if (counts.sent + counts.failed >= MAX_PER_RUN) break;
      const kind = row.summary.overdue;
      const past = byKey.get(`${row.id}:${kind}`);
      // Iets korter dan het interval, zodat een ronde die een paar minuten later loopt de dag niet overslaat.
      if (past && (past.total >= settings.get('paymentReminderMax') || now() - new Date(past.last_at).getTime() < gapMs - 60 * 60 * 1000)) {
        counts.skipped++;
        continue;
      }
      const outcome = await send({ bookingId: row.id, trigger: 'automatisch', kind });
      if (outcome.status === 'ok') counts.sent++;
      else if (outcome.status === 'mislukt') counts.failed++;
      else counts.skipped++;
    }
    return counts;
  };

  /**
   * De herinneringen van een aanmelding, nieuwste eerst.
   * @param {number} bookingId Id.
   * @returns {Promise<object[]>} Regels met naam van de medewerker.
   */
  const list = (bookingId) => db.query(
    `SELECT r.kind, r.trigger, r.sent, r.error, r.created_at, u.name AS user_name
       FROM payment_reminders r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.booking_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
    [bookingId],
  );

  /**
   * Start de dagelijkse ronde (de eerste na tien minuten).
   * @returns {NodeJS.Timeout[]} De timers (houden het proces niet open).
   */
  const start = () => {
    const tick = () => {
      runDaily()
        .then((counts) => { if (counts.sent || counts.failed) console.log(`betaalherinneringen: ${counts.sent} verstuurd, ${counts.failed} mislukt`); })
        .catch((error) => console.error(`betaalherinneringen mislukt (${error.code || error.name})`));
    };
    return [setTimeout(tick, FIRST_RUN_MS).unref(), setInterval(tick, INTERVAL_MS).unref()];
  };

  return { send, runDaily, list, start };
}

module.exports = { createPaymentReminders, reminderKind, reminderContent, KIND_LABELS, MAX_PER_RUN, MANUAL_GAP_MINUTES };
