/**
 * Tests voor de homepage (CMS-pakket E2) zonder database: de controle van `homepage.json`, de lezer met cache, het
 * uitlezen van de huidige homepage bij de import (`parseHome`, `homepageLink`, `homepageData`) en de HTML van de
 * homepage (slider, filterbalk, last-minutes, reistypes, inspiratie, bestemmingen, blog en "over Avanta").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_HOMEPAGE, normalizeHomepage, createHomepageStore, cleanHref, cleanImage, HOMEPAGE_FILE } = require('../src/site/homepage');
const { renderHome, renderFilterBar, tripBox, withFallbackImages, truncate, slashDate } = require('../src/site/home-view');
const { parseHome } = require('../tools/import/parse');
const { homepageLink, homepageData } = require('../tools/import-wordpress');
const { toString } = require('../src/site/html');

/** Een stukje van de huidige homepage, in de opmaak van het oude thema. */
const LIVE_HOME = `<main>
  <section class="homepage__slides">
    <div class="slide"><div class="slide__image" style="background-image: url('https://www.avantareizen.nl/app/uploads/2026/08/winter.jpg')"></div>
      <p class="slide__pretitle">chase   the snow!</p><h2 class="slide__title">winters avantuur</h2>
      <a class="slide__btn" href="https://www.avantareizen.nl/reis/?trip_destination=240&amp;trip_new=1">al onze winterreizen</a></div>
    <div class="slide"><div class="slide__video"><iframe src="https://www.youtube.com/embed/AbCdEfGhIjK?autoplay=1"></iframe></div>
      <p class="slide__title">Wildkamperen</p><a class="slide__btn" href="https://www.avantareizen.nl/reis/">pitch your tent here</a></div>
  </section>
  <section class="homepage__last-minutes"><h2 class="section__title">Inpakken en wegwezen!</h2><p class="section__subtitle">voor plotselinge reiskriebels</p>
    <div class="section__footer"><a class="btn" href="/reis/">Meer last-minutes</a></div></section>
  <section class="homepage__trip-types"><h2 class="section__title">Met Avanta reis je</h2><p class="section__subtitle">voor verschillende leeftijden</p>
    <a class="trip-type" href="https://www.avantareizen.nl/reis-categorie/hostel/">Hostel</a><a class="trip-type" href="https://www.avantareizen.nl/reis-categorie/plus/">Plus</a></section>
  <section class="homepage__inspiration"><div class="slide"><figure class="slide__figure" style="background-image: url(https://www.avantareizen.nl/app/uploads/b.jpg)"></figure>
    <p class="slide__title">Back to the basics</p><p class="slide__text">Een tentje om in te slapen.</p></div></section>
  <section class="homepage__popular"><h2 class="section__title">Onze bestemmingen</h2><p class="section__subtitle">naar alle hoeken</p></section>
  <section class="homepage__blog"><h2 class="section__title">Blog</h2><p class="section__subtitle">Tips</p><div class="section__footer"><a class="btn">Meer blogberichten</a></div></section>
  <section class="homepage__about"><span class="about__image"><img src="https://www.avantareizen.nl/app/uploads/about.jpg"></span>
    <h1 class="section__title">Voor Avanta Reizen is geen bestemming te ver</h1>
    <div class="section__content"><p>Wie kiest voor Avanta.</p><a class="readon" href="https://www.avantareizen.nl/avanta-reizen/">Dit zijn wij!</a></div></section>
</main>`;

/**
 * Basisgegevens voor `renderHome`.
 * @param {object} [extra] Afwijkingen.
 * @returns {object} Gegevens.
 */
