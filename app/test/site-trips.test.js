/**
 * Tests voor de reispagina's en reisleiders (CMS-pakket E3) zonder database: prijzen zoals de huidige site, de reisbox
 * in een lijst, het reisdetail, de galerij, de reisleiders, de vaste inhoud in `site-content.json` (controle, volgorde,
 * import) en de YouTube-video op de homepage (id-controle, iframe, CSP).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const views = require('../src/site/trip-view');
const { normalizeSiteContent, createSiteContentStore, sortGuides, DEFAULT_ARCHIVES, EMPTY_GUIDE, SITE_CONTENT_FILE } = require('../src/site/site-content');
const { normalizeHomepage, cleanVideoId } = require('../src/site/homepage');
const { renderHome, renderFilterBar } = require('../src/site/home-view');
const { addCspSources } = require('../src/security/csp');
const parsers = require('../tools/import/parse');
const { siteContentData } = require('../tools/import-wordpress');
const { renderPageHeader } = require('../src/site/layout');
const { toString } = require('../src/site/html');

/**
 * Een reis zoals de database hem geeft.
 * @param {object} [extra] Afwijkingen.
 * @returns {object} Reis.
 */
function trip(extra = {}) {
  return {
    slug: 'namibie', title: '± 20 dagen Namibië', summary: 'Safari', trip_code: '26-NAM-293', departure_date: '2026-12-03',
    price_cents: 184900, old_price_cents: null, offer_until: null, extra_costs_cents: 60000, is_new: false, fully_booked: false,
    card_image_url: '/media/kaart.jpg', legacy_id: 293, tagline: 'Een onvergetelijk safari-avontuur', body_html: '<p>Tekst</p>',
    duration_label: '20 dagen', guaranteed: true, status_label: '', guides: [{ slug: 'martijn', name: 'Martijn', photo_url: '/media/m.jpg' }],
    gallery: [{ url: '/media/g1.jpg', alt: 'Olifant' }], gallery_title: 'Afrikaans Avantuur', gallery_subtitle: 'wild & wonderful',
    categories: [
      { slug: 'kamperen', name: 'Kampeerreizen', kind: 'type' }, { slug: 'vliegreis', name: 'Vliegreis', kind: 'type' },
      { slug: 'botswana', name: 'Botswana', kind: 'bestemming' }, { slug: 'namibie', name: 'Namibië', kind: 'bestemming' },
    ],
    ...extra,
  };
}

test('prijs zoals de huidige site: geen punt voor duizendtallen, ",-" bij hele euro\'s', () => {
  assert.equal(views.themePrice(184900), '€1849,-');
  assert.equal(views.themePrice(79950), '€799,50');
  assert.equal(views.themePrice(5), '€0,05');
  assert.equal(views.themePrice(null), '€0,-');
});

