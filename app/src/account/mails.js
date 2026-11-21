/**
 * Mails van het reizigersaccount (CMS-pakket J2): bevestigen van het e-mailadres, wachtwoord herstellen en de melding
 * dat er al een account is. De link bevat een eenmalig token en gaat naar het basisadres uit de site-instellingen
 * (`res.locals.site.siteUrl`), nooit naar de `Host`-kop van het verzoek. Versturen gooit nooit en wacht niet: een
 * mislukte mail staat in het overzicht van Beheer > E-mail > Mailserver (zonder adressen).
 */
const { renderMail } = require('../mail/layout');
const { absoluteUrl } = require('../site/seo');

/**
 * Maakt de mails van het reizigersaccount.
 * @param {{mailer: object, settings: object}} options De mailer (`mail/mailer.js`) en de instellingen (opmaak).
 * @returns {{verify: Function, reset: Function, alreadyRegistered: Function}} Functies die een mail versturen.
 */
function createAccountMails(options) {
  const { mailer, settings } = options;

  /**
   * Verstuurt één mail met een knoplink; gooit nooit.
   * @param {string} kind Soort voor het overzicht.
   * @param {string} to Ontvanger.
   * @param {{subject: string, title: string, intro: string, body: string}} mail Onderwerp en teksten.
   * @returns {Promise<boolean>} Waar als de mail is verstuurd.
   */
  const deliver = async (kind, to, mail) => {
    if (!mailer.configured()) return false;
    try {
      const rendered = renderMail({
        headerColor: settings.get('mailHeaderColor'), footerText: settings.get('mailFooterText'), siteName: settings.get('siteName'),
        title: mail.title, intro: mail.intro, body: mail.body,
      });
      await mailer.send({ kind, to, subject: mail.subject, text: rendered.text, html: rendered.html, attachments: rendered.attachments });
      return true;
    } catch (_) {
      return false;
    }
  };

  /**
   * Mail met de link om het e-mailadres te bevestigen.
   * @param {{to: string, token: string, siteUrl: string, repeat?: boolean}} input Ontvanger, token, basisadres en of het
   *   account er al was (dan geldt het wachtwoord van de eerste registratie).
   * @returns {Promise<boolean>} Waar als de mail is verstuurd.
   */
  const verify = (input) => deliver('account-bevestigen', input.to, {
    subject: 'Bevestig je account bij Avanta Reizen',
    title: 'Bevestig je account',
    intro: `Je hebt een account aangemaakt op de website van Avanta Reizen. Open de link hieronder en log in met je wachtwoord om je e-mailadres te bevestigen. De link is 24 uur geldig.${input.repeat ? '\n\nDit adres was al eerder geregistreerd: gebruik het wachtwoord van die eerste keer. Weet je dat niet meer? Kies dan op de website "Wachtwoord vergeten".' : ''}\n\nHeb je dit niet zelf gedaan? Dan kun je deze mail negeren; zonder bevestiging verdwijnt het account vanzelf.`,
    body: absoluteUrl(input.siteUrl, `/account/bevestigen/?token=${encodeURIComponent(input.token)}`),
  });

  /**
   * Mail met de link om een nieuw wachtwoord in te stellen.
   * @param {{to: string, token: string, siteUrl: string}} input Ontvanger, token en basisadres.
   * @returns {Promise<boolean>} Waar als de mail is verstuurd.
   */
  const reset = (input) => deliver('account-herstellen', input.to, {
    subject: 'Nieuw wachtwoord voor je account bij Avanta Reizen',
    title: 'Nieuw wachtwoord instellen',
    intro: 'Via de link hieronder stel je een nieuw wachtwoord in voor je account. De link is een uur geldig en werkt één keer.\n\nHeb je dit niet zelf aangevraagd? Dan kun je deze mail negeren; je wachtwoord blijft hetzelfde.',
    body: absoluteUrl(input.siteUrl, `/account/wachtwoord-herstellen/?token=${encodeURIComponent(input.token)}`),
  });

  /**
   * Mail aan wie zich registreert met een adres dat al een account heeft, met een verwijzing naar *wachtwoord vergeten*
   * (bewust zonder herstellink: die zou het quotum van de eigenaar opmaken). Zo verraadt de website zelf nooit of een
   * adres een account heeft.
   * @param {{to: string, siteUrl: string}} input Ontvanger en basisadres.
   * @returns {Promise<boolean>} Waar als de mail is verstuurd.
   */
  const alreadyRegistered = (input) => deliver('account-bestaat', input.to, {
    subject: 'Je hebt al een account bij Avanta Reizen',
    title: 'Je hebt al een account',
    intro: 'Iemand probeerde een account aan te maken met dit e-mailadres, maar daar is al een account voor. Log in met je wachtwoord, of vraag via de pagina hieronder een nieuw wachtwoord aan als je het vergeten bent.\n\nHeb je dit niet zelf gedaan? Dan kun je deze mail negeren.',
    body: absoluteUrl(input.siteUrl, '/account/wachtwoord-vergeten/'),
  });

  return { verify, reset, alreadyRegistered };
}

module.exports = { createAccountMails };
