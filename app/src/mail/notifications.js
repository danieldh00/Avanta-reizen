/**
 * Meldingen aan kantoor (Beheer > E-mail > Meldingen): een mail bij een nieuw bericht via het contactformulier en bij
 * een nieuwe aanmelding. Daarnaast de bevestiging aan de reiziger na een aanmelding (Beheer > E-mail > Bevestiging aan
 * de reiziger), met de referentie, de bedragen en de betaalinstructie. De melding gaat naar het ingestelde kantooradres en wordt na het opslaan verstuurd, zonder dat
 * de bezoeker erop wacht: een mislukte melding verandert niets aan de inzending (de oorzaak staat in het overzicht van
 * Beheer > E-mail > Mailserver, zonder adressen). Bijzondere persoonsgegevens (de versleutelde velden van een
 * aanmelding) komen nooit in een mail.
 */
const { renderMail } = require('./layout');
const { formatDate, formatPrice } = require('../site/format');
const { SGR_CENTS, BOOKING_FEE_CENTS } = require('../booking/fields');

/** Leesbare betaalkeuze in de melding. */
const PAYMENT_LABELS = { aanbetaling: 'Aanbetaling', totaal: 'Totaalbedrag' };

/**
 * Maakt de meldingen.
 * @param {{mailer: object, settings: object}} options De mailer (`mail/mailer.js`) en de instellingen.
 * @returns {{contactMessage: Function, booking: Function, bookingConfirmation: Function, guardianConfirmation: Function, layoutOptions: Function}} Functies die een melding versturen
 *   (en nooit een fout gooien) en de opmaakinstellingen voor `renderMail`.
 */
