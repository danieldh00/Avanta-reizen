/**
 * Design-controle, stap 1: vult een verse, lokaal draaiende app met testgegevens zodat elk scherm iets te tonen heeft.
 * Alles gaat via de echte schermen (Playwright), behalve extra CRM-gebruikers per rol en het reizigersaccount, die
 * rechtstreeks in de database komen (mail is lokaal niet ingesteld, dus een bevestigingslink komt nooit aan).
 *
 * Gebruik (app draait al met een database waarin de import is gedaan, nog zonder CRM-gebruikers):
 *   DESIGN_BASE_URL=http://localhost:3400 DATABASE_URL=postgres://… SETUP_CODE=<installatiecode uit het log> \
 *     node tools/design-check/seed.js
 * Schrijft niets weg buiten de database; de inloggegevens staan in `credentials.js` (alleen voor lokaal testen).
 */
const { createDatabase } = require('../../src/database/db');
const { hashPassword } = require('../../src/crm/passwords');
const { ADMIN, CUSTOMER, ROLE_USERS } = require('./credentials');

const BASE_URL = process.env.DESIGN_BASE_URL || 'http://localhost:3400';

/** Fictieve reizigers voor de aanmeldingen (geen echte personen). */
const TRAVELLERS = [
  { gender: 'vrouw', first: 'Anna Maria', call: 'Anna', last: 'de Vries', email: CUSTOMER.email, city: 'Goes', payment: 'aanbetaling', church: 'PKN', particulars: 'Notenallergie, heeft altijd een EpiPen bij zich.' },
  { gender: 'man', first: 'Johannes Pieter', call: 'Hans', last: 'van den Berg-Achternaamlang', email: 'hans@example.nl', city: 'Middelburg', payment: 'totaal' },
  { gender: 'vrouw', first: 'Elisabeth', call: 'Lisa', last: 'Jansen', email: 'lisa@example.nl', city: 'Rotterdam', payment: 'aanbetaling' },
  { gender: 'man', first: 'Daniël', call: 'Daan', last: 'Bakker', email: 'daan@example.nl', city: 'Utrecht', payment: 'aanbetaling' },
  { gender: 'vrouw', first: 'Sophie', call: 'Sophie', last: 'Visser', email: 'sophie@example.nl', city: "'s-Hertogenbosch", payment: 'totaal' },
];

/**
 * Wacht kort; het aanmeldformulier weigert inzendingen die sneller dan drie seconden na het laden komen.
 * @param {number} milliseconds Wachttijd.
 * @returns {Promise<void>}
 */
const pause = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

/**
 * Maakt de eerste beheerder aan via het installatiescherm.
 * @param {object} page Playwright-pagina.
 * @returns {Promise<void>}
 */
async function installAdmin(page) {
  await page.goto(`${BASE_URL}/app/installatie/`);
  await page.fill('[name=code]', process.env.SETUP_CODE || '');
  await page.fill('[name=name]', ADMIN.name);
  await page.fill('[name=email]', ADMIN.email);
  await page.fill('[name=password]', ADMIN.password);
  await page.fill('[name=password2]', ADMIN.password);
  await Promise.all([page.waitForLoadState('load'), page.click('button[type=submit]')]);
}

/**
 * Zoekt een aantal reizen met een toekomstige vertrekdatum die nog niet vol zijn.
 * @param {object} db Database.
 * @returns {Promise<Array<{slug: string}>>} Reizen.
 */
async function openTrips(db) {
  return db.query(`SELECT slug FROM trips WHERE departure_date > now() AND NOT fully_booked AND price_cents > 0
    ORDER BY departure_date LIMIT 3`);
}

/**
 * Vult het openbare aanmeldformulier in en verstuurt het.
 * @param {object} page Playwright-pagina.
 * @param {string} slug Slug van de reis.
 * @param {object} traveller Reiziger uit `TRAVELLERS`.
 * @returns {Promise<number>} HTTP-status van het antwoord.
 */
