// @ts-check
/**
 * Design-controle: veiligheidscontroles die `seed.js`, `check.js` en `overview.js` vóór de eerste stap uitvoeren, zodat
 * testgegevens en het wachtwoord van de testaccounts nooit bij een echte database of een publieke omgeving terechtkomen.
 */

/** Hosts die als lokaal gelden. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Weigert te draaien tegen iets anders dan een lokale test- of ontwerpdatabase: de testaccounts hebben een bekend
 * wachtwoord en horen nooit op een omgeving met echte gegevens. Eisen: geen `NODE_ENV=production`, een lokale host (ook
 * in de query-parameters `host`/`hostaddr`, die de host uit het adres overschrijven, en in `PGHOST`/`PGHOSTADDR` als het
 * adres geen host heeft) en een databasenaam met `design` of
 * `test` als los deel van de naam (bijv. `avanta_design`, `avanta-test`). Alleen met `DESIGN_SEED_TOEGESTAAN=1` mag het afwijken (bijv. een wegwerpcontainer in CI).
 * @param {string} databaseUrl Verbindings-URL.
 * @returns {void} Gooit een fout als de database niet aan de eisen voldoet.
 */
function assertLocalDatabase(databaseUrl) {
  if (process.env.NODE_ENV === 'production') throw new Error('De design-controle draait niet met NODE_ENV=production.');
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL ontbreekt of is ongeldig.');
  }
  if (process.env.DESIGN_SEED_TOEGESTAAN === '1') return;
  // Zonder host in het adres valt de PostgreSQL-client terug op PGHOST/PGHOSTADDR; die tellen dan ook mee.
  const fallback = parsed.hostname ? [] : [process.env.PGHOST || '', process.env.PGHOSTADDR || ''];
  const hosts = [parsed.hostname, ...fallback, ...parsed.searchParams.getAll('host'), ...parsed.searchParams.getAll('hostaddr')]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  // Een host die met / begint is een lokale Unix-socket.
  const remote = hosts.filter((host) => !LOCAL_HOSTS.includes(host) && !host.startsWith('/'));
  if (remote.length) throw new Error(`De design-controle draait alleen tegen een lokale database (host ${remote.join(', ')}); zet DESIGN_SEED_TOEGESTAAN=1 voor een wegwerpcontainer.`);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(^|[_-])(design|test)([_-]|$)/i.test(name)) throw new Error(`seed.js draait alleen tegen een test- of ontwerpdatabase ("design" of "test" als los deel van de naam, bijv. avanta_design), niet tegen "${name}".`);
}

/**
 * Weigert een ander basisadres dan een lokale app: `seed.js` verstuurt aanmeldingen via de echte formulieren en maakt
 * bij een lege database de eerste beheerder aan, en `check.js` en `overview.js` sturen het wachtwoord van de testaccounts
 * mee bij het inloggen; dus nooit tegen een publieke omgeving. Alleen met
 * `DESIGN_SEED_TOEGESTAAN=1` mag het afwijken (bijv. een app-container in CI).
 * @param {string} baseUrl Basisadres van de app.
 * @returns {void} Gooit een fout bij een niet-lokaal adres.
 */
function assertLocalBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('DESIGN_BASE_URL is ongeldig.');
  }
  if (process.env.DESIGN_SEED_TOEGESTAAN === '1') return;
  if (!LOCAL_HOSTS.includes(parsed.hostname)) throw new Error(`De design-controle draait alleen tegen een lokale app (DESIGN_BASE_URL host ${parsed.hostname}); zet DESIGN_SEED_TOEGESTAAN=1 voor een wegwerpcontainer.`);
}

module.exports = { LOCAL_HOSTS, assertLocalDatabase, assertLocalBaseUrl };
