/**
 * Meldingen aan kantoor (Beheer > E-mail > Meldingen): een mail bij een nieuw bericht via het contactformulier en bij
 * een nieuwe aanmelding. De melding gaat naar het ingestelde kantooradres en wordt na het opslaan verstuurd, zonder dat
 * de bezoeker erop wacht: een mislukte melding verandert niets aan de inzending (de oorzaak staat in het overzicht van
 * Beheer > E-mail > Mailserver, zonder adressen). Bijzondere persoonsgegevens (de versleutelde velden van een
 * aanmelding) komen nooit in een mail.
 */
const { renderMail } = require('./layout');
const { formatDate } = require('../site/format');

/** Leesbare betaalkeuze in de melding. */
const PAYMENT_LABELS = { aanbetaling: 'Aanbetaling', totaal: 'Totaalbedrag' };

/**
 * Maakt de meldingen.
 * @param {{mailer: object, settings: object}} options De mailer (`mail/mailer.js`) en de instellingen.
 * @returns {{contactMessage: Function, booking: Function, layoutOptions: Function}} Functies die een melding versturen
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

  return { contactMessage, booking, layoutOptions };
}

module.exports = { createNotifications };
