/**
 * Tests voor Beheer pakket A2 (vindbaarheid): de site-instellingen uit Beheer (indexeren met wachtwoord, basisadres,
 * titels, omschrijving, afbeelding, organisatie, verificatie, robots.txt, sitemap-uitsluitingen en llms.txt), eerst
 * zonder database en daarna via de echte routes tegen PostgreSQL (eigen schema).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const seo = require('../src/site/seo');
const { createContent } = require('../src/site/content');
const { siteSettingsOf, isExcluded, linesOf } = require('../src/site/site-settings');
const { SETTING_FIELDS, validateValue, SettingsError } = require('../src/beheer/settings');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'beheer_seo_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

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

/**
 * Een nagebootste instellingenlaag met de standaardwaarden en eigen afwijkingen.
 * @param {object} overrides Waarden per instelling.
 * @returns {{get: Function}} Instellingen.
 */
function fakeSettings(overrides = {}) {
  return { get: (key) => (Object.hasOwn(overrides, key) ? overrides[key] : SETTING_FIELDS[key].default) };
}

test('vindbaarheid: controle van de nieuwe instellingen', () => {
  const check = (key, value) => validateValue(key, SETTING_FIELDS[key], value);
  assert.equal(check('robotsExtra', 'User-agent: GPTBot\nDisallow: /\n# opmerking\n'), 'User-agent: GPTBot\nDisallow: /\n# opmerking');
  assert.throws(() => check('robotsExtra', 'Sitemap: https://evil.example/x.xml'), /kan niet/);
  assert.throws(() => check('robotsExtra', 'zomaar tekst'), /kan niet/);
  assert.equal(check('sitemapExclude', '/faq/\n/blog/*'), '/faq/\n/blog/*');
  assert.throws(() => check('sitemapExclude', 'https://example.nl/'), /geen pad/);
  assert.throws(() => check('sitemapExclude', '/a/*/b/'), /geen pad/);
  assert.equal(check('socialImage', '/media/foto.jpg'), '/media/foto.jpg');
  assert.equal(check('socialImage', 'https://cdn.example.nl/x.jpg'), 'https://cdn.example.nl/x.jpg');
  assert.throws(() => check('socialImage', '//evil.example/x.jpg'), SettingsError);
  assert.throws(() => check('socialImage', 'javascript:alert(1)'), SettingsError);
  assert.throws(() => check('siteUrl', 'https://www.example.nl/?x=1'), /zonder \? of #/);
  assert.equal(check('siteUrl', 'https://www.example.nl/'), 'https://www.example.nl');
  assert.throws(() => check('googleVerification', 'abc" onload="x'), /letters, cijfers/);
  assert.equal(check('googleVerification', 'Abc_123-xyz'), 'Abc_123-xyz');
  assert.equal(check('orgPostalCode', '4331ab'), '4331ab');
  assert.throws(() => check('orgPostalCode', '0123 AB'), /postcode/);
  assert.throws(() => check('defaultDescription', 'regel een\nregel twee'), /één regel/);
  assert.equal(SETTING_FIELDS.seoIndexing.default, false, 'indexeren staat standaard uit');
  assert.equal(SETTING_FIELDS.seoIndexing.env, 'SITE_INDEXABLE');
});

test('vindbaarheid: site-instellingen, robots.txt, llms.txt en JSON-LD', () => {
  const site = siteSettingsOf(fakeSettings({
    siteUrl: 'https://test.example.nl/', orgPostalCode: '4331ab', orgStreet: 'Dorpsstraat 1', orgCity: 'Middelburg',
    socialFacebook: 'https://facebook.com/avanta', socialYoutube: 'https://youtube.com/@avanta', robotsExtra: 'User-agent: GPTBot\n\nDisallow: /',
    sitemapExclude: '/faq/\n/blog/*', seoIndexing: true,
  }));
  assert.equal(site.siteUrl, 'https://test.example.nl');
  assert.equal(site.imageUrl, 'https://test.example.nl/images/logo.png');
  assert.equal(site.organisation.postalCode, '4331 AB');
  assert.deepEqual(site.organisation.sameAs, ['https://facebook.com/avanta', 'https://youtube.com/@avanta']);
  assert.deepEqual(site.robotsExtra, ['User-agent: GPTBot', 'Disallow: /']);
  assert.deepEqual(linesOf(' a \n\n b '), ['a', 'b']);
  assert.equal(isExcluded('/faq/', site.sitemapExclude), true);
  assert.equal(isExcluded('/faq/x/', site.sitemapExclude), false);
  assert.equal(isExcluded('/blog/', site.sitemapExclude), true);
  assert.equal(isExcluded('/blog/bericht/', site.sitemapExclude), true);
  assert.equal(isExcluded('/reis/', site.sitemapExclude), false);
  assert.equal(isExcluded('/r%C3%A9is/', ['/réis/']), true, 'gecodeerde paden tellen ook');
  assert.equal(isExcluded('/%E0%A4%A/', ['/x/']), false, 'een kapot pad breekt niets');

  assert.equal(seo.robotsTxt({ ...site, indexable: false }), 'User-agent: *\nDisallow: /\n');
  assert.equal(seo.robotsTxt(site), 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://test.example.nl/sitemap.xml\n');
  assert.equal(
    seo.robotsTxt({ ...site, robotsExtra: ['Disallow: /intern/', 'User-agent: GPTBot', 'User-agent: CCBot', 'Disallow: /'] }),
    'User-agent: *\nAllow: /\nDisallow: /intern/\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nSitemap: https://test.example.nl/sitemap.xml\n',
    'een losse Disallow hoort bij de groep User-agent: *',
  );

  const llms = seo.llmsTxt({ ...site, siteName: '[Evil](https://x)', llms: { enabled: true, intro: '# kop' } }, { categories: [{ name: 'Albanië', slug: 'albanie' }] });
  assert.match(llms, /^# Evilhttps:\/\/x\n/);
  assert.match(llms, /\n> Christelijke/);
  assert.match(llms, /\nkop\n/);
  assert.match(llms, /- \[Reisaanbod\]\(https:\/\/test\.example\.nl\/reis\/\)/);
  assert.match(llms, /- \[Albanië\]\(https:\/\/test\.example\.nl\/reis-categorie\/albanie\/\)/);

  const agency = seo.travelAgencyData(site.siteUrl, site.contact, { ...site.organisation, name: 'Avanta', imageUrl: site.imageUrl });
  assert.deepEqual(agency.address, { '@type': 'PostalAddress', streetAddress: 'Dorpsstraat 1', postalCode: '4331 AB', addressLocality: 'Middelburg', addressCountry: 'NL' });
  assert.deepEqual(agency.sameAs, site.organisation.sameAs);
  assert.equal(seo.travelAgencyData(site.siteUrl, site.contact, { street: 'Alleen straat' }).address, undefined, 'geen half adres');
  assert.equal(seo.travelAgencyData(site.siteUrl, site.contact).name, 'Avanta reizen');
});

test('vindbaarheid: Beheer-routes en effect op de site', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  // Begin zonder de lijst met alle landen uit migratie 33: deze test maakt zijn eigen landen.
  await db.query('DELETE FROM trip_categories WHERE iso_code IS NOT NULL');
  await db.query("INSERT INTO pages (path, title) VALUES ('/faq-extra/', 'Extra')");
  await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('albanie', 'Albanië', 'bestemming')");

  let clock = Date.now();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 5), setupCode: SETUP_CODE, siteUrl: 'https://start.example.nl', now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = ((await request('/app/', { cookie })).text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const searchEngines = { _csrf: csrf, siteUrl: 'https://start.example.nl', googleVerification: '', bingVerification: '' };

  await t.test('standaard: niet indexeren, basisadres uit de startwaarde', async () => {
    assert.equal((await request('/robots.txt')).text, 'User-agent: *\nDisallow: /\n');
    const trips = await request('/reis/');
    assert.equal(trips.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(trips.text, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(trips.text, /<link rel="canonical" href="https:\/\/start\.example\.nl\/reis\/">/);
    assert.equal((await request('/llms.txt')).status, 404);
    const page = await request('/app/beheer/zoekmachines/', { cookie });
    assert.match(page.text, /Uit de omgeving \(startwaarde\)/);
    assert.match(page.text, /name="_password"/, 'wachtwoordveld zolang indexeren uit staat');
  });

  await t.test('indexeren aanzetten vraagt het wachtwoord', async () => {
    const sneaky = await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, seoIndexing: 'ja', _reset: 'seoIndexing' } });
    assert.equal(sneaky.status, 303, 'terugzetten zonder databaserij verandert niets');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM settings WHERE key = 'seoIndexing'"))[0].count, 0);
    assert.equal((await request('/robots.txt')).text, 'User-agent: *\nDisallow: /\n', 'aan zetten via terugzetten kan niet');
    const without = await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, seoIndexing: 'ja' } });
    assert.equal(without.status, 422);
    assert.match(without.text, /Bevestig het aanzetten met je wachtwoord/);
    const wrong = await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, seoIndexing: 'ja', _password: 'fout wachtwoord!!' } });
    assert.equal(wrong.status, 422);
    assert.match(wrong.text, /Je wachtwoord klopt niet/);
    assert.equal((await request('/robots.txt')).text, 'User-agent: *\nDisallow: /\n', 'nog steeds dicht');

    const saved = await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, siteUrl: 'https://www.nieuw.example.nl/', googleVerification: 'GoogleCode_123', bingVerification: 'BINGCODE1234', seoIndexing: 'ja', _password: ADMIN_PASSWORD } });
    assert.equal(saved.status, 303);
    const audit = await db.query("SELECT entity_id FROM audit_log WHERE action = 'instelling.gewijzigd' ORDER BY entity_id");
    assert.deepEqual(audit.map((row) => row.entity_id), ['bingVerification', 'googleVerification', 'seoIndexing', 'siteUrl']);
    assert.doesNotMatch((await request('/app/beheer/zoekmachines/', { cookie })).text, /name="_password"/, 'geen wachtwoordveld meer als het al aan staat');
  });

  await t.test('met indexeren: robots.txt, koppen, canonical, verificatie, sitemap en llms.txt', async () => {
    const robots = await request('/robots.txt');
    assert.equal(robots.text, 'User-agent: *\nAllow: /\n\nSitemap: https://www.nieuw.example.nl/sitemap.xml\n');
    const trips = await request('/reis/');
    assert.equal(trips.headers.get('x-robots-tag'), null);
    assert.match(trips.text, /<meta name="robots" content="index, follow">/);
    assert.match(trips.text, /<link rel="canonical" href="https:\/\/www\.nieuw\.example\.nl\/reis\/">/);
    assert.match(trips.text, /<meta name="google-site-verification" content="GoogleCode_123">/);
    assert.match(trips.text, /<meta name="msvalidate.01" content="BINGCODE1234">/);
    assert.equal((await request('/app/inloggen/')).headers.get('x-robots-tag'), 'noindex, nofollow', 'het CRM nooit');
    assert.equal((await request('/APP/inloggen/')).headers.get('x-robots-tag'), 'noindex, nofollow', 'ook niet in hoofdletters');
    const missing = await request('/bestaat-niet/');
    assert.match(missing.text, /<meta name="robots" content="noindex, nofollow">/, 'een 404 nooit');
    assert.equal(missing.headers.get('x-robots-tag'), 'noindex, nofollow', 'ook de kop van een 404');
    const sitemap = await request('/sitemap.xml');
    assert.match(sitemap.text, /<loc>https:\/\/www\.nieuw\.example\.nl\/faq\/<\/loc>/);
    assert.match(sitemap.text, /<loc>https:\/\/www\.nieuw\.example\.nl\/faq-extra\/<\/loc>/);
    assert.doesNotMatch(sitemap.text, /reis-categorie\/albanie\//, 'een land zonder reizen en zonder eigen inhoud niet');
    // Alleen een concept-reis of een vertrokken reis: de landpagina is leeg, dus niet; een komende gepubliceerde reis wel.
    // De sitemap komt een tijd uit het geheugen, dus dit via de query zelf.
    const sitemapSlugs = async () => (await createContent(db).sitemapEntries()).categories.map((row) => row.slug);
    const [draft] = await db.query(
      "INSERT INTO trips (slug, title, published, departure_date) VALUES ('concept-albanie', 'Concept', false, current_date + 30) RETURNING id",
    );
    try {
      await db.query("INSERT INTO trip_category_links (trip_id, category_id) SELECT $1, id FROM trip_categories WHERE slug = 'albanie'", [draft.id]);
      assert.ok(!(await sitemapSlugs()).includes('albanie'), 'een land met alleen een concept-reis niet');
      await db.query('UPDATE trips SET published = true, departure_date = current_date - 30 WHERE id = $1', [draft.id]);
      assert.ok(!(await sitemapSlugs()).includes('albanie'), 'een land met alleen een vertrokken reis niet');
      await db.query('UPDATE trips SET departure_date = current_date + 30 WHERE id = $1', [draft.id]);
      assert.ok((await sitemapSlugs()).includes('albanie'), 'een land met een komende gepubliceerde reis wel');
    } finally {
      await db.query('DELETE FROM trips WHERE id = $1', [draft.id]);
    }
    const llms = await request('/llms.txt');
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get('content-type'), /text\/plain/);
    assert.match(llms.text, /^# Avanta reizen\n/);
    assert.doesNotMatch(llms.text, /reis-categorie\/albanie\//, 'een land zonder komende reizen niet');
    await db.query("UPDATE trip_categories SET show_on_home = true WHERE slug = 'albanie'");
    assert.match((await request('/llms.txt')).text, /reis-categorie\/albanie\//, 'wel als het op de homepage staat');
  });

  await t.test('robots, sitemap en llms.txt instellen', async () => {
    const invalid = await request('/app/beheer/robots/', { cookie, form: { _csrf: csrf, robotsExtra: 'Sitemap: https://evil.example/', sitemapExclude: '', llmsEnabled: 'ja', llmsIntro: '' } });
    assert.equal(invalid.status, 422);
    const saved = await request('/app/beheer/robots/', { cookie, form: { _csrf: csrf, robotsExtra: 'User-agent: GPTBot\nDisallow: /', sitemapExclude: '/faq/\n/faq-extra/*', llmsIntro: 'Wij zijn Avanta.' } });
    assert.equal(saved.status, 303);
    assert.match((await request('/robots.txt')).text, /\nUser-agent: GPTBot\nDisallow: \/\n/);
    const sitemap = await request('/sitemap.xml');
    assert.doesNotMatch(sitemap.text, /\/faq\/<\/loc>/, 'uitgesloten');
    assert.doesNotMatch(sitemap.text, /faq-extra/, 'uitgesloten met *');
    assert.match(sitemap.text, /\/reis\/<\/loc>/);
    assert.equal((await request('/llms.txt')).status, 404, 'llms.txt staat nu uit (selectievakje niet aangevinkt)');
  });

  await t.test('titels, omschrijving, afbeelding en organisatie', async () => {
    const saved = await request('/app/beheer/teksten/', { cookie, form: { _csrf: csrf, siteName: 'Avanta Test', homeTitle: 'Groepsreizen | Avanta Test', defaultDescription: 'Een eigen omschrijving.', socialImage: '/media/deel.jpg' } });
    assert.equal(saved.status, 303);
    const trips = await request('/reis/');
    assert.match(trips.text, /<title>[^<]* - Avanta Test<\/title>/);
    assert.match(trips.text, /<meta property="og:site_name" content="Avanta Test">/);
    assert.match(trips.text, /<meta property="og:image" content="https:\/\/www\.nieuw\.example\.nl\/media\/deel\.jpg">/);
    assert.match(trips.text, /© \d{4} Avanta Test/);
    const contact = await request('/app/beheer/contact/', { cookie, form: { _csrf: csrf, contactPhone: '0118 638427', contactEmail: 'info@avantareizen.nl', orgStreet: 'Dorpsstraat 1', orgPostalCode: '4331ab', orgCity: 'Middelburg', socialInstagram: 'https://instagram.com/avanta' } });
    assert.equal(contact.status, 303);
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.text, /<title>Groepsreizen \| Avanta Test<\/title>/);
    assert.match(home.text, /<meta name="description" content="Een eigen omschrijving\.">/);
    const agency = JSON.parse(home.text.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"TravelAgency".*?)<\/script>/)[1]);
    assert.equal(agency.name, 'Avanta Test');
    assert.equal(agency.address.postalCode, '4331 AB');
    assert.deepEqual(agency.sameAs, ['https://instagram.com/avanta']);
    assert.equal(agency.url, 'https://www.nieuw.example.nl/');
  });

  await t.test('indexeren uitzetten kan zonder wachtwoord; te veel foute wachtwoorden geeft 429', async () => {
    const off = await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, siteUrl: 'https://www.nieuw.example.nl' } });
    assert.equal(off.status, 303);
    assert.equal((await request('/robots.txt')).text, 'User-agent: *\nDisallow: /\n');
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, seoIndexing: 'ja', _password: 'fout wachtwoord!!' } })).status);
    assert.deepEqual(statuses.slice(-2), [422, 429]);
    clock += 16 * 60 * 1000;
    assert.equal((await request('/app/beheer/zoekmachines/', { cookie, form: { ...searchEngines, seoIndexing: 'ja', _password: 'fout wachtwoord!!' } })).status, 422, 'na het kwartier weer');
  });

  await t.test('terugzetten naar een startwaarde die aan staat, vraagt ook het wachtwoord', async () => {
    const indexableApp = createApp({ db, masterKey: Buffer.alloc(32, 5), setupCode: SETUP_CODE, indexable: true, siteUrl: 'https://start.example.nl', now: () => clock });
    const indexableServer = indexableApp.listen(0);
    t.after(() => indexableServer.close());
    const indexableBase = `http://127.0.0.1:${indexableServer.address().port}`;
    /**
     * Zet indexeren terug naar de startwaarde (aan) via de tweede app.
     * @param {object} extra Extra formuliervelden.
     * @returns {Promise<number>} Statuscode.
     */
    const reset = async (extra) => {
      const response = await fetch(`${indexableBase}/app/beheer/zoekmachines/`, {
        method: 'POST',
        headers: { cookie: `${COOKIE_NAME}=${cookie}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...searchEngines, siteUrl: 'https://www.nieuw.example.nl', _reset: 'seoIndexing', ...extra }).toString(),
        redirect: 'manual',
      });
      await response.text();
      return response.status;
    };
    assert.equal(await reset({}), 422, 'zonder wachtwoord');
    assert.equal((await fetch(`${indexableBase}/robots.txt`).then((response) => response.text())), 'User-agent: *\nDisallow: /\n', 'nog steeds dicht');
    assert.equal(await reset({ _password: ADMIN_PASSWORD }), 303, 'met wachtwoord');
    assert.match(await fetch(`${indexableBase}/robots.txt`).then((response) => response.text()), /^User-agent: \*\nAllow: \/\n/);
  });
});