function homeData(extra = {}) {
  return {
    home: normalizeHomepage(null),
    finder: {
      destinations: [{ slug: 'albanie', name: 'Albanië', trip_count: 2 }, { slug: 'leeg', name: 'Leeg land', trip_count: 0 }],
      types: [{ slug: 'kamperen', name: 'Kampeerreizen' }],
      dates: ['2027-07-01'],
    },
    newCount: 3,
    lastMinutes: [
      { slug: 'albanie', title: '8 dagen Albanië', departure_date: '2027-07-01', trip_code: '27-AKO-56', card_image_url: '/media/a.jpg', is_new: true, fully_booked: false },
      { slug: 'vol', title: 'Volle reis', departure_date: '2027-08-01', trip_code: '', card_image_url: '', is_new: true, fully_booked: true },
    ],
    types: [{ slug: 'kamperen', name: 'Kampeerreizen' }, { slug: 'hostel', name: 'Hostelreizen' }],
    destinations: [{ slug: 'albanie', name: 'Albanië', image_url: '/media/land.jpg' }],
    posts: [1, 2, 3, 4].map((number) => ({ slug: `bericht-${number}`, title: `Bericht ${number}`, excerpt: 'Een verhaal', image_url: '', published_at: '2026-10-0' + number + 'T10:00:00Z' })),
    ...extra,
  };
}

test('homepage.json: zonder bestand de teksten van de huidige site', () => {
  const home = normalizeHomepage(null);
  assert.equal(home.slides.length, DEFAULT_HOMEPAGE.slides.length);
  assert.equal(home.slides[0].href, '/reis/?bestemming=wintersport&nieuw=1');
  assert.equal(home.sections.lastMinutes.title, 'Inpakken en wegwezen!');
  assert.equal(home.sections.blog.button, 'Meer blogberichten');
  assert.equal(home.sections.types.button, undefined, 'geen knop waar de huidige site er geen heeft');
  assert.equal(home.inspiration.length, 4);
  assert.equal(home.about.href, '/avanta-reizen/');
  assert.deepEqual(home.typeSlugs, ['hostel', 'jeugd', 'jongeren', 'kamperen', 'plus']);
  // De standaard zelf blijft ongewijzigd als de uitkomst wordt aangepast.
  home.slides[0].title = 'anders';
  assert.equal(DEFAULT_HOMEPAGE.slides[0].title, 'winters avantuur');
  assert.deepEqual(normalizeHomepage([1, 2]).typeSlugs, DEFAULT_HOMEPAGE.typeSlugs, 'een lijst is geen geldige inhoud');
});

test('homepage.json: alles wordt gecontroleerd en ingekort; onveilige links en foto\'s vallen weg', () => {
  const home = normalizeHomepage({
    slides: [
      { pretitle: '  veel   witruimte ', title: 'x'.repeat(500), button: 'Ga', href: 'javascript:alert(1)', image: '/media/../geheim.jpg' },
      { title: 'Goed', href: '/reis/?type=kamperen', image: '/media/abc_1.webp' },
      { title: '', href: '/leeg/' },
      { title: 'Extern', href: 'https://example.nl/x', image: 'https://evil.example/x.jpg' },
      null,
    ],
    inspiration: [{ title: 'Eén', text: 7, image: '/media/a.svg' }],
    sections: { blog: { title: 'Eigen blogtitel', subtitle: 42 }, types: 'kapot' },
    about: { href: '//evil.example/', image: '/media/over.jpg', text: '' },
    typeSlugs: ['hostel', 'Fout', '<script>', 'plus'],
  });
  assert.equal(home.slides.length, 3, 'dia zonder titel valt weg');
  assert.equal(home.slides[0].pretitle, 'veel witruimte');
  assert.equal(home.slides[0].title.length, 120);
  assert.equal(home.slides[0].href, '');
  assert.equal(home.slides[0].image, '');
  assert.deepEqual(home.slides[1], { pretitle: '', title: 'Goed', button: '', href: '/reis/?type=kamperen', image: '/media/abc_1.webp', videoId: '' });
  assert.equal(home.slides[2].href, 'https://example.nl/x');
  assert.equal(home.slides[2].image, '', 'geen externe foto');
  assert.deepEqual(home.inspiration, [{ title: 'Eén', text: '', image: '' }]);
  assert.equal(home.sections.blog.title, 'Eigen blogtitel');
  assert.equal(home.sections.blog.subtitle, DEFAULT_HOMEPAGE.sections.blog.subtitle);
  assert.equal(home.sections.types.title, DEFAULT_HOMEPAGE.sections.types.title);
  assert.equal(home.about.href, '/avanta-reizen/', 'protocol-relatieve link wordt de standaard');
  assert.equal(home.about.image, '/media/over.jpg');
  assert.equal(home.about.text, DEFAULT_HOMEPAGE.about.text);
  assert.deepEqual(home.typeSlugs, ['hostel', 'plus']);
  assert.equal(normalizeHomepage({ slides: Array.from({ length: 20 }, (_, i) => ({ title: `Dia ${i}` })) }).slides.length, 8);
});

