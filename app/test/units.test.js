/**
 * Unit-tests zonder database: HTML-escaping, opschonen van geïmporteerde HTML, parsers, opmaak, kluis, limiet en
 * de controle van het aanmeldformulier.
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
    postal_code: '4331 AB', city: 'Middelburg', occupation: 'Verpleegkundige', church: 'PKN', nationality: 'Nederlandse',
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
});

test('TRUST_PROXY: leeg is loopback, een getal is een aantal hops, anders adressen', () => {
  assert.equal(parseTrustProxy(undefined), 'loopback');
  assert.equal(parseTrustProxy('  '), 'loopback');
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('172.18.0.5'), '172.18.0.5');
  assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
  assert.equal(parseTrustProxy('loopback, 172.18.0.5'), 'loopback, 172.18.0.5');
});
