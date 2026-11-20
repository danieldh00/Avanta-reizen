/**
 * Eenvoudige limiet per bezoeker (in het geheugen): maximaal N verzoeken per tijdvenster.
 * Een IPv6-adres telt per /64, zodat één aansluiting niet eindeloos nieuwe adressen kan gebruiken.
 */

/**
 * Sleutel voor een bezoeker: IPv4-adres of het /64-voorvoegsel van IPv6.
 * @param {object} req Express-verzoek.
 * @returns {string} Sleutel.
 */
function clientKey(req) {
  const address = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (address.includes(':')) return address.split(':').slice(0, 4).join(':');
  return address;
}

/**
 * Maakt een limiet.
 * @param {{limit: number, windowMs: number, now?: () => number}} options Aantal, venster en (voor tests) de klok.
 * @returns {{hit: (key: string) => boolean, reset: () => void}} hit() geeft false als de limiet is bereikt.
 */
function createRateLimiter(options) {
  const hits = new Map();
  const now = options.now || Date.now;
  return {
    /**
     * Telt een verzoek.
     * @param {string} key Sleutel van de bezoeker.
     * @returns {boolean} Waar als het verzoek is toegestaan.
     */
    hit(key) {
      const time = now();
      if (hits.size > 10000) {
        for (const [storedKey, entry] of hits) if (entry.resetAt <= time) hits.delete(storedKey);
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= time) {
        hits.set(key, { count: 1, resetAt: time + options.windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= options.limit;
    },
    /**
     * Wist alle tellers.
     * @returns {void}
     */
    reset() {
      hits.clear();
    },
  };
}

module.exports = { clientKey, createRateLimiter };
