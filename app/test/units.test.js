/**
 * Unit-tests zonder database: HTML-escaping, opschonen van geïmporteerde HTML, parsers, opmaak, kluis, limiet en
 * de controle van het aanmeldformulier, de formulierbescherming en het contactformulier.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { html, raw, toString, escapeHtml } = require('../src/site/html');
const { sanitizeHtml } = require('../tools/import/sanitize');
const parsers = require('../tools/import/parse');
const { formatPrice, formatDate, isoDate } = require('../src/site/format');
const { createVault, loadMasterKey } = require('../src/security/vault');
const { createRateLimiter, clientKey } = require('../src/security/rate-limit');
const { validateBooking } = require('../src/booking/fields');
const { rewriteLink, cacheName } = require('../tools/import-wordpress');
const { parseTrustProxy } = require('../src/server');
const { isInternalRequest, isInternalAddress } = require('../src/system/health');
const { securityTxt } = require('../src/site/seo');
const { createPasswordCheck, commonPasswordProblem, breachCount } = require('../src/security/password-check');
const net = require('node:net');
const { createDatabase, poolOptions, DEFAULT_CONNECT_TIMEOUT_MS } = require('../src/database/db');

test('html escapet ingevoegde waarden maar niet raw()', () => {
  const name = '<script>alert("x")</script>';
  assert.equal(toString(html`<p>${name}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(toString(html`<div>${raw('<b>ok</b>')}</div>`), '<div><b>ok</b></div>');
  assert.equal(toString(html`<ul>${['a', '<b>'].map((item) => html`<li>${item}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(escapeHtml(`'"&`), '&#39;&quot;&amp;');
  assert.equal(toString(html`${null}${undefined}${false}`), '');
});

test('sanitizeHtml verwijdert scripts, handlers, gevaarlijke links en herschrijft URLs', () => {
  const dirty = `<h1>Kop</h1><p onclick="x()" style="color:red">Tekst <a href="javascript:alert(1)">kwaad</a>
    <a href="https://www.avantareizen.nl/reis/abc/" target="_blank">reis</a></p><script>steel()</script>
    <img src="https://www.avantareizen.nl/app/uploads/a.jpg" onerror="x()" srcset="b 2x"><img src="data:image/png;base64,AAA">
    <iframe src="https://www.youtube.com/embed/abc"></iframe><svg><script>x()</script></svg><form><input name="a"></form>
    <a href="//kwaad.example/">proto-relatief</a><p>&nbsp;</p>`;
  const clean = sanitizeHtml(dirty, { rewriteLink, rewriteImage: () => '/media/a.jpg' });
  assert.doesNotMatch(clean, /script|onclick|onerror|style=|javascript:|srcset|<svg|<form|<input|data:image|kwaad\.example/i);
  assert.match(clean, /<h2>Kop<\/h2>/);
  assert.match(clean, /<a href="\/reis\/abc\/" target="_blank" rel="noopener">reis<\/a>/);
  assert.match(clean, /<img src="\/media\/a.jpg" alt="" loading="lazy">/);
  assert.match(clean, /Bekijk de video/);
  assert.doesNotMatch(clean, /<p><\/p>/);
});

test('parsers lezen bedragen, datums en slugs', () => {
  assert.equal(parsers.parseEuros('€1849,-'), 184900);
  assert.equal(parsers.parseEuros('€ 1.849,50'), 184950);
  assert.equal(parsers.parseEuros('geen'), null);
  assert.equal(parsers.parseDutchDate('03-12-2026'), '2026-12-03');
  assert.equal(parsers.parseDutchDate('3-1-2027'), '2027-01-03');
  assert.equal(parsers.slugFromUrl('https://www.avantareizen.nl/reis/%c2%b1-20-dagen-namibie/'), '±-20-dagen-namibie');
  assert.equal(parsers.pathFromUrl('https://www.avantareizen.nl/avanta-reizen/voorpret'), '/avanta-reizen/voorpret/');
  assert.equal(parsers.backgroundUrl('background-image: url(https://x/a.jpg); '), 'https://x/a.jpg');
  assert.equal(cacheName('https://www.avantareizen.nl/'), 'home.html');
  assert.equal(cacheName('https://www.avantareizen.nl/reis/abc/'), 'reis__abc.html');
});

test('parseTrip leest de gegevens van een reispagina', () => {
  const page = `<html><body class="single single-journey postid-77">
    <div class="page-header"><div class="page-header__image" style="background-image: url(https://www.avantareizen.nl/app/uploads/h.jpg);"></div>
    <h1 class="page-header__title">8 dagen Albanië</h1></div>
    <div class="guide-widget__title"><a href="https://www.avantareizen.nl/reisleider/123/">Harmen</a></div>
    <div class="trip-types"><a href="https://www.avantareizen.nl/reis-categorie/kamperen/" class="trip-type" title="Kampeerreizen"></a></div>
    <div class="page-introduction">Ruige bergen</div>
    <div class="page-content"><div class="page-content__text"><p><strong>[NOG 3 PLAATSEN]</strong> Tekst</p></div></div>
    <div class="trip__meta"><span class="trip__price"><span class="trip__price--old">&euro;975,-</span> &euro;799,-</span>
    <span class="trip__additional-costs">Bijkomende kosten <span>&euro;400,-</span></span><span class="trip__offer-date">* Bij boeking voor 01-12-2026</span>
    <dl><dt>Reiscode</dt><dd>27-AKO-56</dd><dt>Vertrek</dt><dd>29-04-2027</dd><dt>Reisduur</dt><dd>8 dagen</dd>
    <dt>Bestemming</dt><dd><a href="https://www.avantareizen.nl/reis-categorie/albanie/">Albanië</a></dd></dl>
    <div class="trip__guaranteed"><h3>Gegarandeerd vertrek</h3></div><span class="btn btn--inactive">Volgeboekt</span></div>
    <div class="page-gallery"><div class="section__title">Albanees avontuur</div><img src="https://www.avantareizen.nl/app/uploads/g.jpg" alt="berg"></div>
    </body></html>`;
  const trip = parsers.parseTrip(page, 'https://www.avantareizen.nl/reis/8-dagen-albanie/');
  assert.equal(trip.legacyId, 77);
  assert.equal(trip.slug, '8-dagen-albanie');
  assert.equal(trip.title, '8 dagen Albanië');
  assert.equal(trip.tripCode, '27-AKO-56');
  assert.equal(trip.departureDate, '2027-04-29');
  assert.equal(trip.durationDays, 8);
  assert.equal(trip.priceCents, 79900);
  assert.equal(trip.oldPriceCents, 97500);
  assert.equal(trip.offerUntil, '2026-12-01');
  assert.equal(trip.extraCostsCents, 40000);
  assert.equal(trip.guideRef, '123');
  assert.deepEqual(trip.types.map((type) => type.slug), ['kamperen']);
  assert.deepEqual(trip.destinations.map((destination) => destination.slug), ['albanie']);
  assert.equal(trip.guaranteed, true);
  assert.equal(trip.fullyBooked, true);
  assert.equal(trip.statusLabel, 'nog 3 plaatsen');
  assert.equal(trip.gallery.length, 1);
});

test('formatPrice en formatDate', () => {
  assert.equal(formatPrice(184900), '€1.849,-');
  assert.equal(formatPrice(184950), '€1.849,50');
  assert.equal(formatPrice(null), '');
  assert.equal(formatDate('2026-12-03'), '03-12-2026');
  assert.equal(isoDate(new Date(2026, 11, 3)), '2026-12-03');
});

test('kluis versleutelt en weigert gewijzigde gegevens', () => {
  const vault = createVault(Buffer.alloc(32, 7));
  const sealed = vault.seal({ church: 'Gemeente', birth_date: '2000-01-02' });
  assert.doesNotMatch(sealed, /Gemeente|2000/);
  assert.deepEqual(vault.open(sealed), { church: 'Gemeente', birth_date: '2000-01-02' });
  const parts = sealed.split('.');
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  assert.throws(() => vault.open(parts.join('.')));
  assert.throws(() => createVault(Buffer.alloc(32, 8)).open(sealed));
});

test('loadMasterKey maakt eenmalig een sleutelbestand aan', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-key-'));
  const first = loadMasterKey({ key: '', keyFile: '', dataDir: directory });
  const second = loadMasterKey({ key: '', keyFile: '', dataDir: directory });
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.throws(() => loadMasterKey({ key: 'kort' }), /64 hex/);
});

test('rate limiter telt per venster en per IPv6-/64', () => {
  let time = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), false);
  time = 1001;
  assert.equal(limiter.hit('a'), true);
  assert.equal(clientKey({ ip: '2001:db8:1:2:aaaa::1' }), clientKey({ ip: '2001:db8:1:2:bbbb::9' }));
  assert.equal(clientKey({ ip: '::ffff:10.0.0.1' }), '10.0.0.1');
});

/**
 * Een volledig en geldig ingevuld aanmeldformulier.
 * @returns {Record<string, string>} Velden.
 */