test('homepage.json: links en foto\'s', () => {
  assert.equal(cleanHref('/reis/'), '/reis/');
  assert.equal(cleanHref('https://www.avantareizen.nl/'), 'https://www.avantareizen.nl/');
  for (const bad of ['//evil.example', 'http://example.nl', 'javascript:alert(1)', '/a"b', "/a'b", '/a<b', '/a b', '/a\\b', 'reis/', null, 5]) {
    assert.equal(cleanHref(bad), '', String(bad));
  }
  assert.equal(cleanImage('/media/foto.JPG'), '/media/foto.JPG');
  for (const bad of ['/media/sub/foto.jpg', '/media/..jpg', '/media/foto.svg', '/images/foto.jpg', 'https://x.nl/media/a.jpg', '/media/a b.jpg']) {
    assert.equal(cleanImage(bad), '', bad);
  }
});

test('homepage.json: lezer gebruikt het bestand, onthoudt het tot het verandert en valt terug bij een kapot bestand', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-home-'));
  try {
    const store = createHomepageStore(dir);
    assert.equal(store.load().about.title, DEFAULT_HOMEPAGE.about.title, 'zonder bestand de standaard');
    const file = path.join(dir, HOMEPAGE_FILE);
    fs.writeFileSync(file, JSON.stringify({ about: { title: 'Eerste titel' } }));
    const first = store.load();
    assert.equal(first.about.title, 'Eerste titel');
    assert.equal(store.load(), first, 'zelfde bestand: uit de cache');
    fs.writeFileSync(file, JSON.stringify({ about: { title: 'Tweede, langere titel' } }));
    assert.equal(store.load().about.title, 'Tweede, langere titel');
    fs.writeFileSync(file, '{kapot');
    assert.equal(store.load().about.title, DEFAULT_HOMEPAGE.about.title);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import: de huidige homepage wordt uitgelezen, met video en reistypes', () => {
  const home = parseHome(LIVE_HOME);
  assert.equal(home.slides.length, 2);
  assert.deepEqual(home.slides[0], {
    pretitle: 'chase the snow!', title: 'winters avantuur', button: 'al onze winterreizen',
    href: 'https://www.avantareizen.nl/reis/?trip_destination=240&trip_new=1',
    image: 'https://www.avantareizen.nl/app/uploads/2026/08/winter.jpg', videoId: null,
  });
  assert.equal(home.slides[1].videoId, 'AbCdEfGhIjK');
  assert.deepEqual(home.sections.lastMinutes, { title: 'Inpakken en wegwezen!', subtitle: 'voor plotselinge reiskriebels', button: 'Meer last-minutes' });
  assert.equal(home.sections.blog.button, 'Meer blogberichten');
  assert.deepEqual(home.inspiration, [{ title: 'Back to the basics', text: 'Een tentje om in te slapen.', image: 'https://www.avantareizen.nl/app/uploads/b.jpg' }]);
  assert.equal(home.about.text, 'Wie kiest voor Avanta.', 'de leesverder-link hoort niet bij de tekst');
  assert.equal(home.about.linkLabel, 'Dit zijn wij!');
  assert.equal(home.about.image, 'https://www.avantareizen.nl/app/uploads/about.jpg');
  assert.deepEqual(home.typeSlugs, ['hostel', 'plus']);
});

