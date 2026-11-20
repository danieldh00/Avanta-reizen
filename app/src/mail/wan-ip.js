/**
 * WAN-IP van deze server: het openbare IPv4-adres waarmee de server naar buiten verbindt (dus niet het adres van de
 * website achter Cloudflare). Een Exchange Online-connector op IP-basis moet precies dit adres vertrouwen. Opzoeken
 * bij een vaste externe dienst (nooit een adres uit invoer), met de uitkomst een uur in het geheugen. Aanpak uit
 * AquaTech (`platform/wan-ip.js`).
 */
const https = require('node:https');
const net = require('node:net');
const { isPublicAddress } = require('../security/netguard');

/** Diensten die alleen het IPv4-adres teruggeven (een Exchange-connector accepteert geen IPv6). */
const SOURCES = ['https://api.ipify.org', 'https://ipv4.icanhazip.com', 'https://v4.ident.me'];

/** Hoe lang een opgezocht adres geldt, en hoe vaak hooguit opnieuw mag worden opgezocht. */
const CACHE_MS = 60 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;

/**
 * Haalt de tekst van een korte https-pagina op, via IPv4, met tijdslimiet.
 * @param {string} url Adres van de pagina (uit `SOURCES`).
 * @param {{timeout?: number}} [options] Tijdslimiet in ms.
 * @returns {Promise<string>} De inhoud (hoogstens ruim 100 tekens).
 */
function fetchText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { family: 4, timeout: options.timeout || 5000, headers: { 'User-Agent': 'avanta-reizen' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 100) request.destroy(new Error('te lang'));
      });
      response.on('end', () => resolve(body));
    });
    request.on('timeout', () => request.destroy(new Error('time-out')));
    request.on('error', reject);
  });
}

/**
 * Of een waarde een openbaar IPv4-adres is.
 * @param {string} value De waarde.
 * @returns {boolean} Waar bij een openbaar IPv4-adres.
 */
function validIp(value) {
  return net.isIPv4(value) && isPublicAddress(value);
}

/**
 * Maakt de opzoeker van het WAN-IP.
 * @param {{fetch?: Function, now?: () => number, sources?: string[]}} [options] Voor tests: eigen ophaalfunctie, klok en diensten.
 * @returns {{get: Function, peek: Function}} `get({refresh})` zoekt op (of geeft het bewaarde adres); `peek()` geeft
 *   alleen het bewaarde adres, zonder iets op te zoeken.
 */
function createWanIp(options = {}) {
  const fetch = options.fetch || fetchText;
  const now = options.now || Date.now;
  const sources = options.sources || SOURCES;
  let cached = null;
  let pending = null;

  /**
   * Vraagt de diensten één voor één om het IPv4-adres.
   * @returns {Promise<string>} Het eerste geldige openbare adres.
   * @throws {Error} Met code `unavailable` als geen enkele dienst een geldig adres geeft.
   */
  const lookup = async () => {
    for (const url of sources) {
      try {
        const ip = String(await fetch(url)).trim();
        if (validIp(ip)) return ip;
      } catch (_) {
        // Volgende dienst proberen.
      }
    }
    throw Object.assign(new Error('Het WAN-IP kon niet worden bepaald.'), { code: 'unavailable' });
  };

  /**
   * Het bewaarde adres, zonder op te zoeken.
   * @returns {({ip: string, checkedAt: Date}|null)} Adres en tijdstip, of null.
   */
  const peek = () => (cached && now() - cached.at < CACHE_MS ? { ip: cached.ip, checkedAt: new Date(cached.at) } : null);

  /**
   * Het WAN-IP: uit het geheugen (een uur) of opnieuw opgezocht. Met `refresh` opnieuw, maar hoogstens eens per minuut.
   * @param {{refresh?: boolean}} [request] Opnieuw opzoeken.
   * @returns {Promise<{ip: string, checkedAt: Date}>} Adres en tijdstip.
   * @throws {Error} Met code `unavailable`.
   */
  const get = async (request = {}) => {
    const age = cached ? now() - cached.at : Infinity;
    if (cached && age < (request.refresh ? MIN_REFRESH_MS : CACHE_MS)) return { ip: cached.ip, checkedAt: new Date(cached.at) };
    if (!pending) {
      pending = lookup()
        .then((ip) => { cached = { ip, at: now() }; })
        .finally(() => { pending = null; });
    }
    await pending;
    return { ip: cached.ip, checkedAt: new Date(cached.at) };
  };

  return { get, peek };
}

module.exports = { createWanIp, validIp, SOURCES };