function validBooking() {
  return {
    gender: 'vrouw', first_names: 'Anna Maria', call_name: 'Anna', last_name: 'Jansen', birth_date: '1999-05-04',
    mobile: '06 12345678', email: 'anna@example.nl', email_confirm: 'Anna@example.nl', street: 'Dorpsstraat 1',
    postal_code: '4331 AB', city: 'Middelburg', occupation: 'Verpleegkundige', church: 'PKN', consent_religion: 'ja', consent_health: 'ja', nationality: 'Nederlandse',
    document_type: 'paspoort', earlier_trip: 'nee', credit_card: 'ja', driver_interest: 'nee', driver_before: 'nee',
    payment_choice: 'aanbetaling', consent: 'ja',
  };
}

test('validateBooking accepteert een goed formulier', () => {
  const { errors, values } = validateBooking(validBooking(), { today: '2026-11-19' });
  assert.deepEqual(errors, {});
  assert.equal(values.call_name, 'Anna');
});

test('validateBooking geeft fouten voor ontbrekende en ongeldige velden', () => {
  const body = { ...validBooking(), email_confirm: 'ander@example.nl', birth_date: '2030-01-01', gender: 'x', mobile: 'abc', consent: '' };
  delete body.last_name;
  const { errors } = validateBooking(body, { today: '2026-11-19' });
  assert.ok(errors.last_name && errors.email_confirm && errors.birth_date && errors.gender && errors.mobile && errors.consent);
  assert.ok(validateBooking({ ...validBooking(), birth_date: '2001-02-30' }, { today: '2026-11-19' }).errors.birth_date);
  assert.ok(validateBooking({ ...validBooking(), first_names: 'x'.repeat(121) }, { today: '2026-11-19' }).errors.first_names);
  assert.ok(validateBooking({ ...validBooking(), consent: 'nee' }, { today: '2026-11-19' }).errors.consent, 'alleen consent=ja telt');
  assert.equal(validateBooking({ ...validBooking(), particulars: 'Noten\u0000allergie' }, { today: '2026-11-19' }).values.particulars, 'Notenallergie');
});

