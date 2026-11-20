/**
 * Uitgaande verbindingen naar adressen die een beheerder zelf invult (zoals de mailserver) mogen niet naar het eigen
 * netwerk van de server: anders kan iemand via de app het lokale netwerk aftasten (SSRF). Daarom wordt de naam eerst
 * opgezocht en alleen een openbaar adres toegestaan; de verbinding gaat daarna naar precies dat adres. Overgenomen uit
 * AquaTech (`beveiliging/netguard.js`).
 */
const dns = require('node:dns').promises;
const net = require('node:net');

// Twee lijsten: een IPv6-regel als ::ffff:0:0/96 zou in één lijst ook elk IPv4-adres blokkeren.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED_V4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED_V6.addSubnet(address, prefix, 'ipv6');

/**
 * Of een IP-adres openbaar is (niet lokaal, privé, gereserveerd of multicast).
 * @param {string} ip Een IPv4- of IPv6-adres.
 * @returns {boolean} Waar bij een openbaar adres; onwaar bij een privéadres of iets dat geen IP-adres is.
 */
function isPublicAddress(ip) {
  const version = net.isIP(ip);
  if (!version) return false;
  return version === 6 ? !BLOCKED_V6.check(ip, 'ipv6') : !BLOCKED_V4.check(ip, 'ipv4');
}

class PrivateHostError extends Error {
  /**
   * Fout als een host naar een niet-openbaar adres wijst (code `private_host`).
   * @param {string} host De opgezochte hostnaam.
   */
  constructor(host) {
    super(`${host} is geen openbaar adres.`);
    this.code = 'private_host';
  }
}

/**
 * Zoekt een hostnaam op en geeft het eerste adres terug, maar alleen als álle adressen openbaar zijn. IPv4 gaat voor:
 * een container zonder IPv6-route loopt anders vast op een IPv6-adres.
 * @param {string} host Hostnaam of IP-adres (IPv6 mag tussen [ ]).
 * @param {{lookup?: Function}} [options] Eigen DNS-opzoekfunctie (voor tests).
 * @returns {Promise<string>} Het openbare IP-adres.
 * @throws {PrivateHostError} Als een adres niet openbaar is.
 */
async function publicAddress(host, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const name = String(host || '').replace(/^\[|\]$/g, '');
  const addresses = net.isIP(name) ? [name] : (await lookup(name, { all: true, verbatim: true })).map((entry) => entry.address);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new PrivateHostError(name);
  return addresses.find((address) => net.isIPv4(address)) || addresses[0];
}

module.exports = { isPublicAddress, publicAddress, PrivateHostError };