test('import: links naar het reisfilter worden de nieuwe filters; de rest wordt een eigen pad', () => {
  const slugs = new Map([[240, 'wintersport'], [12, 'kamperen']]);
  assert.equal(homepageLink('https://www.avantareizen.nl/reis/?trip_destination=240&trip_new=1', slugs), '/reis/?bestemming=wintersport&nieuw=1');
  assert.equal(homepageLink('https://www.avantareizen.nl/reis/?trip_type=12', slugs), '/reis/?type=kamperen');
  assert.equal(homepageLink('https://www.avantareizen.nl/reis/?trip_destination=999', slugs), '/reis/', 'onbekende categorie');
  assert.equal(homepageLink('https://www.avantareizen.nl/blog/', slugs), '/blog/');
  assert.equal(homepageLink('', slugs), '');

  const media = { local: (url) => `/media/${path.basename(url)}`, poster: (id) => `/media/yt-${id}.jpg` };
  const data = homepageData(parseHome(LIVE_HOME), media, slugs);
  assert.equal(data.slides[0].href, '/reis/?bestemming=wintersport&nieuw=1');
  assert.equal(data.slides[0].image, '/media/winter.jpg');
  assert.equal(data.slides[1].image, '/media/yt-AbCdEfGhIjK.jpg', 'videoslide krijgt de stilstaande afbeelding');
  assert.equal(data.about.href, '/avanta-reizen/');
  // Wat de import schrijft, komt ongeschonden door de controle.
  const checked = normalizeHomepage(data);
  assert.equal(checked.slides[1].image, '/media/yt-AbCdEfGhIjK.jpg');
  assert.equal(checked.about.image, '/media/about.jpg');
});

test('homepage: alle secties in de volgorde van de huidige site', () => {
  const page = toString(renderHome(homeData()));
  const order = ['homepage__slides', 'class="filter"', 'homepage__last-minutes', 'homepage__trip-types', 'homepage__inspiration', 'homepage__popular', 'homepage__blog', 'homepage__about'];
  const positions = order.map((marker) => page.indexOf(marker));
  for (const [index, position] of positions.entries()) assert.ok(position > -1, order[index]);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  // Slider: eerste dia actief, de rest verborgen, stippen met aria-current, muis naar de last-minutes.
  assert.match(page, /<li class="slide is-active" data-slide aria-roledescription="slide" aria-label="1 van 5">/);
  assert.match(page, /<li class="slide" data-slide aria-roledescription="slide" aria-label="2 van 5" aria-hidden="true">/);
  assert.match(page, /data-slide-to="0" aria-current="true"/);
  assert.match(page, /class="anchorlink" href="#last-minutes"/);
  assert.match(page, /id="last-minutes"/);
  // Reistypes met eigen icoon en link naar de categorie.
  assert.match(page, /<a class="trip-type" href="\/reis-categorie\/kamperen\/">\s*<svg class="icon icon--kamperen trip-type__icon"/);
  // Bestemmingen: banner met veilige achtergrond.
  assert.match(page, /href="\/reis-categorie\/albanie\/" style="background-image: url\('\/media\/land.jpg'\)"/);
  // Blog: drie in de lijst, de vierde groot.
  assert.equal((page.match(/class="post-wrapper"/g) || []).length, 3);
  assert.match(page, /class="post-wrapper featured-post"><a class="post-teaser" href="\/bericht-4\/"/);
  assert.match(page, /<time datetime="2026-10-01T10:00:00.000Z">01\/10\/2026<\/time>/);
  // Over Avanta: de koptekst van de pagina, link en stempel.
  assert.match(page, /<h1 class="section__title">Voor Avanta Reizen is geen bestemming te ver<\/h1>/);
  assert.match(page, /<a class="readon" href="\/avanta-reizen\/">Dit zijn wij!<\/a>/);
  assert.match(page, /icon--badge stamp/);
  assert.doesNotMatch(page, /undefined|NaN|\[object/);
});

test('homepage: lege onderdelen vallen weg en last-minutes meldt dat er niets is', () => {
  const page = toString(renderHome(homeData({ lastMinutes: [], types: [], destinations: [], posts: [] })));
  assert.match(page, /Op dit moment geen last-minutes\./);
  assert.doesNotMatch(page, /homepage__trip-types|homepage__popular|homepage__blog/);
  const one = toString(renderHome(homeData({ home: normalizeHomepage({ slides: [{ title: 'Enige' }], inspiration: [{ title: 'Enige' }] }) })));
  assert.doesNotMatch(one, /slides-navigation|data-slide-prev/, 'één dia: geen stippen of pijlen');
});

test('homepage: alle tekst wordt ge-escaped, ook uit homepage.json en de database', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const home = normalizeHomepage({ slides: [{ title: evil, pretitle: evil, button: evil, href: '/x/' }], about: { title: evil, text: evil } });
  const page = toString(renderHome(homeData({
    home,
    lastMinutes: [{ slug: 'x', title: evil, departure_date: '2027-01-01', trip_code: evil, card_image_url: '', is_new: false, fully_booked: false }],
    types: [{ slug: 'x', name: evil }],
    destinations: [{ slug: 'x', name: evil, image_url: "/media/a.jpg'); background: url(https://evil.example/" }],
    posts: [{ slug: 'x', title: evil, excerpt: evil, image_url: '', published_at: null }],
  })));
  assert.doesNotMatch(page, /<img src=x/);
  assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(page, /url\('\/media\/a\.jpg'\)/);
  assert.match(page, /url\('\/media\/a\.jpg%27%29;%20background:%20url%28https:\/\/evil\.example\/'\)/, 'kan url() niet sluiten');
});