test('validateBooking: art. 9-velden zijn vrijwillig, maar ingevuld alleen met eigen toestemming', () => {
  const day = { today: '2026-11-19' };
  assert.deepEqual(validateBooking({ ...validBooking(), church: '', consent_religion: '' }, day).errors, {}, 'leeg mag zonder vinkje');
  assert.ok(validateBooking({ ...validBooking(), consent_religion: '' }, day).errors.consent_religion);
  assert.ok(validateBooking({ ...validBooking(), consent_religion: 'nee' }, day).errors.consent_religion, 'alleen ja telt');
  assert.ok(validateBooking({ ...validBooking(), particulars: 'Astma', consent_health: '' }, day).errors.consent_health);
  assert.deepEqual(validateBooking({ ...validBooking(), particulars: 'Astma' }, day).errors, {});
});

test('form-guard: isCrossSite, ook met Origin null (Chrome bij Referrer-Policy no-referrer)', () => {
  const { isCrossSite } = require('../src/security/form-guard');
  /**
   * Bootst een Express-verzoek na met de opgegeven koppen.
   * @param {object} headers Koppen in kleine letters.
   * @returns {object} Verzoek met `get`, `protocol` en host.
   */
  const fakeRequest = (headers) => ({ protocol: 'https', get: (name) => ({ host: 'avanta.test', ...headers })[name.toLowerCase()] });
  assert.equal(isCrossSite(fakeRequest({})), false, 'geen koppen: geen andere site');
  assert.equal(isCrossSite(fakeRequest({ origin: 'https://avanta.test' })), false);
  assert.equal(isCrossSite(fakeRequest({ origin: 'https://evil.example' })), true);
  assert.equal(isCrossSite(fakeRequest({ origin: 'null', 'sec-fetch-site': 'same-origin' })), false, 'Chrome op een eigen pagina');
  assert.equal(isCrossSite(fakeRequest({ origin: 'null' })), true, 'null zonder Sec-Fetch-Site blijft verdacht');
  assert.equal(isCrossSite(fakeRequest({ origin: 'null', 'sec-fetch-site': 'cross-site' })), true);
  assert.equal(isCrossSite(fakeRequest({ origin: 'null', 'sec-fetch-site': 'none' })), true, 'none telt niet als eigen site bij null');
  assert.equal(isCrossSite(fakeRequest({ 'sec-fetch-site': 'same-site' })), true);
});

