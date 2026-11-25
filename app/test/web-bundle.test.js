/**
 * Tests van de koppeling met de bundels van de frontend (`crm/web-bundle.js`) en het eerste scherm in Vue
 * (Beheer > Systeem > Bouwstenen, `beheer/bouwstenen-routes.js`): het manifest lezen, de koppen en het koppelpunt in
 * de bestaande schil, de CSP die gelijk blijft (geen inline script), de bestanden onder `/bundel/assets/` (het
 * manifest nooit), en de rechten op het scherm. Ook de FAQ (fase V2): met bundel het koppelpunt op de oude adressen,
 * zonder bundel de schermen van de server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toString } = require('../src/site/html');
const { createWebBundle, renderBundleHead, renderMountPoint, BUNDLE_BASE } = require('../src/crm/web-bundle');
const { createDatabase } = require('../src/database/db');
const { createApp, BASE_CSP } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'web_bundle_test';
const PASSWORD = 'een heel goed wachtwoord';

/** Een manifest zoals Vite het schrijft: twee modules die een gedeeld stuk met opmaak gebruiken. */
const MANIFEST = {
  'src/modules/beheer/main.ts': { file: 'assets/beheer-AAAA1111.js', isEntry: true, imports: ['_shared-BBBB.js'], css: ['assets/beheer-CCCC.css'] },
  'src/modules/faq/main.ts': { file: 'assets/faq-DDDD.js', isEntry: true, imports: ['_shared-BBBB.js', '_shared-BBBB.js'] },
  '_shared-BBBB.js': { file: 'assets/shared-BBBB.js', css: ['assets/shared-EEEE.css'], imports: ['_ontbreekt.js'] },
  'src/modules/kapot/main.ts': { file: '../../etc/passwd', isEntry: true },
  'src/modules/geen-ingang/main.ts': { file: 'assets/x.js' },
};

/**
 * Maakt een uitvoermap met manifest en bestanden.
 * @param {any} [manifest] Manifest (standaard `MANIFEST`); `null` = geen manifest.
 * @returns {string} De map.
 */
function makeDist(manifest = MANIFEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-dist-'));
  fs.mkdirSync(path.join(dir, '.vite'));
  fs.mkdirSync(path.join(dir, 'assets'));
  if (manifest) fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'assets', 'beheer-AAAA1111.js'), 'console.log("beheer");');
  return dir;
}

test('manifest: script, alle opmaak en voorladers per module', () => {
  const bundle = createWebBundle({ distDir: makeDist() });
  assert.deepEqual(bundle.assetsFor('beheer'), {
    script: '/bundel/assets/beheer-AAAA1111.js',
    styles: ['/bundel/assets/beheer-CCCC.css', '/bundel/assets/shared-EEEE.css'],
    preloads: ['/bundel/assets/shared-BBBB.js'],
  });
  assert.deepEqual(bundle.assetsFor('faq').preloads, ['/bundel/assets/shared-BBBB.js'], 'een gedeeld stuk één keer');
  assert.equal(BUNDLE_BASE, '/bundel/');
});

test('manifest: onbekende of ongeldige module, vreemde bestandsnaam of geen ingang geeft null', () => {
  const bundle = createWebBundle({ distDir: makeDist() });
  for (const name of ['bestaat-niet', '../beheer', 'Beheer', '', 'kapot', 'geen-ingang']) assert.equal(bundle.assetsFor(name), null, name);
});

test('manifest: ontbreekt, is kapot of verandert', () => {
  const dir = makeDist(null);
  const bundle = createWebBundle({ distDir: dir });
  assert.equal(bundle.assetsFor('beheer'), null, 'niet gebouwd');
  const manifestFile = path.join(dir, '.vite', 'manifest.json');
  fs.writeFileSync(manifestFile, '{kapot');
  assert.equal(bundle.assetsFor('beheer'), null, 'kapot manifest');
  fs.writeFileSync(manifestFile, JSON.stringify(MANIFEST));
  fs.utimesSync(manifestFile, new Date(), new Date(Date.now() + 5000));
  assert.equal(bundle.assetsFor('beheer').script, '/bundel/assets/beheer-AAAA1111.js', 'na een nieuwe bouw opnieuw gelezen');
  fs.rmSync(manifestFile);
  assert.equal(bundle.assetsFor('beheer'), null, 'weer weg');
  assert.equal(createWebBundle().assetsFor('-'), null, 'standaardmap, ongeldige naam');
});

test('koppen en koppelpunt: alleen bestanden met src, alles geëscapet, melding zonder bundel', () => {
  const head = toString(renderBundleHead({ script: '/bundel/assets/a.js', styles: ['/bundel/assets/a.css'], preloads: ['/bundel/assets/b.js'] }));
  assert.match(head, /<link rel="stylesheet" href="\/bundel\/assets\/a\.css">/);
  assert.match(head, /<link rel="modulepreload" href="\/bundel\/assets\/b\.js">/);
  assert.match(head, /<script type="module" src="\/bundel\/assets\/a\.js"><\/script>/);
  assert.equal(toString(renderBundleHead(null)), '');
  const mount = toString(renderMountPoint({ name: 'beheer"><x', base: '/app/beheer/', available: true }));
  assert.match(mount, /<div id="crm-app" data-module="beheer&quot;&gt;&lt;x" data-base="\/app\/beheer\/">/);
  assert.match(toString(renderMountPoint({ name: 'beheer', base: '/app/beheer/', available: false })), /niet beschikbaar/);
});

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