function createNotifications(options) {
  const { mailer, settings } = options;

  /**
   * De opmaakinstellingen voor `renderMail`.
   * @returns {{headerColor: string, footerText: string, siteName: string}} Kleur, voettekst en naam van de site.
   */
  const layoutOptions = () => ({ headerColor: settings.get('mailHeaderColor'), footerText: settings.get('mailFooterText'), siteName: settings.get('siteName') });

  /**
   * Verstuurt een melding als dat soort melding aan staat en er een kantooradres en mailserver is. Gooit nooit: de
   * mailer legt een fout vast in het overzicht en het serverlog (zonder adressen).
   * @param {string} toggleKey Instelling die deze melding aan- of uitzet.
   * @param {string} kind Soort voor het overzicht.
   * @param {{subject: string, replyTo?: string, content: object}} mail Onderwerp, antwoordadres en inhoud voor `renderMail`.
   * @returns {Promise<boolean>} Waar als de melding is verstuurd.
   */
  const deliver = async (toggleKey, kind, mail) => {
    const to = settings.get('notifyEmail');
    if (!settings.get(toggleKey) || !to || !mailer.configured()) return false;
    try {
      const rendered = renderMail({ ...layoutOptions(), ...mail.content });
      await mailer.send({ kind, to, replyTo: mail.replyTo, subject: mail.subject, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
      return true;
    } catch (_) {
      return false;
    }
  };

  /**
   * Melding van een nieuw contactbericht. Het antwoordadres is dat van de afzender, zodat kantoor direct kan antwoorden.
   * @param {{name: string, email: string, phone?: string, subject?: string, message: string}} message Het bericht.
   * @param {(object|null)} trip De reis waar de bezoeker vandaan kwam, of null.
   * @returns {Promise<boolean>} Waar als de melding is verstuurd.
   */
  const contactMessage = (message, trip) => deliver('notifyContact', 'melding-contact', {
    subject: `Nieuw bericht via de website: ${message.subject || message.name}`,
    replyTo: message.email,
    content: {
      title: 'Nieuw bericht via het contactformulier',
      intro: 'Er is een bericht binnengekomen via het contactformulier op de website. Antwoorden op deze mail gaat naar de afzender.',
      rows: [['Naam', message.name], ['E-mail', message.email], ['Telefoon', message.phone], ['Onderwerp', message.subject], ['Reis', trip ? trip.title : '']],
      body: message.message,
    },
  });

  /**
   * Melding van een nieuwe aanmelding, met alleen de gewone gegevens (geen geboortedatum, kerk, paspoort, noodnummer
   * of bijzonderheden).
   * @param {{reference: string, trip: object, values: object}} booking Referentie, reis en de gecontroleerde velden.
   * @returns {Promise<boolean>} Waar als de melding is verstuurd.
   */
  const booking = (booking) => {
    const { values, trip } = booking;
    const name = `${values.call_name} ${values.last_name}`.trim();
    return deliver('notifyBooking', 'melding-aanmelding', {
      subject: `Nieuwe aanmelding ${booking.reference}: ${trip.title}`,
      replyTo: values.email,
      content: {
        title: 'Nieuwe aanmelding',
        intro: 'Er is een nieuwe aanmelding binnengekomen via de website. De bijzondere gegevens (zoals geboortedatum, paspoort en bijzonderheden) staan alleen versleuteld in het CRM en niet in deze mail.',
        rows: [
          ['Referentie', booking.reference],
          ['Reis', trip.title],
          ['Reiscode', trip.trip_code],
          ['Vertrek', formatDate(trip.departure_date)],
          ['Naam', name],
          ['E-mail', values.email],
          ['Mobiel', values.mobile],
          ['Woonplaats', values.city],
          ['Reist samen met', values.travel_with],
          ['Betaling', PAYMENT_LABELS[values.payment_choice] || values.payment_choice],
        ],
      },
    });
  };

  /**
   * De bedragen van een aanmelding: reissom, SGR-garantie, boekingskosten (alleen bij de aanbetaling), totaal en de
   * aanbetaling van de reis (als die is ingevuld en voor een aanbetaling is gekozen).
   * @param {object} trip De reis (`price_cents`).
   * @param {string} paymentChoice 'aanbetaling' of 'totaal'.
   * @param {(number|null)} depositCents Aanbetaling van de reis, of null.
   * @returns {Array<[string, string]>} Rijen voor de mail; zonder reissom alleen de vaste bedragen.
   */
  const amountRows = (trip, paymentChoice, depositCents) => {
    const fee = paymentChoice === 'aanbetaling' ? BOOKING_FEE_CENTS : 0;
    const rows = [];
    if (trip.price_cents) rows.push(['Reissom', formatPrice(trip.price_cents)]);
    rows.push(['SGR-garantie', formatPrice(SGR_CENTS)]);
    if (fee) rows.push(['Boekingskosten', formatPrice(fee)]);
    if (trip.price_cents) rows.push(['Totaal', formatPrice(trip.price_cents + SGR_CENTS + fee)]);
    // Zonder ingevulde aanbetaling bij de reis geen bedrag gokken: kantoor geeft het door.
    if (paymentChoice === 'aanbetaling') rows.push(['Nu te betalen (aanbetaling)', depositCents ? formatPrice(depositCents) : 'het bedrag ontvang je van kantoor']);
    if (trip.extra_costs_cents) rows.push(['Bijkomende kosten (ter plaatse)', formatPrice(trip.extra_costs_cents)]);
    return rows;
  };

  /**
   * Bevestiging aan de reiziger na een aanmelding, naar het opgegeven e-mailadres. Alleen de gewone gegevens: nooit
   * geboortedatum, kerk, paspoort, noodnummer of bijzonderheden. Gaat alleen als de bevestiging aan staat en er een
   * mailserver is; gooit nooit (een fout staat in het overzicht van Beheer > E-mail > Mailserver, zonder adressen).
   * @param {{reference: string, trip: object, values: object, depositCents?: (number|null)}} booking Referentie, reis,
   *   de gecontroleerde velden en de aanbetaling van de reis.
   * @returns {Promise<boolean>} Waar als de bevestiging is verstuurd.
   */
  const bookingConfirmation = async (booking) => {
    const { values, trip } = booking;
    if (!settings.get('bookingConfirmEnabled') || !values.email || !mailer.configured()) return false;
    try {
      const rendered = renderMail({
        ...layoutOptions(),
        title: 'Bevestiging van je aanmelding',
        intro: `Beste ${values.call_name || values.first_names},\n\nBedankt voor je aanmelding! We hebben hem goed ontvangen. Hieronder staan je reisgegevens en de bedragen. Klopt er iets niet, antwoord dan op deze mail.`,
        rows: [
          ['Referentie', booking.reference],
          ['Reis', trip.title],
          ['Reiscode', trip.trip_code],
          ['Vertrek', formatDate(trip.departure_date)],
          ['Betaling', PAYMENT_LABELS[values.payment_choice] || values.payment_choice],
          ...amountRows(trip, values.payment_choice, booking.depositCents ?? null),
        ],
        body: `${settings.get('bookingPaymentText')}\n\nReferentie voor de omschrijving: ${booking.reference}`,
      });
      await mailer.send({ kind: 'bevestiging-aanmelding', to: values.email, subject: `Bevestiging van je aanmelding ${booking.reference}: ${trip.title}`, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
      return true;
    } catch (_) {
      return false;
    }
  };

  /**
   * Bevestiging aan de ouder of voogd bij een deelnemer onder de 16: wie is aangemeld, voor welke reis, en dat de ouder
   * toestemming gaf. Zo merkt een ouder het als een kind de toestemming zelf heeft aangevinkt. Alleen de naam van de
   * deelnemer en de reis, nooit bijzondere gegevens. Valt onder dezelfde instelling als de bevestiging aan de reiziger;
   * gooit nooit.
   * @param {{reference: string, trip: object, values: object}} booking Referentie, reis en de gecontroleerde velden
   *   (met `guardian_name` en `guardian_email`).
   * @returns {Promise<boolean>} Waar als de bevestiging is verstuurd.
   */
  const guardianConfirmation = async (booking) => {
    const { values, trip } = booking;
    if (!settings.get('bookingConfirmEnabled') || !values.guardian_email || !mailer.configured()) return false;
    const participant = `${values.call_name || values.first_names} ${values.last_name}`.trim();
    try {
      const rendered = renderMail({
        ...layoutOptions(),
        title: 'Aanmelding met uw toestemming',
        intro: `Beste ${values.guardian_name},\n\n${participant} is aangemeld voor een reis van ${settings.get('siteName')}. Omdat de deelnemer jonger is dan 16 jaar, is bij de aanmelding aangegeven dat u als ouder of voogd toestemming geeft voor de aanmelding en voor het vastleggen van de gegevens.\n\nKlopt dit niet, of wilt u de toestemming intrekken? Antwoord dan op deze mail of neem contact met ons op.`,
        rows: [
          ['Referentie', booking.reference],
          ['Deelnemer', participant],
          ['Reis', trip.title],
          ['Vertrek', formatDate(trip.departure_date)],
        ],
      });
      await mailer.send({ kind: 'bevestiging-ouder', to: values.guardian_email, subject: `Aanmelding ${booking.reference} met uw toestemming: ${trip.title}`, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
      return true;
    } catch (_) {
      return false;
    }
  };

  return { contactMessage, booking, bookingConfirmation, guardianConfirmation, layoutOptions };
}

module.exports = { createNotifications };