test('form-guard: token per formulier, minimale en maximale invultijd, honeypot', () => {
  const { createFormGuard, MIN_FILL_MS, MAX_FILL_MS } = require('../src/security/form-guard');
  let clock = 1_000_000;
  const options = { formKey: Buffer.alloc(32, 9), limit: 1, windowMs: 1000, limitMessage: 'te veel', now: () => clock };
  const contactGuard = createFormGuard({ ...options, purpose: 'contact' });
  const bookingGuard = createFormGuard({ ...options, purpose: 'aanmelden' });
  const token = contactGuard.signToken(clock);
  assert.equal(contactGuard.checkToken(token), false, 'te snel');
  clock += MIN_FILL_MS;
  assert.equal(contactGuard.checkToken(token), true);
  assert.equal(bookingGuard.checkToken(token), false, 'ander formulier');
  assert.equal(contactGuard.isBot({ token, website: 'x' }), true, 'honeypot');
  assert.equal(contactGuard.isBot({ token: 'vals' }), false, 'alleen de honeypot telt als bot');
  assert.equal(contactGuard.tokenProblem({ token }), '');
  assert.match(contactGuard.tokenProblem({ token: 'abc.def' }), /verlopen of te snel/);
  assert.equal(contactGuard.checkToken('abc.def'), false);
  clock += MAX_FILL_MS;
  assert.equal(contactGuard.checkToken(token), false, 'te oud');
});

test('contactformulier: validatie en normalisatie', () => {
  const { validateContact } = require('../src/contact/fields');
  const ok = validateContact({ name: '  Test   Persoon ', email: 'a@b.nl', phone: '', subject: '', message: 'Regel 1\r\nRegel 2', consent: 'ja' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.name, 'Test Persoon');
  assert.equal(ok.values.message, 'Regel 1\nRegel 2');
  const bad = validateContact({ email: 'geen', phone: 'x', name: ['array'] });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['consent', 'email', 'message', 'name', 'phone']);
  assert.ok(validateContact({ name: 'A', email: 'a@b.nl', message: 'x', consent: 'nee' }).errors.consent, 'alleen consent=ja telt');
  const control = validateContact({ name: 'Te\u0000st', email: 'a@b.nl', message: 'a\u0000b\u0007\tc\nd', consent: 'ja' });
  assert.equal(control.values.name, 'Test', 'NUL verwijderd');
  assert.equal(control.values.message, 'ab\tc\nd', 'stuurtekens weg, tab en regeleinde blijven');
});