test('scherm Bouwstenen in de echte app: koppelpunt in de schil, CSP gelijk, bestanden en rechten', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const webDistDir = makeDist();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 45), webDistDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const emptyApp = createApp({ db, masterKey: Buffer.alloc(32, 45), webDistDir: makeDist(null) });
  const emptyServer = emptyApp.listen(0);
  const emptyBase = `http://127.0.0.1:${emptyServer.address().port}`;
  testContext.after(async () => { server.close(); emptyServer.close(); await db.close(); });
  const hash = await hashPassword(PASSWORD);
  for (const role of ['beheerder', 'redacteur']) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
  }
  const login = async (role) => {
    const response = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: `${role}@example.nl`, password: PASSWORD }).toString(), redirect: 'manual' });
    return response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  };
  const get = async (url, cookie) => {
    const response = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };
  const beheerder = await login('beheerder');

  const page = await get(`${base}/app/beheer/bouwstenen/`, beheerder);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), BASE_CSP, 'de CSP wordt niet verruimd');
  assert.match(page.text, /<title>Bouwstenen - Avanta CRM<\/title>/);
  assert.match(page.text, /<div id="crm-app" data-module="beheer" data-base="\/app\/beheer\/">/);
  assert.match(page.text, /<script type="module" src="\/bundel\/assets\/beheer-AAAA1111\.js"><\/script>/);
  assert.match(page.text, /<link rel="stylesheet" href="\/bundel\/assets\/beheer-CCCC\.css">/);
  assert.match(page.text, /<a [^>]*href="\/app\/beheer\/bouwstenen\/"[^>]*aria-current="page"/, 'gemarkeerd in de zijbalk van Beheer');
  const inlineScripts = page.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
  assert.deepEqual(inlineScripts, [], 'geen inline script');
  assert.doesNotMatch(page.text, /<style[\s>]/, 'geen inline opmaak');

  assert.equal((await get(`${base}/app/beheer/bouwstenen/`)).status, 303, 'zonder sessie naar inloggen');
  assert.equal((await get(`${base}/app/beheer/bouwstenen/`, await login('redacteur'))).status, 403, 'zonder recht systeem');

  const script = await get(`${base}/bundel/assets/beheer-AAAA1111.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('cache-control'), /max-age=31536000, immutable/);
  for (const hidden of ['/bundel/.vite/manifest.json', '/bundel/assets/../.vite/manifest.json', '/bundel/assets/%2e%2e/.vite/manifest.json', '/bundel/assets/bestaat-niet.js']) {
    const response = await get(`${base}${hidden}`);
    assert.equal(response.status, 404, hidden);
    assert.doesNotMatch(response.text, /isEntry/, `${hidden}: manifest niet uitgeleverd`);
  }

  const missing = await get(`${emptyBase}/app/beheer/bouwstenen/`, beheerder);
  assert.equal(missing.status, 200);
  assert.match(missing.text, /niet beschikbaar/);
  assert.doesNotMatch(missing.text, /id="crm-app"|type="module"/);

  // De FAQ (fase V2): met bundel het koppelpunt van de module `faq` op dezelfde adressen; zonder bundel een melding.
  const [category] = await db.query("INSERT INTO faq_categories (name, sort_order) VALUES ('Reizen & meer', 10) RETURNING id");
  const [question] = await db.query("INSERT INTO faqs (slug, question, answer_html, category, category_id) VALUES ('paspoort', 'Paspoort nodig?', '<p>Ja</p>', 'Reizen & meer', $1) RETURNING id", [category.id]);
  const redacteur = await login('redacteur');
  const faqPages = [['/app/faq/', 'Veelgestelde vragen'], ['/app/faq/nieuw/', 'Vraag toevoegen'], [`/app/faq/${question.id}/`, 'Vraag wijzigen'], [`/app/faq/categorieen/${category.id}/`, 'Categorie: Reizen &amp; meer']];
  for (const [url, title] of faqPages) {
    const faqPage = await get(`${base}${url}`, redacteur);
    assert.equal(faqPage.status, 200, url);
    assert.equal(faqPage.headers.get('content-security-policy'), BASE_CSP);
    assert.ok(faqPage.text.includes(`<title>${title} - Avanta CRM</title>`), url);
    assert.match(faqPage.text, /<div id="crm-app" data-module="faq" data-base="\/app\/faq\/">/);
    assert.match(faqPage.text, /<script type="module" src="\/bundel\/assets\/faq-DDDD\.js"><\/script>/);
    assert.doesNotMatch(faqPage.text, /Paspoort nodig\?/, 'de inhoud komt via de API');
    assert.deepEqual(faqPage.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [], [], 'geen inline script');
  }
  assert.equal((await get(`${base}/app/faq/999999/`, redacteur)).status, 404, 'onbekende vraag: 404 van de server');
  assert.equal((await get(`${base}/app/faq/categorieen/999999/`, redacteur)).status, 404);
  assert.equal((await get(`${base}/app/faq/`, beheerder)).status, 200);
  const withoutBundle = await get(`${emptyBase}/app/faq/`, redacteur);
  assert.match(withoutBundle.text, /niet beschikbaar/, 'zonder bundel een melding, geen oud scherm');
  assert.doesNotMatch(withoutBundle.text, /id="crm-app"|Paspoort nodig\?/);
});