test('reis in een lijst: liggende box met foto, code, samenvatting en prijsvak; labels en aanbieding', () => {
  const item = toString(views.tripListItem(trip()));
  assert.match(item, /<a class="post-teaser post-teaser--landscape" href="\/reis\/namibie\/">/);
  assert.match(item, /<div class="box box--landscape box--additional">/);
  assert.match(item, /<figure class="box__image" style="background-image: url\('\/media\/kaart.jpg'\)">/);
  assert.match(item, /<span class="box__pretitle">03-12-2026 <span class="trip__code">26-NAM-293<\/span><\/span>/);
  assert.match(item, /<div class="box__content">Safari<\/div>/);
  assert.match(item, /<span class="trip__price">€1849,-<\/span>/);
  assert.match(item, /Bijkomende kosten <span>€600,-<\/span>/);
  assert.doesNotMatch(item, /box__label|trip__offer-date/);
  const offer = toString(views.tripListItem(trip({ old_price_cents: 97500, offer_until: '2026-12-01', is_new: true, extra_costs_cents: null })));
  assert.match(offer, /<span class="trip__price--old"><span class="visually-hidden">van <\/span>€975,-<\/span><span class="trip__price-info" aria-hidden="true">\*<\/span>/);
  assert.match(offer, /\* Bij boeking voor 01-12-2026/);
  assert.match(offer, /<span class="box__label">Nieuw<\/span>/);
  assert.doesNotMatch(offer, /Bijkomende/);
  assert.match(toString(views.tripListItem(trip({ fully_booked: true, is_new: true }))), /box__label--full">Volgeboekt<\/span>/);
  assert.doesNotMatch(toString(views.tripListItem(trip({ price_cents: null }))), /box__additional/);
  assert.match(toString(views.tripList([], 'Niets gevonden.')), /<div class="alert">Niets gevonden\.<\/div>/);
  assert.match(toString(views.tripList([trip()], '')), /^<div class="list list--journey archive archive--journey">/);
});

test('reisdetail: reisleider, kenmerken met iconen, inleiding, gegevens, gegarandeerd vertrek en aanmeldknop', () => {
  const page = toString(views.tripDetail(trip(), { isPast: false }));
  assert.match(page, /<div class="block-ghost block-ghost--guide">[\s\S]*<img src="\/media\/m.jpg"[\s\S]*<span class="block-ghost__label">Reisleider<\/span>[\s\S]*<a href="\/reisleider\/martijn\/">Martijn<\/a>/);
  assert.match(page, /<a class="trip-type" href="\/reis-categorie\/kamperen\/" title="Kampeerreizen">\s*<svg class="icon icon--kamperen trip-type__icon"/);
  assert.match(page, /icon--vliegreis/);
  assert.match(page, /<div class="page-introduction">Een onvergetelijk safari-avontuur<\/div>/);
  assert.match(page, /<div class="page-content__text"><p>Tekst<\/p><\/div>/);
  assert.match(page, /<dt>Reiscode<\/dt><dd>26-NAM-293<\/dd>/);
  assert.match(page, /<dt>Bestemming<\/dt><dd><a href="\/reis-categorie\/botswana\/">Botswana<\/a>, <a href="\/reis-categorie\/namibie\/">Namibië<\/a><\/dd>/);
  assert.match(page, /<div class="trip__guaranteed"><h3>Gegarandeerd vertrek<\/h3><\/div>/);
  assert.match(page, /<a class="btn" href="\/aanmelden\/\?id=293&reis=namibie">Ik meld me aan!<\/a>/);
  assert.match(page, /<h2 class="section__title">Afrikaans Avantuur<\/h2>\s*<p class="section__subtitle">wild &amp; wonderful<\/p>/);
  assert.match(page, /<img src="\/media\/g1.jpg" alt="Olifant" loading="lazy" height="500">/);
  assert.match(toString(views.tripDetail(trip({ fully_booked: true }), { isPast: false })), /btn btn--inactive">Volgeboekt/);
  assert.match(toString(views.tripDetail(trip(), { isPast: true })), /btn btn--inactive">Vertrokken/);
  // Zonder reisleider, kenmerken, garantie en galerij: geen lege blokken.
  const bare = toString(views.tripDetail(trip({ guides: [], categories: [], guaranteed: false, gallery: [], tagline: '' }), { isPast: false }));
  assert.doesNotMatch(bare, /trip__content-header|trip__guaranteed|page-gallery|page-introduction|<dt>Reisleider/);
  assert.doesNotMatch(page, /undefined|NaN|\[object/);
});

test('reisdetail: tekst uit de database wordt ge-escaped (behalve de opgeschoonde body)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const page = toString(views.tripDetail(trip({ tagline: evil, trip_code: evil, guides: [{ slug: 'x', name: evil, photo_url: '' }], gallery_title: evil, gallery: [{ url: '/media/a.jpg', alt: '"><script>' }], categories: [{ slug: 'x', name: evil, kind: 'type' }] }), { isPast: false }));
  assert.doesNotMatch(page, /<img src=x|<script>/);
  assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const list = toString(views.tripListItem(trip({ card_image_url: "/media/a.jpg'); background: url(https://evil.example/" })));
  assert.match(list, /url\('\/media\/a\.jpg%27%29;%20background:%20url%28https:\/\/evil\.example\/'\)/);
});

test('galerij: losse adressen of objecten, lege galerij niets, één foto zonder knoppen', () => {
  assert.equal(toString(views.renderGallery({ images: [] })), '');
  const one = toString(views.renderGallery({ images: ['/media/a.jpg'] }));
  assert.match(one, /<section class="section page-gallery">/);
  assert.doesNotMatch(one, /section__title|data-scroller-next/);
  assert.match(toString(views.renderGallery({ title: 'T', images: ['/media/a.jpg', { url: '/media/b.jpg' }, null] })), /data-scroller-next/);
});

test('reisleiders: lijst met staande foto en voornaam, detail met citaat, woonplaats, sinds en galerij', () => {
  const extra = { ...EMPTY_GUIDE, surname: 'de Bruin', city: 'Gouda', since: '2012', quote: 'Antarctica!', portrait: '/media/p.jpg', image: '/media/i.jpg', gallery: ['/media/g.jpg'] };
  const guide = { slug: 'caroline-de-bruin', name: 'Caroline', photo_url: '/media/foto.jpg', body_html: '<p>Over mij</p>', extra };
  const list = toString(views.guideList([guide, { ...guide, slug: 'jan', name: 'Jan', extra: EMPTY_GUIDE }], 'Ontmoet alvast onze reisleiders!'));
  assert.match(list, /<div class="page-introduction">Ontmoet alvast onze reisleiders!<\/div>/);
  assert.match(list, /<a class="post-teaser post-teaser--guide" href="\/reisleider\/caroline-de-bruin\/">\s*<figure class="post-teaser__thumb" style="background-image: url\('\/media\/p.jpg'\)">/);
  assert.match(list, /<h2 class="post-teaser__title">Caroline<\/h2>\s*<span class="post-teaser__subtitle">de Bruin<\/span>/);
  assert.match(list, /url\('\/media\/foto.jpg'\)/, 'zonder portret de gewone foto');
  assert.match(toString(views.guideList([], '')), /class="alert"/);
  const detail = toString(views.guideDetail(guide));
  assert.match(detail, /icon--badge stamp/);
  assert.match(detail, /<span class="guide__featured-image"><img src="\/media\/p.jpg" alt="Caroline"/);
  assert.match(detail, /<span class="guide__image"><img src="\/media\/i.jpg"/);
  assert.match(detail, /<blockquote class="guide__quote">Antarctica!<\/blockquote>/);
  assert.match(detail, /<h1 class="guide__name">Caroline<\/h1>\s*<p class="guide__surname">de Bruin<\/p>/);
  assert.match(detail, /<span class="guide__city">Gouda<\/span>[\s\S]*<span class="guide__year">2012<\/span>/);
  assert.match(detail, /<p>Over mij<\/p>/);
  assert.match(detail, /<img src="\/media\/g.jpg"/);
  const plain = toString(views.guideDetail({ ...guide, extra: EMPTY_GUIDE }));
  assert.doesNotMatch(plain, /guide__quote|guide__stats|guide__surname|guide__image|page-gallery/);
  assert.match(plain, /<img src="\/media\/foto.jpg" alt="Caroline"/);
});

test('paginakop zonder titel (reisleider): alleen "Naar overzicht"', () => {
  const header = toString(renderPageHeader({ bare: true, backLink: '/reisleider/' }));
  assert.match(header, /^<section class="page-header page-header--bare"><div class="layout-container"><a class="to-archive" href="\/reisleider\/">/);
  assert.doesNotMatch(header, /<h1/);
});

test('site-content.json: standaard lijstkoppen, controle van reisleiders en volgorde', () => {
  const fallback = normalizeSiteContent(null);
  assert.deepEqual(fallback.archives.reis, DEFAULT_ARCHIVES.reis);
  assert.equal(fallback.archives.reisleider.introduction, 'Ontmoet alvast onze reisleiders!');
  assert.equal(fallback.guides.size, 0);
  const content = normalizeSiteContent({
    archives: { reis: { title: 'Eigen titel', image: '/media/kop.jpg', pretitle: 7 }, blog: { image: 'https://evil.example/x.jpg' } },
    guides: {
      'caroline-de-bruin': { surname: ' de   Bruin ', city: 'Gouda', since: '2012', quote: 'x'.repeat(900), portrait: '/media/p.jpg', image: '/media/../x.jpg', gallery: ['/media/a.jpg', 'javascript:x', '/media/b.png'] },
      'Fout Slug': { surname: 'X' },
      '../etc': { surname: 'X' },
      jan: { since: 'ooit' },
    },
    guideOrder: ['jan', 'jan', 'Fout', 'caroline-de-bruin'],
  });
  assert.equal(content.archives.reis.title, 'Eigen titel');
  assert.equal(content.archives.reis.pretitle, DEFAULT_ARCHIVES.reis.pretitle);
  assert.equal(content.archives.reis.image, '/media/kop.jpg');
  assert.equal(content.archives.blog.image, '');
  assert.deepEqual([...content.guides.keys()], ['caroline-de-bruin', 'jan']);
  const caroline = content.guides.get('caroline-de-bruin');
  assert.equal(caroline.surname, 'de Bruin');
  assert.equal(caroline.quote.length, 400);
  assert.equal(caroline.image, '');
  assert.deepEqual(caroline.gallery, ['/media/a.jpg', '/media/b.png']);
  assert.equal(content.guides.get('jan').since, '');
  assert.deepEqual(content.guideOrder, ['jan', 'caroline-de-bruin']);
  const sorted = sortGuides([{ slug: 'piet', name: 'Piet' }, { slug: 'caroline-de-bruin', name: 'Caroline' }, { slug: 'anna', name: 'Anna' }, { slug: 'jan', name: 'Jan' }], content.guideOrder);
  assert.deepEqual(sorted.map((guide) => guide.slug), ['jan', 'caroline-de-bruin', 'anna', 'piet']);
});

test('site-content.json: lezer met cache en terugval bij een kapot bestand', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-site-'));
  try {
    const store = createSiteContentStore(dir);
    assert.equal(store.load().archives.reis.title, 'Ons reisaanbod');
    fs.writeFileSync(path.join(dir, SITE_CONTENT_FILE), JSON.stringify({ archives: { reis: { title: 'Nieuw' } } }));
    assert.equal(store.load().archives.reis.title, 'Nieuw');
    fs.writeFileSync(path.join(dir, SITE_CONTENT_FILE), 'kapot');
    assert.equal(store.load().archives.reis.title, 'Ons reisaanbod');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import: reisleidergegevens, lijstkoppen en volgorde van de huidige site', () => {
  const guidePage = `<html><head><meta property="og:title" content="Caroline"></head><body><main><section class="content-main">
    <span class="guide__featured-image"><img src="https://www.avantareizen.nl/app/uploads/p-600x700.jpg"></span>
    <span class="guide__image"><img src="https://www.avantareizen.nl/app/uploads/i.jpg"></span>
    <blockquote class="guide__quote">\`Antarctica heeft indruk gemaakt.\`</blockquote>
    <h1 class="guide__name">Caroline</h1><h2 class="guide__surname">de Bruin</h2>
    <span class="guide__city">Gouda</span><span class="guide__year"> 2012 </span></section>
    <div class="section page-gallery"><div class="section__title">Op reis</div><div class="section__subtitle"></div>
    <img src="https://www.avantareizen.nl/app/uploads/g1.jpg"><img src="https://www.avantareizen.nl/app/uploads/g2.jpg"></div></main></body></html>`;
  const guide = parsers.parseGuide(guidePage, 'https://www.avantareizen.nl/reisleider/caroline-de-bruin/');
  assert.deepEqual(guide.extra, {
    surname: 'de Bruin', city: 'Gouda', since: '2012', quote: 'Antarctica heeft indruk gemaakt.',
    portrait: 'https://www.avantareizen.nl/app/uploads/p-600x700.jpg', image: 'https://www.avantareizen.nl/app/uploads/i.jpg',
    galleryTitle: 'Op reis', gallerySubtitle: '', gallery: ['https://www.avantareizen.nl/app/uploads/g1.jpg', 'https://www.avantareizen.nl/app/uploads/g2.jpg'],
  });
  const archive = `<div class="page-header"><div class="page-header__image" style="background-image: url(https://www.avantareizen.nl/app/uploads/kop.jpg); "></div>
    <div class="page-header__pretitle"> Ervaren avanturiers </div><h1 class="page-header__title">Reisleiders</h1></div>
    <div class="page-introduction">Ontmoet alvast onze reisleiders!</div>
    <div class="archive--guide"><a class="post-teaser" href="https://www.avantareizen.nl/reisleider/23250/"></a><a class="post-teaser" href="https://www.avantareizen.nl/reisleider/jord/"></a></div>`;
  assert.deepEqual(parsers.parseArchiveHeader(archive), { pretitle: 'Ervaren avanturiers', title: 'Reisleiders', image: 'https://www.avantareizen.nl/app/uploads/kop.jpg', introduction: 'Ontmoet alvast onze reisleiders!' });
  assert.deepEqual(parsers.parseGuideOrder(archive), ['23250', 'jord']);
  const media = { local: (url) => (url ? `/media/${path.basename(url)}` : null) };
  const data = siteContentData(
    { archives: { reisleider: parsers.parseArchiveHeader(archive) }, guideOrder: ['23250', 'jord'] },
    [{ ...guide, legacyId: 23250, slug: 'martijn' }],
    media,
  );
  assert.deepEqual(data.guideOrder, ['martijn', 'jord'], 'oud id wordt de slug');
  assert.equal(data.archives.reisleider.image, '/media/kop.jpg');
  assert.deepEqual(data.guides.martijn.gallery, ['/media/g1.jpg', '/media/g2.jpg']);
  // Wat de import schrijft, komt ongeschonden door de controle.
  const checked = normalizeSiteContent(data);
  assert.equal(checked.guides.get('martijn').portrait, '/media/p-600x700.jpg');
  assert.equal(checked.guides.get('martijn').since, '2012');
});

test('homepage-video: alleen een geldig YouTube-id, iframe via youtube-nocookie zonder geluid', () => {
  assert.equal(cleanVideoId('Cs45NTbOzqg'), 'Cs45NTbOzqg');
  for (const bad of ['kort', 'Cs45NTbOzqg1', 'Cs45NTbOz"g', '../../../..', null, 12345678901]) assert.equal(cleanVideoId(bad), '', String(bad));
  const home = normalizeHomepage({ slides: [{ title: 'Video', videoId: 'Cs45NTbOzqg' }, { title: 'Foto', videoId: 'x" onload="' }] });
  assert.equal(home.slides[0].videoId, 'Cs45NTbOzqg');
  assert.equal(home.slides[1].videoId, '');
  const page = toString(renderHome({ home, finder: { destinations: [], types: [], dates: [] }, newCount: 0, lastMinutes: [], types: [], destinations: [], posts: [] }));
  assert.equal((page.match(/<iframe /g) || []).length, 1);
  assert.match(page, /<div class="slide__video"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/Cs45NTbOzqg\?autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=Cs45NTbOzqg&amp;controls=0/);
  assert.match(page, /title="Video: Video"/);
});

test('CSP: bronnen toevoegen aan een bestaande of nieuwe richtlijn, zonder dubbele', () => {
  const base = "default-src 'self'; script-src 'self'";
  assert.equal(addCspSources(base, { 'frame-src': ['https://www.youtube-nocookie.com'] }), "default-src 'self'; script-src 'self'; frame-src 'self' https://www.youtube-nocookie.com");
  const twice = addCspSources(addCspSources(base, { 'frame-src': ['https://a.example'] }), { 'frame-src': ['https://a.example', 'https://b.example'] });
  assert.equal(twice, "default-src 'self'; script-src 'self'; frame-src 'self' https://a.example https://b.example");
});

test('filterbalk op het reisoverzicht: huidige keuze blijft staan', () => {
  const finder = { destinations: [{ slug: 'albanie', name: 'Albanië', trip_count: 1 }], types: [{ slug: 'kamperen', name: 'Kampeerreizen' }], dates: ['2027-07-01'] };
  const bar = toString(renderFilterBar(finder, 2, { bestemming: 'albanie', vertrek: '2027-07-01', nieuw: true }));
  assert.match(bar, /<option value="albanie" selected>Albanië<\/option>/);
  assert.match(bar, /<option value="kamperen">Kampeerreizen<\/option>/);
  assert.match(bar, /<option value="2027-07-01" selected>/);
  assert.match(bar, /name="nieuw" checked/);
  assert.doesNotMatch(toString(renderFilterBar(finder, 2)), /selected|checked/);
});