test('TRUST_PROXY: alleen leeg/loopback of één exact IP-adres', () => {
  assert.equal(parseTrustProxy(undefined), 'loopback');
  assert.equal(parseTrustProxy('  '), 'loopback');
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('172.18.0.5'), '172.18.0.5');
  assert.equal(parseTrustProxy('fd00::5'), 'fd00::5');
  for (const unsafe of ['10.0.0.0/8', '172.16.0.0/12', 'loopback, 172.18.0.5', '1', 'true', 'uniquelocal']) {
    assert.throws(() => parseTrustProxy(unsafe), /TRUST_PROXY/);
  }
});

test('databasepool: verbindingstime-out en grootte uit de omgeving, ongeldige waarden vallen terug', () => {
  const standard = poolOptions('postgres://x', {});
  assert.equal(standard.max, 10);
  assert.equal(standard.connectionTimeoutMillis, DEFAULT_CONNECT_TIMEOUT_MS);
  assert.ok(standard.idleTimeoutMillis > 0);
  const custom = poolOptions('postgres://x', { DATABASE_POOL_SIZE: '4', DATABASE_CONNECT_TIMEOUT_MS: '1500' });
  assert.equal(custom.max, 4);
  assert.equal(custom.connectionTimeoutMillis, 1500);
  for (const wrong of ['0', '-3', 'abc', '1.5']) {
    assert.equal(poolOptions('postgres://x', { DATABASE_CONNECT_TIMEOUT_MS: wrong }).connectionTimeoutMillis, DEFAULT_CONNECT_TIMEOUT_MS, wrong);
  }
});

test('databasepool: een database die niet antwoordt geeft na de time-out een fout in plaats van eindeloos wachten', async () => {
  const sockets = [];
  const silent = net.createServer((socket) => sockets.push(socket));
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const previous = process.env.DATABASE_CONNECT_TIMEOUT_MS;
  process.env.DATABASE_CONNECT_TIMEOUT_MS = '300';
  const db = createDatabase(`postgres://test@127.0.0.1:${silent.address().port}/test`);
  try {
    const started = Date.now();
    await assert.rejects(db.query('SELECT 1'), /timeout/i);
    assert.ok(Date.now() - started < 3000, 'binnen enkele seconden');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_CONNECT_TIMEOUT_MS;
    else process.env.DATABASE_CONNECT_TIMEOUT_MS = previous;
    await db.close().catch(() => {});
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => silent.close(resolve));
  }
});

test('health: versie alleen voor verzoeken van binnen de server', () => {
  const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.18.0.1', '::ffff:172.18.0.1', '10.1.2.3', '192.168.1.5', 'fd00::5']) {
    assert.equal(isInternalAddress(address), true, address);
    assert.equal(isInternalRequest(request(address), 'loopback'), true, address);
  }
  for (const address of ['8.8.8.8', '::ffff:8.8.8.8', '2a00:1450::1', '', undefined, 'geen-ip']) {
    assert.equal(isInternalRequest(request(address), 'loopback'), false, String(address));
  }
  // De vertrouwde proxy (cloudflared) stuurt bezoekers door: geen versie, ook zonder doorstuurkop.
  assert.equal(isInternalRequest(request('172.18.0.9'), '172.18.0.9'), false);
  assert.equal(isInternalRequest(request('::ffff:172.18.0.9'), '172.18.0.9'), false);
  assert.equal(isInternalRequest(request('172.18.0.1'), '172.18.0.9'), true, 'de host via de Docker-poort wel');
  assert.equal(isInternalRequest(request('127.0.0.1', { 'x-forwarded-for': '8.8.8.8' }), 'loopback'), false);
  assert.equal(isInternalRequest(request('127.0.0.1', { forwarded: 'for=8.8.8.8' }), 'loopback'), false);
});

test('security.txt: contact, vervaldatum binnen een jaar en canonical', () => {
  const text = securityTxt({ siteUrl: 'https://www.avantareizen.nl', contact: { email: 'info@avantareizen.nl' } }, new Date('2026-11-23T17:00:00Z'));
  assert.equal(text, [
    'Contact: mailto:info@avantareizen.nl',
    'Expires: 2027-05-22T00:00:00Z',
    'Preferred-Languages: nl, en',
    'Canonical: https://www.avantareizen.nl/.well-known/security.txt',
    '',
  ].join('\n'));
});

