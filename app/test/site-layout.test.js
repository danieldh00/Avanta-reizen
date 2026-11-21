/**
 * Tests voor de basis van het ontwerp (CMS-pakket E1) zonder database: de eigen SVG-iconen, de kop met menu en
 * zoekvenster, de voettekst met social media en SGR, de paginakop en de veilige afbeeldingsadressen in style-attributen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ICONS, icon, typeIconName } = require('../src/site/icons');
const { renderPage, renderPageHeader, cssImageUrl, MENU } = require('../src/site/layout');
const { toString, html } = require('../src/site/html');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

test('iconen: elk icoon tekent een geldige SVG zonder lege waarden', () => {
  for (const name of Object.keys(ICONS)) {
    const markup = toString(icon(name));
    assert.match(markup, new RegExp(`^<svg class="icon icon--${name}" viewBox="0 0 24 24"`), name);
    assert.match(markup, /aria-hidden="true" focusable="false"/, name);
    assert.doesNotMatch(markup, /undefined|NaN|=""/, name);
    assert.match(markup, /<\/svg>$/, name);
  }
});

test('iconen: met label een toegankelijke naam, onbekend icoon leeg, extra klasse en ge-escapete label', () => {
  const labelled = toString(icon('facebook', { label: 'Facebook "pagina"', className: 'extra' }));
  assert.match(labelled, /class="icon icon--facebook extra"/);
  assert.match(labelled, /role="img" aria-label="Facebook &quot;pagina&quot;"/);
  assert.doesNotMatch(labelled, /aria-hidden/);
  assert.equal(toString(icon('bestaat-niet')), '');
});

test('iconen: reistypes van de huidige site hebben een eigen icoon, onbekende slug de wereldbol', () => {
  assert.equal(typeIconName('kampeerreizen'), 'kamperen');
  assert.equal(typeIconName('Hostel'), 'hostel');
  assert.equal(typeIconName('jeugdreizen'), 'jeugd');
  assert.equal(typeIconName('jongerenreizen'), 'jongeren');
  assert.equal(typeIconName('plusreizen'), 'plusreis');
  assert.equal(typeIconName('vliegreis'), 'vliegreis');
  assert.equal(typeIconName('avanta-vervoer'), 'avanta-vervoer');
  assert.equal(typeIconName('ov'), 'ov');
  assert.equal(typeIconName('wintersport'), 'wintersport');
  assert.equal(typeIconName('iets-anders'), 'verre-reizen');
  assert.equal(typeIconName(undefined), 'verre-reizen');
});

test('kop: logo, hoofdmenu met submenu-knop, zoekvenster naar /zoeken/ en doorzichtig alleen op de homepage', () => {
  const page = renderPage({ title: 'Test', path: '/blog/', body: html`<p>x</p>` });
  assert.match(page, /<header class="header-main">/);
  assert.match(page, /<img class="brand__dark" src="\/images\/logo.png" alt="Avanta reizen"/);
  assert.match(page, /<img class="brand__light" src="\/images\/logo-light.png"/);
  assert.match(page, /<button class="menutoggle" type="button" aria-expanded="false" aria-controls="hoofdmenu">/);
  for (const item of MENU) assert.ok(page.includes(`<a href="${item.href}">${item.label}`), item.label);
  assert.match(page, /<li class="menu-item is-active">\s*<a href="\/blog\/">Weblog/);
  assert.match(page, /<button class="foldout-toggle" type="button" aria-expanded="false" aria-controls="submenu-1">/);
  assert.match(page, /<ul class="sub-menu" id="submenu-1">/);
  assert.match(page, /<form id="zoekvenster" class="search-widget" role="search" action="\/zoeken\/" method="get">/);
  assert.match(page, /<input id="zoekterm" class="search-widget__input" type="search" name="s"/);
  assert.match(page, /<a class="search-toggle" href="\/zoeken\/"/);
  assert.match(renderPage({ path: '/', bodyClass: 'home', body: '' }), /<header class="header-main is-transparent">/);
  // De paginakop staat binnen <main>, zodat "Naar de inhoud" er ook naartoe springt.
  const withHeader = renderPage({ title: 'T', path: '/faq/', header: renderPageHeader({ title: 'Veelgestelde vragen' }), body: html`<p>x</p>` });
  assert.match(withHeader, /<main id="inhoud" class="site-main"><section class="page-header">/);
});

test('voettekst: wit logo, menu, contact, alleen ingevulde social media, SGR en cookieknop alleen met analytics', () => {
  const site = {
    siteName: 'Avanta reizen',
    contact: { phone: '0118 638427', email: 'info@avantareizen.nl' },
    social: { facebook: 'https://www.facebook.com/AvantaReizen', instagram: '', youtube: 'https://youtube.com/@a"b', linkedin: '' },
  };
  const page = renderPage({ title: 'Test', body: '', site });
  assert.match(page, /<footer class="footer-main">/);
  assert.match(page, /<a class="brand brand--footer" href="\/"><img src="\/images\/logo-light.png"/);
  assert.match(page, /<li><a href="\/avanta-reizen\/">Het Avantateam<\/a><\/li><li><a href="\/blog\/">Weblog<\/a><\/li><li><a href="\/contact\/">Contact<\/a><\/li>/);
  assert.match(page, /T: <a href="tel:0118638427">0118 638427<\/a>/);
  assert.match(page, /E: <a href="mailto:info@avantareizen.nl">info@avantareizen.nl<\/a>/);
  assert.match(page, /href="https:\/\/www.facebook.com\/AvantaReizen" rel="noopener" target="_blank"><svg class="icon icon--facebook" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Facebook">/);
  assert.match(page, /href="https:\/\/youtube.com\/@a&quot;b"/, 'adres ge-escaped');
  assert.doesNotMatch(page, /aria-label="Instagram"|aria-label="LinkedIn"/);
  assert.match(page, /<img class="footer-logo-srg" src="\/images\/sgr.png"/);
  assert.doesNotMatch(page, /data-consent-settings/);
  assert.match(renderPage({ title: 'Test', body: '', site: { ...site, analytics: { measurementId: 'G-ABC123' } } }), /data-consent-settings>Cookie-instellingen<\/button>/);
  // Zonder social media geen lege lijst.
  assert.doesNotMatch(renderPage({ title: 'Test', body: '' }), /social-items/);
});

test('paginakop: foto, pretitel en titel; reis met landen links en knop naar het overzicht', () => {
  const plain = toString(renderPageHeader({ title: 'Veelgestelde vragen', pretitle: 'Handig om te weten!', imageUrl: '/media/2021/12/faq.jpg' }));
  assert.match(plain, /<section class="page-header page-header--image">/);
  assert.match(plain, /<div class="page-header__image" style="background-image: url\('\/media\/2021\/12\/faq.jpg'\)"><\/div>/);
  assert.match(plain, /<p class="page-header__pretitle">Handig om te weten!<\/p>/);
  assert.match(plain, /<h1 class="page-header__title">Veelgestelde vragen<\/h1>/);
  assert.doesNotMatch(plain, /to-archive|page-header__title-block/);

  const trip = toString(renderPageHeader({ title: '± 20 dagen Namibië', destinations: ['Botswana', 'Namibië'], imageUrl: '/media/a.jpg', backLink: '/reis/' }));
  assert.match(trip, /class="page-header page-header--image page-header--trip"/);
  assert.match(trip, /<a class="to-archive" href="\/reis\/">.*<span class="to-archive__label">Naar overzicht<\/span><\/a>/s);
  assert.match(trip, /<p class="page-header__destination">Botswana, Namibië<\/p>/);

  const withoutImage = toString(renderPageHeader({ title: 'Zoeken' }));
  assert.match(withoutImage, /<section class="page-header">/);
  assert.doesNotMatch(withoutImage, /page-header__image/);
});

test('afbeeldingsadres in style-attribuut: alleen eigen pad of https, nooit iets dat de CSS openbreekt', () => {
  assert.equal(cssImageUrl('/media/2026/08/foto-1600x1120.jpeg'), '/media/2026/08/foto-1600x1120.jpeg');
  assert.equal(cssImageUrl('https://www.avantareizen.nl/app/uploads/x.jpg'), 'https://www.avantareizen.nl/app/uploads/x.jpg');
  assert.equal(cssImageUrl('/media/foto (1).jpg'), '/media/foto%20%281%29.jpg', 'haakjes en spatie gecodeerd');
  assert.equal(cssImageUrl("/media/x.jpg'); background: url(https://evil.example/"), '/media/x.jpg%27%29;%20background:%20url%28https://evil.example/', 'kan url() niet sluiten');
  assert.equal(cssImageUrl('/media/x".jpg'), '');
  assert.equal(cssImageUrl('/media/x\ty.jpg'), '');
  assert.equal(cssImageUrl('/media/x\ny.jpg'), '');
  assert.equal(cssImageUrl('/media/<x>.jpg'), '');
  assert.equal(cssImageUrl('/media/x\\.jpg'), '');
  assert.equal(cssImageUrl('//evil.example/x.jpg'), '', 'protocol-relatief');
  assert.equal(cssImageUrl('http://example.nl/x.jpg'), '', 'geen http');
  assert.equal(cssImageUrl('javascript:alert(1)'), '');
  assert.equal(cssImageUrl(''), '');
  assert.equal(cssImageUrl(null), '');
  const header = toString(renderPageHeader({ title: 'X', imageUrl: "/a.jpg'); color: red; --x: url('" }));
  assert.match(header, /style="background-image: url\('\/a\.jpg%27%29;%20color:%20red;%20--x:%20url%28%27'\)"/);
  assert.doesNotMatch(toString(renderPageHeader({ title: 'X', imageUrl: 'javascript:alert(1)' })), /style=/);
});

test('statische bestanden van het ontwerp bestaan en de stylesheet verwijst alleen naar bestaande bestanden', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'site.css'), 'utf8');
  const references = [...css.matchAll(/url\("\.\.\/([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(references.length >= 8, 'texturen, achtergrondfoto en lettertypes');
  for (const reference of references) assert.ok(fs.existsSync(path.join(PUBLIC_DIR, reference)), reference);
  for (const file of ['images/logo.png', 'images/logo-light.png', 'images/sgr.png', 'fonts/playfair-display-latin-900-normal.woff2']) {
    assert.ok(fs.existsSync(path.join(PUBLIC_DIR, file)), file);
  }
  // Breekpunten van de huidige site, geen oude tussenmaten.
  const breakpoints = new Set([...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((match) => Number(match[1])));
  for (const width of breakpoints) assert.ok([1024, 768, 800, 600].includes(width), `breekpunt ${width}`);
  assert.match(css, /--av-container: 1280px/);
  assert.match(css, /background: var\(--av-soft\)/);
  assert.match(css, /--av-soft: #f7f7f7/);
});
