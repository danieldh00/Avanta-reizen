/**
 * E-mail versturen via de mailserver uit Beheer > E-mail > Mailserver:
 * - `smtp`: inloggen met gebruikersnaam en wachtwoord (poort 587 met STARTTLS of 465 met SSL/TLS);
 * - `connector`: Exchange Online-connector op IP-basis (poort 25, geen inlog; Microsoft vertrouwt het WAN-IP).
 * De mailserver moet een openbaar adres hebben (`security/netguard.js`); er wordt verbonden met het gevonden adres en
 * het certificaat blijft op naam gecontroleerd. Zonder STARTTLS of geldig certificaat gaat er niets weg.
 * Zonder ingestelde server verstuurt de app niets. De laatste verzendingen staan in het geheugen (zonder adressen) voor
 * het overzicht in Beheer; het wachtwoord komt nooit in een melding of log.
 */
const { domainToASCII } = require('node:url');
const nodemailer = require('nodemailer');
const { publicAddress } = require('../security/netguard');

/** Hoeveel verzendingen het overzicht in Beheer onthoudt. */
const RECENT_LIMIT = 20;

/** Lokaal deel: geen spaties, @ of tekens die een adreslijst of kop kunnen breken. */
const EMAIL_LOCAL = /^[^\s@<>()",;:\\]+$/;
/** Domeinlabel in ASCII (na omzetting van internationale namen): begint en eindigt met letter of cijfer. */
const EMAIL_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
/** E-mailadressen in vrije tekst (om ze uit meldingen te halen). */
const ADDRESS_IN_TEXT = /[^\s<>()"',;:@]+@[^\s<>()"',;:@]+/g;

/**
 * Of een waarde een bruikbaar e-mailadres is. Het domein wordt eerst naar zijn ASCII-vorm (punycode) omgezet, zodat
 * ook internationale domeinnamen kloppen.
 * @param {*} value De waarde.
 * @returns {boolean} Waar bij een geldig e-mailadres (hoogstens 200 tekens).
 */
function validEmail(value) {
  if (typeof value !== 'string' || value.length > 200) return false;
  const address = value.trim();
  const at = address.lastIndexOf('@');
  if (at < 1 || !EMAIL_LOCAL.test(address.slice(0, at))) return false;
  const domain = domainToASCII(address.slice(at + 1));
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => EMAIL_LABEL.test(label)) && /^[a-z]{2,}$/i.test(labels[labels.length - 1]);
}

/**
 * Haalt e-mailadressen en regeleinden uit een tekst en kort hem in (voor meldingen, log en overzicht).
 * @param {*} text De tekst.
 * @param {number} [max] Hoogste lengte.
 * @returns {string} De schone tekst.
 */
function scrub(text, max = 200) {
  return String(text ?? '').replace(ADDRESS_IN_TEXT, '[adres]').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Het antwoord van de mailserver uit een nodemailer-fout (bijv. "535 5.7.3 Authentication unsuccessful"), zonder
 * adressen en regeleinden. Bevat geen wachtwoord: de server herhaalt dat niet.
 * @param {Error & {response?: string}} error De fout.
 * @returns {string} Het antwoord, of leeg.
 */
function serverReply(error) {
  return scrub(error && error.response);
}

/**
 * Uitleg bij een verbindingsfout met de mailserver: naam niet gevonden, verbinding geweigerd, time-out of anders
 * niet bereikbaar.
 * @param {string} code Foutcode van nodemailer (`ETIMEDOUT`, `ECONNECTION`, `ESOCKET` of `EDNS`).
 * @param {string} message Foutmelding.
 * @param {string} where De mailserver als `host:poort`, of "de mailserver".
 * @returns {string} Wat er misging en wat te controleren.
 */
function connectionAdvice(code, message, where) {
  const text = `${code} ${message}`;
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(text)) return `de naam van ${where} is niet gevonden. Controleer de servernaam.`;
  if (/ECONNREFUSED/.test(text)) return `${where} weigert de verbinding. Controleer de poort (587 met STARTTLS, 465 met SSL/TLS of 25 voor een connector).`;
  if (code === 'ETIMEDOUT' || /timeout|never received/i.test(text)) {
    return `${where} geeft geen antwoord (time-out). Meestal blokkeert een firewall of de provider uitgaand verkeer naar die poort (vaak poort 25). Probeer 587 met STARTTLS of 465 met SSL/TLS.`;
  }
  return `${where} is niet bereikbaar. Controleer server en poort en of de server naar buiten mag verbinden.`;
}

/**
 * Maakt van een fout bij het versturen een melding waar de beheerder iets mee kan: wat er misging en waar het meestal
 * aan ligt, met het antwoord van de mailserver erachter. Eigen fouten (`not_configured`, `invalid_to`, `invalid_host`)
 * zijn al leesbaar. Nooit het wachtwoord of een e-mailadres.
 * @param {Error & {code?: string, command?: string, response?: string, mailHost?: string, mailPort?: number}} error De fout.
 * @returns {string} De melding, beginnend met "Versturen mislukt:".
 */
function mailFailure(error) {
  const code = String((error && error.code) || '');
  const reply = serverReply(error);
  /**
   * De melding met het antwoord van de mailserver erachter (als die er is).
   * @param {string} text Wat er misging en wat te controleren.
   * @returns {string} De volledige melding.
   */
  const withReply = (text) => `Versturen mislukt: ${text}${reply ? ` (mailserver: ${reply})` : ''}`;
  if (['not_configured', 'invalid_to', 'invalid_host'].includes(code)) return `Versturen mislukt: ${error.message}`;
  if (!code && !reply) return 'Versturen mislukt door een interne fout; de oorzaak staat in het serverlog.';
  const where = error.mailHost ? `${error.mailHost}:${error.mailPort}` : 'de mailserver';
  if (code === 'EAUTH') return withReply('de mailserver weigert de inloggegevens. Controleer gebruikersnaam en wachtwoord (bij Microsoft 365 of Gmail vaak een app-wachtwoord).');
  const connectionProblem = ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(code);
  const message = String((error && error.message) || '');
  // Eerst TLS: een certificaatfout komt vaak als ESOCKET, maar de oplossing is een andere.
  if (code === 'ETLS' || /CERT|SIGNED|UNABLE_TO_VERIFY|TLS|SSL/.test(code) || (connectionProblem && /certificate|self.signed|TLS|SSL/i.test(message))) {
    return withReply('de beveiligde verbinding (TLS) met de mailserver lukt niet. Controleer de poort en de instelling SSL/TLS; een ongeldig certificaat wordt niet geaccepteerd.');
  }
  if (connectionProblem) return withReply(connectionAdvice(code, message, where));
  if (code === 'EENVELOPE') {
    return withReply(error.command === 'MAIL FROM'
      ? 'de mailserver weigert het afzenderadres. Gebruik een afzender waarvoor deze mailserver mag versturen (bij een connector: een domein van de eigen organisatie).'
      : 'de mailserver weigert het adres van de ontvanger.');
  }
  if (code === 'EMESSAGE') return withReply('de mailserver weigert het bericht (bijvoorbeeld te groot of als spam gezien).');
  return withReply('de mailserver gaf een fout.');
}

/**
 * Legt vast bij welke mailserver (host, poort) een fout hoort, zodat de melding die kan noemen.
 * @param {Error} error De fout van nodemailer.
 * @param {{host: string, port: number}} server De mailserver.
 * @returns {Error} Dezelfde fout, met `mailHost` en `mailPort`.
 */
function tagServer(error, server) {
  if (error && typeof error === 'object' && !error.mailHost) Object.assign(error, { mailHost: server.host, mailPort: server.port });
  return error;
}

/**
 * Maakt de mailer.
 * @param {{settings: object, createTransport?: Function, resolveHost?: Function, now?: () => number}} options De
 *   instellingen (`beheer/settings.js`); voor tests een eigen `createTransport` (nodemailer), `resolveHost`
 *   (standaard `publicAddress`) en klok.
 * @returns {{configured: Function, server: Function, send: Function, recent: Function}} De mailfuncties.
 */
function createMailer(options) {
  const { settings } = options;
  const createTransport = options.createTransport || nodemailer.createTransport;
  const resolveHost = options.resolveHost || publicAddress;
  const now = options.now || Date.now;
  /** Laatste verzendingen, nieuwste eerst: `{at, kind, ok, message}` (nooit adressen of inhoud). */
  const events = [];

  /**
   * De ingestelde mailserver.
   * @returns {{mode: string, host: string, port: number, secure: boolean, user: string, fromName: string, fromAddress: string, replyTo: string}} De instellingen.
   */
  const server = () => ({
    mode: settings.get('mailMode'),
    host: settings.get('mailHost'),
    port: settings.get('mailPort'),
    secure: settings.get('mailSecure'),
    user: settings.get('mailUser'),
    fromName: settings.get('mailFromName'),
    fromAddress: settings.get('mailFromAddress'),
    replyTo: settings.get('mailReplyTo'),
  });

  /**
   * Of er een mailserver is ingesteld (server en afzender).
   * @returns {boolean} Waar als er gemaild kan worden.
   */
  const configured = () => {
    const current = server();
    return Boolean(current.host && current.fromAddress);
  };

  /**
   * Legt een verzending vast voor het overzicht.
   * @param {string} kind Soort mail (bijv. `testmail`).
   * @param {boolean} ok Gelukt of niet.
   * @param {string} message Melding (zonder adressen).
   * @returns {void}
   */
  const record = (kind, ok, message) => {
    events.unshift({ at: new Date(now()), kind: scrub(kind, 60), ok, message: scrub(message, 300) });
    events.length = Math.min(events.length, RECENT_LIMIT);
  };

  /**
   * Maakt de verbinding (transport) met de ingestelde mailserver.
   * @returns {Promise<{transport: object, current: object}>} Het transport en de instellingen.
   * @throws {Error} Met code `invalid_host` als de server geen openbaar adres heeft of niet bestaat.
   */
  const openTransport = async () => {
    const current = server();
    let address;
    try {
      address = await resolveHost(current.host);
    } catch (error) {
      throw Object.assign(new Error(error.code === 'private_host' ? 'de mailserver moet een openbaar adres hebben.' : 'de mailserver is niet gevonden.'), { code: 'invalid_host' });
    }
    const transport = createTransport({
      host: address,
      servername: current.host,
      port: current.port,
      secure: current.secure,
      auth: current.mode === 'smtp' && current.user ? { user: current.user, pass: settings.get('mailPassword') } : undefined,
      // Zonder SSL/TLS vanaf het begin moet STARTTLS lukken: nooit wachtwoord of mail onversleuteld versturen.
      requireTLS: !current.secure,
      // Het certificaat wordt gecontroleerd op de naam van de server, niet op het opgezochte adres.
      tls: { servername: current.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    return { transport, current };
  };

  /**
   * Verstuurt een e-mail en legt de uitkomst vast. Fouten gaan zonder adressen naar het serverlog.
   * @param {{to: (string|string[]), subject: string, text: string, html?: string, replyTo?: string, attachments?: object[], kind?: string}} message
   *   Het bericht; `attachments` alleen uit eigen code (zoals het ingebedde logo, hoogstens 3); `kind` is de soort voor het overzicht.
   * @returns {Promise<object>} Het resultaat van nodemailer.
   * @throws {Error} Met code `not_configured`, `invalid_to` of `invalid_host`, of de fout van nodemailer (zie `mailFailure`).
   */
  const send = async (message) => {
    const kind = message.kind || 'mail';
    try {
      if (!configured()) throw Object.assign(new Error('er is geen mailserver ingesteld.'), { code: 'not_configured' });
      const list = (Array.isArray(message.to) ? message.to : [message.to]).filter(validEmail).map((address) => address.trim()).slice(0, 10);
      if (!list.length) throw Object.assign(new Error('geen geldig e-mailadres voor de ontvanger.'), { code: 'invalid_to' });
      const { transport, current } = await openTransport();
      try {
        const replyTo = validEmail(message.replyTo) ? message.replyTo.trim() : current.replyTo || undefined;
        const result = await transport.sendMail({
          from: { name: current.fromName.replace(/[\r\n"<>]/g, ''), address: current.fromAddress },
          to: list,
          replyTo,
          subject: String(message.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
          text: message.text,
          html: message.html,
          attachments: Array.isArray(message.attachments) && message.attachments.length ? message.attachments.slice(0, 3) : undefined,
        });
        record(kind, true, 'Verstuurd.');
        return result;
      } catch (error) {
        throw tagServer(error, current);
      } finally {
        if (typeof transport.close === 'function') transport.close();
      }
    } catch (error) {
      const text = mailFailure(error);
      console.warn(`[mail] ${scrub(kind, 60)}: ${scrub(String(error.code || 'geen code'), 40)} ${scrub(error.message, 300)}`);
      record(kind, false, text);
      throw error;
    }
  };

  /**
   * De laatste verzendingen, nieuwste eerst.
   * @returns {Array<{at: Date, kind: string, ok: boolean, message: string}>} Kopie van de lijst.
   */
  const recent = () => events.map((event) => ({ ...event }));

  return { configured, server, send, recent };
}

module.exports = { createMailer, mailFailure, validEmail, scrub, RECENT_LIMIT };