test('wachtwoordcontrole: lokaal veelgebruikte woorden en reeksen', () => {
  for (const password of ['Wachtwoord2026!', 'Avantareizen1', 'Avanta-reizen-2026', '1234567890ab', 'Qwertyuiop12!', 'Welkom01welkom',
    'testtesttest', 'Zomer!Winter#2026', '123456789012', 'welkomwachtwoord', 'Geheim-wachtwoord-1', '0987654321zyx', 'abc1abc2abc3', 'qwe1qwe2qwe3', 'zyx1zyx2zyx3']) {
    assert.notEqual(commonPasswordProblem(password), '', password);
  }
  for (const password of ['Jezus is mijn herder', 'de kat zit op de mat', 'correct-paard-batterij-nietje', 'nieuw beheerwachtwoord', 'Sterk-Wachtwoord-2026!', '197503211985', 'kantoor wachtwoord 1']) {
    assert.equal(commonPasswordProblem(password), '', password);
  }
});

test('wachtwoordcontrole: Have I Been Pwned met k-anonimiteit', async () => {
  assert.equal(breachCount('ABC:0\r\nDEF:12\r\n', 'DEF'), 12);
  assert.equal(breachCount('ABC:0\r\n', 'DEF'), 0);
  let enabled = false;
  const requests = [];
  let reply = () => new Response('', { status: 200 });
  const check = createPasswordCheck({
    settings: { get: (key) => (key === 'passwordBreachCheck' ? enabled : undefined) },
    fetchImpl: async (url) => { requests.push(url); return reply(); },
  });
  // Uit: geen verzoek; vaste regels en lokale lijst gelden altijd.
  assert.equal(await check.problem('een prima wachtwoord'), '');
  assert.match(await check.problem('kort'), /minimaal 12/);
  assert.match(await check.problem('Wachtwoord2026!'), /te makkelijk/);
  assert.equal(requests.length, 0);
  enabled = true;
  const hash = require('node:crypto').createHash('sha1').update('een prima wachtwoord').digest('hex').toUpperCase();
  reply = () => new Response(`${hash.slice(5)}:3\r\n`, { status: 200 });
  assert.match(await check.problem('een prima wachtwoord'), /gelekte wachtwoorden/);
  assert.equal(requests.at(-1), `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
  assert.match(await check.problem('Wachtwoord2026!'), /te makkelijk/, 'lokaal geweigerd zonder verzoek');
  assert.equal(requests.length, 1);
  // Fout van de dienst, te groot antwoord of netwerkfout: alleen lokaal, dus goedgekeurd.
  reply = () => new Response('', { status: 503 });
  assert.equal(await check.problem('een prima wachtwoord'), '');
  reply = () => new Response('x', { status: 200, headers: { 'Content-Length': String(2 * 1024 * 1024) } });
  assert.equal(await check.problem('een prima wachtwoord'), '');
  // Zonder Content-Length (stroom in stukken): ook dan stopt het lezen bij de grens en wordt de stroom afgebroken.
  let cancelled = false;
  let sent = 0;
  reply = () => new Response(new ReadableStream({
    pull(controller) { sent += 1; controller.enqueue(new Uint8Array(256 * 1024).fill(65)); },
    cancel() { cancelled = true; },
  }), { status: 200 });
  assert.equal(await check.problem('een prima wachtwoord'), '');
  assert.equal(cancelled, true);
  assert.ok(sent <= 6, `afgebroken na ${sent} stukken`);
  reply = () => { throw new Error('weg'); };
  assert.equal(await check.problem('een prima wachtwoord'), '');
  assert.deepEqual(check.recent().map((event) => event.outcome), ['onbereikbaar', 'onbereikbaar', 'onbereikbaar', 'onbereikbaar', 'lokaal', 'gelekt', 'lokaal']);
});
