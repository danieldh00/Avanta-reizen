/**
 * Een kort https-verzoek naar een adres dat een beheerder zelf invult (webhook, heartbeat), alleen naar een openbaar
 * adres (`security/netguard.js`): de naam wordt eerst opgezocht en de verbinding gaat naar precies dat adres, zodat een
 * DNS-wissel tussendoor niet alsnog bij het eigen netwerk uitkomt. Geen omleidingen volgen, tijdslimiet, het antwoord
 * zelf wordt niet gelezen (alleen de statuscode).
 */
const https = require('node:https');
const net = require('node:net');
const { publicAddress } = require('./netguard');

/** Standaard tijdslimiet in milliseconden. */
const DEFAULT_TIMEOUT_MS = 10 * 1000;
/** Grootste hoeveelheid tekst die wordt verstuurd. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Fout met een korte code die veilig getoond kan worden (nooit het adres zelf, daar kan een token in staan).
 */
class SafeRequestError extends Error {
  /**
   * @param {string} code Korte code (`invalid_url`, `private_host`, `timeout`, `network`, `too_large`).
   * @param {string} message Uitleg in gewone taal.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Controleert een adres: alleen https, zonder gebruikersnaam of wachtwoord.
 * @param {string} value Adres.
 * @returns {URL} Het adres.
 * @throws {SafeRequestError} Bij een ongeldig adres.
 */
function parseHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch (_) {
    throw new SafeRequestError('invalid_url', 'Het adres is ongeldig.');
  }
  if (url.protocol !== 'https:') throw new SafeRequestError('invalid_url', 'Het adres moet met https:// beginnen.');
  if (url.username || url.password) throw new SafeRequestError('invalid_url', 'Een adres met gebruikersnaam of wachtwoord kan niet.');
  return url;
}

/**
 * Verstuurt een verzoek en geeft de statuscode.
 * @param {string} address Volledig https-adres.
 * @param {{method?: string, json?: object, timeoutMs?: number, resolveHost?: Function, request?: Function}} [options]
 *   Methode (standaard GET, of POST met `json`), tijdslimiet en voor tests een eigen opzoekfunctie en `https.request`.
 * @returns {Promise<{status: number}>} De statuscode van het antwoord.
 * @throws {SafeRequestError} Bij een ongeldig of privéadres, een time-out of een netwerkfout.
 */
async function safeRequest(address, options = {}) {
  const url = parseHttpsUrl(address);
  const resolveHost = options.resolveHost || publicAddress;
  const request = options.request || https.request;
  let ip;
  try {
    ip = await resolveHost(url.hostname);
  } catch (error) {
    if (error.code === 'private_host') throw new SafeRequestError('private_host', 'Het adres wijst naar een intern netwerk; dat mag niet.');
    throw new SafeRequestError('network', 'De naam van de server is niet gevonden.');
  }
  const body = options.json ? Buffer.from(JSON.stringify(options.json)) : null;
  if (body && body.length > MAX_BODY_BYTES) throw new SafeRequestError('too_large', 'Het bericht is te groot.');
  const method = options.method || (body ? 'POST' : 'GET');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const outgoing = request({
      protocol: 'https:',
      hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      // Verbinden met het gecontroleerde adres; het certificaat wordt gecontroleerd op de hostnaam.
      lookup: (_name, lookupOptions, callback) => {
        const family = net.isIPv6(ip) ? 6 : 4;
        if (lookupOptions && lookupOptions.all) return callback(null, [{ address: ip, family }]);
        return callback(null, ip, family);
      },
      servername: net.isIP(hostname) ? undefined : hostname,
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      headers: {
        'User-Agent': 'avanta-reizen',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
      },
    }, (response) => {
      response.resume();
      response.on('error', () => {});
      resolve({ status: response.statusCode });
    });
    outgoing.on('timeout', () => outgoing.destroy(new SafeRequestError('timeout', 'Geen antwoord binnen de tijd.')));
    outgoing.on('error', (error) => reject(error instanceof SafeRequestError ? error : new SafeRequestError('network', 'De server is niet bereikbaar.')));
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

module.exports = { safeRequest, parseHttpsUrl, SafeRequestError, MAX_BODY_BYTES };
