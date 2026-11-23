/**
 * Gezondheidscontrole `/api/health` voor Docker, het updatescript en de bewaking.
 *
 * Iedereen krijgt `{ ok: true }` als de app en de database werken, anders 503 met `{ ok: false }`. Het versienummer
 * staat er alleen bij voor een verzoek van binnen de server (audit A23: een publiek versienummer maakt het opzoeken van
 * bekende lekken makkelijker). "Van binnen" betekent dat de directe verbinding van een intern adres komt (loopback of
 * een privénetwerk zoals het Docker-netwerk), dat die verbinding niet van de vertrouwde reverse proxy komt en dat er
 * geen doorstuurkop in het verzoek staat. Zo krijgen `update.sh` en `servertaken.sh` (curl naar 127.0.0.1 op de host,
 * via de Docker-poort) de versie wel, en een bezoeker via Cloudflare en de tunnel niet.
 */
const net = require('node:net');

/** Netwerken die als "binnen de server" gelden: loopback, privé-IPv4, link-local en IPv6 unique-local. */
const INTERNAL_NETWORKS = new net.BlockList();
for (const [address, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]]) {
  INTERNAL_NETWORKS.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]]) INTERNAL_NETWORKS.addSubnet(address, prefix, 'ipv6');

/** Koppen die een proxy toevoegt; staat er één in het verzoek, dan komt het van buiten en is er geen versie. */
const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'];

/**
 * Haalt het IPv4-deel uit een IPv4-adres in IPv6-vorm (`::ffff:172.18.0.1` → `172.18.0.1`).
 * @param {string} address Adres van de verbinding.
 * @returns {string} Het adres in zijn eigen vorm.
 */
function plainAddress(address) {
  const text = String(address || '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  return mapped ? mapped[1] : text;
}

/**
 * Of een adres binnen de server of het eigen (Docker-)netwerk ligt.
 * @param {string} address IPv4- of IPv6-adres.
 * @returns {boolean} Waar bij loopback, een privénetwerk of link-local; onwaar bij iets anders of geen IP-adres.
 */
function isInternalAddress(address) {
  const plain = plainAddress(address);
  const version = net.isIP(plain);
  if (!version) return false;
  return INTERNAL_NETWORKS.check(plain, version === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Of een verzoek van binnen de server komt en dus de versie mag zien.
 * @param {{socket: {remoteAddress?: string}, headers: object}} req Express-verzoek (alleen de verbinding en de koppen).
 * @param {string} trustedProxy Het IP-adres van de vertrouwde reverse proxy (`TRUST_PROXY`), of `loopback`.
 * @returns {boolean} Waar als de directe verbinding intern is, niet van de proxy komt en geen doorstuurkop heeft.
 */
function isInternalRequest(req, trustedProxy) {
  const remote = plainAddress(req.socket && req.socket.remoteAddress);
  if (!isInternalAddress(remote)) return false;
  if (trustedProxy && trustedProxy !== 'loopback' && plainAddress(trustedProxy) === remote) return false;
  return !FORWARDING_HEADERS.some((name) => req.headers[name] !== undefined);
}

/**
 * Maakt de route voor `/api/health`.
 * @param {{db: {query: Function}, version: string, trustedProxy: string}} options De database, het versienummer van
 *   de app en de vertrouwde proxy (zie `isInternalRequest`).
 * @returns {Function} Express-handler.
 */
function createHealthRoute({ db, version, trustedProxy }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await db.query('SELECT 1 AS ok');
      res.json(isInternalRequest(req, trustedProxy) ? { ok: true, version } : { ok: true });
    } catch (_) {
      res.status(503).json({ ok: false });
    }
  };
}

module.exports = { createHealthRoute, isInternalRequest, isInternalAddress };