test('filterbalk: alleen bestemmingen met reizen, aantal nieuwe reizen en een gewoon formulier naar /reis/', () => {
  const bar = toString(renderFilterBar(homeData().finder, 3));
  assert.match(bar, /<form class="filter__form" action="\/reis\/" method="get"/);
  assert.match(bar, /<option value="albanie">Albanië<\/option>/);
  assert.doesNotMatch(bar, /Leeg land/);
  assert.match(bar, /<option value="kamperen">Kampeerreizen<\/option>/);
  assert.match(bar, /<option value="2027-07-01">/);
  assert.match(bar, /Nieuwe reizen \(3\)/);
  assert.match(bar, /<input class="filter__switch" type="checkbox" value="1" id="filter-nieuw" name="nieuw"/);
  for (const name of ['bestemming', 'type', 'vertrek']) assert.match(bar, new RegExp(`<label class="filter__label" for="filter-${name}">`));
});

test('reisbox: label Nieuw of Volgeboekt, datum en reiscode', () => {
  const [fresh, full] = homeData().lastMinutes;
  const freshBox = toString(tripBox(fresh));
  assert.match(freshBox, /<a class="post-teaser post-teaser--trip" href="\/reis\/albanie\/">/);
  assert.match(freshBox, /<span class="box__label">Nieuw<\/span>/);
  assert.match(freshBox, /<span class="trip__code">27-AKO-56<\/span>/);
  assert.match(freshBox, /<img src="\/media\/a.jpg"/);
  const fullBox = toString(tripBox(full));
  assert.match(fullBox, /box__label--full">Volgeboekt/);
  assert.doesNotMatch(fullBox, />Nieuw</, 'volgeboekt gaat voor nieuw');
  assert.doesNotMatch(fullBox, /<img|trip__code/);
});

test('homepage: ontbrekende foto\'s worden aangevuld met verschillende reisfoto\'s', () => {
  const home = normalizeHomepage({ slides: [{ title: 'Eigen', image: '/media/eigen.jpg' }, { title: 'Zonder' }, { title: 'Ook zonder' }] });
  const filled = withFallbackImages(home, ['/media/r1.jpg', '/media/r1.jpg', '', '/media/r2.jpg']);
  assert.equal(filled.slides[0].fallbackImage, undefined);
  assert.equal(filled.slides[1].fallbackImage, '/media/r1.jpg');
  assert.equal(filled.slides[2].fallbackImage, '/media/r2.jpg');
  assert.equal(withFallbackImages(home, []).slides[1].fallbackImage, '');
});

test('hulpjes: samenvatting inkorten op een woordgrens en datum met schuine strepen', () => {
  assert.equal(truncate('kort', 10), 'kort');
  assert.equal(truncate('een heel lange zin met woorden', 12), 'een heel ...');
  assert.equal(truncate('al ingekort …', 50), 'al ingekort');
  assert.equal(truncate(null, 5), '');
  assert.equal(slashDate(''), '');
});