async function submitBooking(page, slug, traveller) {
  await page.goto(`${BASE_URL}/aanmelden/?reis=${encodeURIComponent(slug)}`);
  const form = page.locator('form').filter({ has: page.locator('[name=first_names]') });
  await form.locator(`[name=gender][value=${traveller.gender}]`).check();
  await form.locator('[name=first_names]').fill(traveller.first);
  await form.locator('[name=call_name]').fill(traveller.call);
  await form.locator('[name=last_name]').fill(traveller.last);
  await form.locator('[name=birth_date]').fill('1990-05-17');
  await form.locator('[name=mobile]').fill('0612345678');
  await form.locator('[name=email]').fill(traveller.email);
  await form.locator('[name=email_confirm]').fill(traveller.email);
  await form.locator('[name=street]').fill('Voorbeeldstraat 12');
  await form.locator('[name=postal_code]').fill('4461 AB');
  await form.locator('[name=city]').fill(traveller.city);
  await form.locator('[name=occupation]').fill('Verpleegkundige');
  if (traveller.church) {
    await form.locator('[name=church]').fill(traveller.church);
    await form.locator('[name=consent_religion]').check();
  }
  await form.locator('[name=emergency_phone]').fill('0687654321');
  await form.locator('[name=nationality]').fill('Nederlandse');
  await form.locator('[name=document_type][value=paspoort]').check();
  await form.locator('[name=document_number]').fill('NW1234567');
  await form.locator('[name=document_valid_until]').fill('2031-01-01');
  if (traveller.particulars) {
    await form.locator('[name=particulars]').fill(traveller.particulars);
    await form.locator('[name=consent_health]').check();
  }
  for (const name of ['earlier_trip', 'credit_card', 'driver_interest', 'driver_before']) {
    await form.locator(`[name=${name}][value=nee]`).check();
  }
  await form.locator(`[name=payment_choice][value=${traveller.payment}]`).check();
  await form.locator('[name=consent]').check();
  await pause(3200);
  const [response] = await Promise.all([page.waitForNavigation(), form.locator('button[type=submit]').click()]);
  return response ? response.status() : 0;
}

/**
 * Logt in op het CRM (zonder tweede stap: die staat standaard uit tot de livegang).
 * @param {object} page Playwright-pagina.
 * @param {{email: string, password: string}} user Gebruiker.
 * @returns {Promise<void>}
 */
async function loginCrm(page, user) {
  await page.goto(`${BASE_URL}/app/inloggen/`);
  // Na de installatie is de beheerder al ingelogd; het CRM stuurt dan door naar het overzicht.
  if (!(await page.locator('[name=password]').count())) return;
  await page.fill('[name=email]', user.email);
  await page.fill('[name=password]', user.password);
  await Promise.all([page.waitForLoadState('load'), page.click('form button[type=submit]')]);
}

/**
 * Boekt een gedeeltelijke betaling op de eerste aanmelding, zodat de betaalschermen een saldo tonen.
 * @param {object} page Ingelogde pagina.
 * @param {object} db Database.
 * @returns {Promise<void>}
 */
async function recordPayment(page, db) {
  const [booking] = await db.query('SELECT id FROM bookings ORDER BY id LIMIT 1');
  if (!booking) return;
  await page.goto(`${BASE_URL}/app/betalingen/${booking.id}/`);
  await page.fill('[name=bedrag]', '250,00');
  await Promise.all([page.waitForLoadState('load'), page.locator('form:has([name=bedrag][id=veld-bedrag]) button[type=submit]').first().click()]);
}

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
  if (process.env.NODE_ENV === 'production') throw new Error('seed.js draait niet met NODE_ENV=production.');
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
  if (remote.length) throw new Error(`seed.js draait alleen tegen een lokale database (host ${remote.join(', ')}); zet DESIGN_SEED_TOEGESTAAN=1 voor een wegwerpcontainer.`);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(^|[_-])(design|test)([_-]|$)/i.test(name)) throw new Error(`seed.js draait alleen tegen een test- of ontwerpdatabase ("design" of "test" als los deel van de naam, bijv. avanta_design), niet tegen "${name}".`);
}

/**
 * Weigert een ander basisadres dan een lokale app: het script verstuurt aanmeldingen via de echte formulieren en maakt
 * bij een lege database de eerste beheerder aan, dus nooit tegen een publieke omgeving. Alleen met
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
  if (!LOCAL_HOSTS.includes(parsed.hostname)) throw new Error(`seed.js draait alleen tegen een lokale app (DESIGN_BASE_URL host ${parsed.hostname}); zet DESIGN_SEED_TOEGESTAAN=1 voor een wegwerpcontainer.`);
}

/**
 * Voert alle stappen uit.
 * @returns {Promise<void>}
 */
async function main() {
  assertLocalDatabase(process.env.DATABASE_URL || '');
  assertLocalBaseUrl(BASE_URL);
  // Playwright is geen dependency van de app; het staat in de ontwikkelomgeving.
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright');
  const db = createDatabase(process.env.DATABASE_URL);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM users');
    if (count === 0) await installAdmin(page);
    const hash = await hashPassword(ADMIN.password);
    for (const user of ROLE_USERS) {
      await db.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [user.email, user.name, user.role, hash]);
    }
    const [{ bookings }] = await db.query('SELECT count(*)::int AS bookings FROM bookings');
    if (bookings === 0) {
      const trips = await openTrips(db);
      for (const [index, traveller] of TRAVELLERS.entries()) {
        const status = await submitBooking(page, trips[index % trips.length].slug, traveller);
        console.log(`aanmelding ${traveller.call}: ${status}`);
      }
    }
    await db.query(`INSERT INTO customer_accounts (email, password_hash, verified_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`,
      [CUSTOMER.email, await hashPassword(CUSTOMER.password)]);
    await loginCrm(page, ADMIN);
    await recordPayment(page, db);
    console.log('testgegevens klaar');
  } finally {
    await browser.close();
    await db.close();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { assertLocalDatabase, assertLocalBaseUrl };
