/**
 * Tests voor de zoekmachine-optimalisatie: canonical per paginasoort, Open Graph, JSON-LD (valide en bestand tegen
 * `</script>`-injectie), de sitemap (geldige XML, ge-escapete URL's, ook vertrokken reizen), robots.txt in beide
 * standen (met absolute sitemap-URL) en de canonical op de 404- en aanmeldpagina. De databasetests draaien in een eigen schema, zodat ze naast `server.test.js` kunnen lopen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../src/site/seo');
const { renderPage } = require('../src/site/layout');
const { html } = require('../src/site/html');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { today } = require('../src/site/content');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'seo_test';
const SITE_URL = 'https://test.avantareizen.nl';

/**
 * Haalt alle JSON-LD-blokken uit een HTML-pagina en leest ze als JSON.
 * @param {string} page HTML.
 * @returns {object[]} De gestructureerde gegevens.
 */
function jsonLdBlocks(page) {
  return [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

/**
 * Leest de waarde van de canonical-link uit een pagina.
 * @param {string} page HTML.
 * @returns {(string|undefined)} De URL.
 */
function canonicalOf(page) {
  return page.match(/<link rel="canonical" href="([^"]*)">/)?.[1];
}

/**
 * Voegt een verbindingsoptie toe die het zoekpad op het testschema zet.
 * @param {string} url Verbindings-URL.
 * @returns {string} URL met `options=-c search_path=…`.
 */
function withSchema(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return parsed.toString();
}

test('basisadres uit SITE_URL wordt genormaliseerd', () => {
  assert.equal(seo.normalizeSiteUrl(undefined), 'https://www.avantareizen.nl');
  assert.equal(seo.normalizeSiteUrl('https://example.nl/'), 'https://example.nl');
  assert.equal(seo.normalizeSiteUrl('javascript:alert(1)'), 'https://www.avantareizen.nl');
  assert.equal(seo.normalizeSiteUrl('geen url'), 'https://www.avantareizen.nl');
  assert.equal(seo.absoluteUrl('https://example.nl', '/media/a.jpg'), 'https://example.nl/media/a.jpg');
  assert.equal(seo.absoluteUrl('https://example.nl', 'https://cdn.example.nl/a.jpg'), 'https://cdn.example.nl/a.jpg');
  assert.equal(seo.encodePagePath('/reizen/albanië/'), '/reizen/albani%C3%AB/');
});

test('JSON-LD is valide JSON en houdt een </script>-injectie via de titel tegen', () => {
  const evil = '</script><script>alert(1)</script> & <!--';
  const serialized = seo.serializeJsonLd({ name: evil, line: 'a\u2028b' });
  assert.doesNotMatch(serialized, /[<>&\u2028]/);
  assert.equal(JSON.parse(serialized).name, evil);

  const page = renderPage({
    title: evil,
    body: html`<p>x</p>`,
    seo: { canonicalUrl: `${SITE_URL}/reis/x/`, structuredData: [{ '@type': 'Trip', name: evil }] },
  });
  assert.equal((page.match(/<script/g) || []).length, 2, 'alleen het JSON-LD-blok en site.js');
  const [data] = jsonLdBlocks(page);
  assert.equal(data.name, evil);
  assert.match(page, /<meta property="og:title" content="&lt;\/script&gt;/);
});

test('Trip-gegevens: prijs, beschikbaarheid, geldigheid en vertrekdatum', () => {
  const base = { slug: 'reis', title: 'Reis', price_cents: 79900, departure_date: '2027-07-01', fully_booked: false };
  const open = seo.tripData(SITE_URL, base, { today: '2027-01-01' });
  assert.equal(open['@type'], 'Trip');
  assert.equal(open.departureTime, '2027-07-01');
  assert.deepEqual(
    { price: open.offers.price, currency: open.offers.priceCurrency, availability: open.offers.availability, validFrom: open.offers.validFrom },
    { price: '799.00', currency: 'EUR', availability: 'https://schema.org/InStock', validFrom: '2027-01-01' },
  );
  assert.equal(seo.tripData(SITE_URL, { ...base, fully_booked: true }, { today: '2027-01-01' }).offers.availability, 'https://schema.org/SoldOut');
  assert.equal(seo.tripData(SITE_URL, base, { today: '2027-08-01' }).offers.availability, 'https://schema.org/SoldOut', 'vertrokken');
  assert.equal(seo.tripData(SITE_URL, { ...base, price_cents: null }, { today: '2027-01-01' }).offers, undefined);
});

test('sitemap is geldige XML met ge-escapete URL\'s en zonder dubbele adressen', () => {
  const urls = seo.sitemapUrls({
    trips: [{ slug: 'a&b' }],
    categories: [{ slug: 'kamperen' }],
    guides: [{ slug: 'harmen' }],
    posts: [{ slug: 'verhaal', published_at: new Date('2026-03-01T10:00:00Z') }],
    pages: [{ path: '/contact/' }, { path: '/faq/' }, { path: "/x'<y>/" }],
  });
  const xml = seo.renderSitemap(SITE_URL, urls);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.equal((xml.match(/<loc>https:\/\/test\.avantareizen\.nl\/faq\/<\/loc>/g) || []).length, 1, 'geen dubbele /faq/');
  assert.match(xml, /<loc>https:\/\/test\.avantareizen\.nl\/reis\/a%26b\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/test\.avantareizen\.nl\/verhaal\/<\/loc><lastmod>2026-03-01T10:00:00.000Z<\/lastmod>/);
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  for (const loc of locs) assert.doesNotThrow(() => new URL(loc.replace(/&amp;/g, '&')), loc);
  assert.doesNotMatch(xml.replace(/<\/?[a-z?][^>]*>/g, ''), /[<>]|&(?!amp;|lt;|gt;|quot;|apos;)/, 'tekstinhoud volledig ge-escaped');
  assert.equal(seo.escapeXml('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&apos;');
});

test('SEO-tags, sitemap en robots.txt via de app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  const [guide] = await db.query("INSERT INTO guides (slug, name, intro) VALUES ('harmen', 'Harmen', 'Ervaren') RETURNING id");
  const [category] = await db.query("INSERT INTO trip_categories (slug, name, kind, image_url) VALUES ('albanie', 'Albanië', 'bestemming', '/media/albanie.jpg') RETURNING id");
  const future = new Date(`${today()}T12:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 30);
  const [trip] = await db.query(
    `INSERT INTO trips (slug, title, tagline, departure_date, price_cents, hero_image_url)
     VALUES ('8-dagen-albanie', $1, 'Ruig', $2, 79900, '/media/hero.jpg') RETURNING id`,
    ['8 dagen </script><script>alert(1)</script>', future.toISOString().slice(0, 10)],
  );
  await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, guide.id]);
  await db.query("INSERT INTO trips (slug, title, departure_date, price_cents) VALUES ('oude-reis', 'Oude reis', '2019-07-30', 50000)");
  await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('verborgen', 'Verborgen', '2030-01-01', false)");
  await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2)', [trip.id, category.id]);
  await db.query("INSERT INTO posts (slug, title, excerpt, image_url, published_at) VALUES ('op-avantuur', 'Op Avantuur', 'Kort', '/media/blog.jpg', '2026-05-04T08:00:00Z')");
  await db.query("INSERT INTO pages (path, title, intro) VALUES ('/contact/', 'Contact', 'Bel ons'), ('/avanta-reizen/voorpret/', 'Voorpret', '')");

  const previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = `${SITE_URL}/`;
  const apps = [createApp({ db, masterKey: Buffer.alloc(32, 4) }), createApp({ db, masterKey: Buffer.alloc(32, 4), indexable: true })];
  const servers = apps.map((app) => app.listen(0));
  const [base, indexableBase] = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
  t.after(async () => {
    for (const server of servers) server.close();
    await db.close();
    if (previousSiteUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSiteUrl;
  });

  /**
   * Haalt een adres op.
   * @param {string} path Pad.
   * @param {string} [origin] Basis van de testserver.
   * @returns {Promise<{status: number, text: string, type: string}>} Antwoord.
   */
  const get = async (path, origin = base) => {
    const response = await fetch(origin + path, { redirect: 'manual' });
    return { status: response.status, text: await response.text(), type: response.headers.get('content-type') || '' };
  };

  await t.test('canonical per paginasoort gebruikt het echte pad', async () => {
    const expected = [
      ['/', '/'], ['/reis/', '/reis/'], ['/reis/?bestemming=albanie', '/reis/'], ['/reis/8-dagen-albanie/', '/reis/8-dagen-albanie/'],
      ['/reis/oude-reis/', '/reis/oude-reis/'], ['/reis-categorie/albanie/', '/reis-categorie/albanie/'], ['/reisleider/', '/reisleider/'],
      ['/reisleider/harmen/', '/reisleider/harmen/'], ['/blog/', '/blog/'], ['/op-avantuur/', '/op-avantuur/'], ['/faq/', '/faq/'],
      ['/contact/', '/contact/'], ['/avanta-reizen/voorpret/', '/avanta-reizen/voorpret/'],
    ];
    for (const [path, canonicalPath] of expected) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.equal(canonicalOf(response.text), SITE_URL + canonicalPath, path);
      assert.match(response.text, /<meta property="og:locale" content="nl_NL">/, path);
      assert.match(response.text, new RegExp(`<meta property="og:url" content="${SITE_URL.replace(/\./g, '\\.')}`), path);
      assert.match(response.text, /<meta property="og:image" content="https:\/\//, path);
      assert.match(response.text, /<meta name="twitter:card" content="summary_large_image">/, path);
    }
  });

  await t.test('homepage: TravelAgency met contactgegevens', async () => {
    const page = (await get('/')).text;
    const agency = jsonLdBlocks(page).find((data) => data['@type'] === 'TravelAgency');
    assert.equal(agency.telephone, '0118 638427');
    assert.equal(agency.email, 'info@avantareizen.nl');
    assert.equal(agency.url, `${SITE_URL}/`);
    assert.equal(agency.logo, `${SITE_URL}/images/logo.png`);
    assert.match(page, /<meta property="og:type" content="website">/);
  });

  await t.test('reispagina: Trip en BreadcrumbList; titel kan het script-blok niet sluiten', async () => {
    const page = (await get('/reis/8-dagen-albanie/')).text;
    assert.doesNotMatch(page, /<script>alert/);
    const blocks = jsonLdBlocks(page);
    const tripBlock = blocks.find((data) => data['@type'] === 'Trip');
    assert.equal(tripBlock.name, '8 dagen </script><script>alert(1)</script>');
    assert.equal(tripBlock.offers.price, '799.00');
    assert.equal(tripBlock.offers.availability, 'https://schema.org/InStock');
    assert.equal(tripBlock.offers.validFrom, today());
    assert.match(tripBlock.departureTime, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(tripBlock.image, `${SITE_URL}/media/hero.jpg`);
    const crumbs = blocks.find((data) => data['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((item) => item.item), [`${SITE_URL}/`, `${SITE_URL}/reis/`, `${SITE_URL}/reis/8-dagen-albanie/`]);
    const old = jsonLdBlocks((await get('/reis/oude-reis/')).text).find((data) => data['@type'] === 'Trip');
    assert.equal(old.offers.availability, 'https://schema.org/SoldOut');
  });

  await t.test('categorie en blog: BreadcrumbList, BlogPosting en og:type article', async () => {
    const categoryPage = (await get('/reis-categorie/albanie/')).text;
    assert.ok(jsonLdBlocks(categoryPage).some((data) => data['@type'] === 'BreadcrumbList'));
    assert.match(categoryPage, new RegExp(`og:image" content="${SITE_URL.replace(/\./g, '\\.')}/media/albanie\\.jpg"`));
    const postPage = (await get('/op-avantuur/')).text;
    const posting = jsonLdBlocks(postPage).find((data) => data['@type'] === 'BlogPosting');
    assert.equal(posting.headline, 'Op Avantuur');
    assert.equal(posting.datePublished, '2026-05-04T08:00:00.000Z');
    assert.ok(jsonLdBlocks(postPage).some((data) => data['@type'] === 'BreadcrumbList'));
    assert.match(postPage, /<meta property="og:type" content="article">/);
  });

  await t.test('sitemap: alle openbare adressen, ook vertrokken reizen', async () => {
    const response = await get('/sitemap.xml');
    assert.equal(response.status, 200);
    assert.match(response.type, /application\/xml/);
    for (const path of ['/', '/reis/', '/reis/8-dagen-albanie/', '/reis/oude-reis/', '/reis-categorie/albanie/', '/reisleider/harmen/', '/op-avantuur/', '/contact/', '/avanta-reizen/voorpret/', '/faq/', '/blog/']) {
      assert.ok(response.text.includes(`<loc>${SITE_URL}${path}</loc>`), path);
    }
    assert.doesNotMatch(response.text, /verborgen/);
    assert.match(response.text, /<loc>[^<]*\/op-avantuur\/<\/loc><lastmod>2026-05-04T08:00:00\.000Z<\/lastmod>/);
  });

  await t.test('404 en aanmeldpagina: canonical, maar wel noindex', async () => {
    for (const origin of [base, indexableBase]) {
      const missing = await get('/bestaat-niet/', origin);
      assert.equal(missing.status, 404);
      assert.equal(canonicalOf(missing.text), `${SITE_URL}/bestaat-niet/`);
      assert.match(missing.text, /<meta name="robots" content="noindex, nofollow">/);
      const booking = await get('/aanmelden/?reis=8-dagen-albanie', origin);
      assert.equal(booking.status, 200);
      assert.equal(canonicalOf(booking.text), `${SITE_URL}/aanmelden/?reis=8-dagen-albanie`);
      assert.match(booking.text, /<meta name="robots" content="noindex, nofollow">/);
      const unknownTrip = await get('/aanmelden/?reis=bestaat-niet', origin);
      assert.equal(unknownTrip.status, 404);
      assert.equal(canonicalOf(unknownTrip.text), `${SITE_URL}/aanmelden/`);
    }
    const contact = await get('/contact/');
    assert.equal(canonicalOf(contact.text), `${SITE_URL}/contact/`);
    assert.match(contact.text, /action="\/contact\/"/);
  });

  await t.test('robots.txt: alleen bij indexeren een verwijzing naar de sitemap', async () => {
    const closed = await get('/robots.txt');
    assert.match(closed.text, /Disallow: \//);
    assert.doesNotMatch(closed.text, /Sitemap:/);
    const open = await get('/robots.txt', indexableBase);
    assert.match(open.text, /Allow: \//);
    assert.match(open.text, new RegExp(`^Sitemap: ${SITE_URL.replace(/\./g, '\\.')}/sitemap\\.xml$`, 'm'), 'absolute sitemap-URL');
    assert.equal((await get('/sitemap.xml', base)).status, 200, 'sitemap bestaat ook bij noindex');
    assert.match((await get('/reis/', indexableBase)).text, /<meta name="robots" content="index, follow">/);
  });
});
