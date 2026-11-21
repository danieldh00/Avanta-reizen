/**
 * Tests voor het weblog, de pagina's, de FAQ en de contactpagina (CMS-pakket E4) zonder database: blokken uit de
 * opgeschoonde HTML (tekst, foto, galerij, video), het blogoverzicht en de tags, de FAQ, de contactbox, de nieuwe
 * delen van `site-content.json` (aanmelden, tags, archieflink, galerijen) en de import daarvan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const views = require('../src/site/page-view');
const { normalizeSiteContent, DEFAULT_ARCHIVES, DEFAULT_BLOG_ARCHIVE_LINK } = require('../src/site/site-content');
const parsers = require('../tools/import/parse');
const { siteContentData, galleriesOf, withExistingSiteImages } = require('../tools/import-wordpress');
const { renderPageHeader } = require('../src/site/layout');
const { toString } = require('../src/site/html');

/**
 * Een blogbericht zoals de database het geeft.
 * @param {number} index Volgnummer (voor slug en titel).
 * @returns {object} Bericht.
 */
function post(index) {
  return { slug: `bericht-${index}`, title: `Bericht ${index}`, excerpt: `Samenvatting ${index}`, image_url: `/media/b${index}.jpg`, published_at: '2026-11-02T20:19:44Z' };
}

test('blokken: tekst, losse foto, galerij en YouTube-video uit de opgeschoonde HTML', () => {
  const body = '<p>Eerste</p>\n<img src="/media/a.jpg" alt=""><p>Tweede &amp; <strong>derde</strong></p>'
    + '<p><a href="https://www.youtube.com/embed/el9qys7UK9A?feature=oembed" rel="noopener" target="_blank">Bekijk de video</a></p>'
    + '<div class="gallery"><img src="/media/g1.jpg" alt="Berg"><img src="/media/g2.jpg"></div><p>Slot</p>';
  const { blocks, hasVideo } = views.contentBlocks(body, 'Avanta "in" 2017');
  const out = blocks.map(toString);
  assert.equal(hasVideo, true);
  assert.equal(out.length, 6);
  assert.equal(out[0], '<div class="page-content__text"><p>Eerste</p></div>');
  assert.equal(out[1], '<div class="page-content__image"><img src="/media/a.jpg" alt=""></div>');
  assert.equal(out[2], '<div class="page-content__text"><p>Tweede &amp; <strong>derde</strong></p></div>', 'tekst blijft letterlijk');
  assert.match(out[3], /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/el9qys7UK9A" title="Video: Avanta &quot;in&quot; 2017"/);
  assert.match(out[4], /class="page-content__gallery"><section class="section page-gallery">/);
  assert.match(out[4], /<img src="\/media\/g1\.jpg" alt="Berg"/);
  assert.equal(out[5], '<div class="page-content__text"><p>Slot</p></div>');
});

test('blokken: een link die op een video lijkt maar het niet is, blijft tekst', () => {
  const lookalikes = [
    '<p><a href="https://www.youtube.com/embed/kort" rel="noopener" target="_blank">Bekijk de video</a></p>',
    '<p><a href="https://evil.example/embed/el9qys7UK9A" rel="noopener" target="_blank">Bekijk de video</a></p>',
    '<p><a href="https://www.youtube.com/embed/el9qys7UK9A" rel="noopener" target="_blank">Bekijk de video</a> en meer</p>',
  ];
  for (const body of lookalikes) {
    const { blocks, hasVideo } = views.contentBlocks(body, 'x');
    assert.equal(hasVideo, false, body);
    assert.equal(toString(blocks[0]), `<div class="page-content__text">${body}</div>`);
  }
  assert.deepEqual(views.contentBlocks('', 'x').blocks, []);
  assert.deepEqual(views.contentBlocks('  \n ', 'x').blocks, []);
});

test('bericht of pagina: inleiding, blokken en galerij eronder; inleiding wordt ge-escaped', () => {
  const { body, hasVideo } = views.articleBody({ title: 'T', intro: '<b>Kijk</b>', body_html: '<p>Tekst</p>' }, { title: 'Avanta = avontuur', subtitle: '', images: ['/media/x.jpg'] });
  const out = toString(body);
  assert.equal(hasVideo, false);
  assert.match(out, /^<div class="page-introduction">&lt;b&gt;Kijk&lt;\/b&gt;<\/div><div class="page-content"><div class="page-content__text"><p>Tekst<\/p><\/div><\/div>/);
  assert.match(out, /<h2 class="section__title">Avanta = avontuur<\/h2>/);
  assert.doesNotMatch(toString(views.articleBody({ title: 'T', body_html: '' }).body), /page-content/);
});

test('blogoverzicht: tags, drie berichten links, het vierde groot rechts, de rest in twee kolommen', () => {
  const out = toString(views.blogArchive({
    posts: [1, 2, 3, 4, 5, 6].map(post), introduction: 'Lees ervaringen!',
    tags: [{ slug: 'citytrip', name: 'Citytrip' }], archiveLink: DEFAULT_BLOG_ARCHIVE_LINK,
  }));
  assert.match(out, /<div class="page-introduction">Lees ervaringen!<\/div>/);
  assert.match(out, /<a class="tags__item" href="\/tag\/citytrip\/">Citytrip<\/a>/);
  assert.match(out, /<a class="tags__item tags__item--extern" href="https:\/\/avantareizen\.blogspot\.com\/" rel="noopener" target="_blank">Bekijk blog archief<\/a>/);
  const list = out.slice(out.indexOf('list archive archive--post'), out.indexOf('featured-post'));
  assert.deepEqual([...list.matchAll(/href="\/(bericht-\d)\/"/g)].map((match) => match[1]), ['bericht-1', 'bericht-2', 'bericht-3']);
  assert.match(out, /post-wrapper featured-post"><a class="post-teaser" href="\/bericht-4\/"/);
  const rest = out.slice(out.indexOf('grid archive archive--post'));
  assert.deepEqual([...rest.matchAll(/href="\/(bericht-\d)\/"/g)].map((match) => match[1]), ['bericht-5', 'bericht-6']);
  assert.match(out, /<h2 class="post-teaser__title">Bericht 1<\/h2>/);
  assert.match(out, /<time datetime="2026-11-02T20:19:44.000Z">02\/11\/2026<\/time>/);
  assert.match(toString(views.blogArchive({ posts: [], introduction: '', tags: [], archiveLink: null })), /Er zijn nog geen berichten/);
});

test('blog: het uitgelichte bericht groot, de drie nieuwste andere links; zonder uitgelicht het vierde', () => {
  const posts = [1, 2, 3, 4, 5, 6].map(post);
  const chosen = views.arrangePosts(posts, 'bericht-6');
  assert.deepEqual(chosen.list.map((item) => item.slug), ['bericht-1', 'bericht-2', 'bericht-3']);
  assert.equal(chosen.featured.slug, 'bericht-6');
  assert.deepEqual(chosen.rest.map((item) => item.slug), ['bericht-4', 'bericht-5']);
  const fallback = views.arrangePosts(posts, 'bestaat-niet');
  assert.equal(fallback.featured.slug, 'bericht-4');
  assert.deepEqual(fallback.rest.map((item) => item.slug), ['bericht-5', 'bericht-6']);
  assert.deepEqual(views.arrangePosts([], ''), { list: [], featured: null, rest: [] });
  assert.equal(normalizeSiteContent({ featuredPost: '../x' }).featuredPost, '');
  assert.equal(normalizeSiteContent({ featuredPost: 'winter-fotochallenge-2026' }).featuredPost, 'winter-fotochallenge-2026');
});

test('tagpagina: liggende teasers, of een melding zonder berichten', () => {
  const out = toString(views.tagArchive([post(1)]));
  assert.match(out, /<div class="list__item"><a class="post-teaser post-teaser--landscape" href="\/bericht-1\/">/);
  assert.match(toString(views.tagArchive([])), /Er zijn geen berichten met deze tag/);
});

test('FAQ: categorieën met anker van de oude categoriepagina, vragen klappen uit', () => {
  const out = toString(views.faqList([
    { question: 'Mag ik mee?', answer_html: '<p>Ja</p>', category: 'Algemeen' },
    { question: 'Wat <neem> ik mee?', answer_html: '<p>Weinig</p>', category: 'Groepssamenstelling' },
  ]));
  assert.match(out, /<div class="category category--faq" id="algemeen">\s*<h3 class="category__title">Algemeen<\/h3>/);
  assert.match(out, /id="groepssamenstelling"/);
  assert.match(out, /<details class="faq">\s*<summary class="faq__summary"><h2 class="faq__question">Wat &lt;neem&gt; ik mee\?<\/h2><svg/);
  assert.match(out, /<div class="faq__answer"><p>Ja<\/p><\/div>/);
  assert.equal(views.faqAnchor('Één reis!'), 'een-reis');
  const twice = toString(views.faqList([
    { question: 'A?', answer_html: '', category: 'Één reis' },
    { question: 'B?', answer_html: '', category: 'Een reis!' },
    { question: 'C?', answer_html: '', category: '???' },
  ]));
  assert.match(twice, /id="een-reis"[\s\S]*id="een-reis-2"[\s\S]*id="faq"/, 'unieke ankers');
  assert.match(toString(views.faqList([])), /Er zijn nog geen vragen/);
});

test('contactpagina: adres alleen als het is ingevuld, verwijzing naar de FAQ en het formulier in een box', () => {
  const site = { siteName: 'Avanta Reizen', contact: { phone: '0118 638427', email: 'info@avantareizen.nl' }, organisation: { street: 'Dorpsstraat 1', postalCode: '4331 AB', city: 'Middelburg', kvk: '12345678' } };
  const out = toString(views.contactLayout(site, '<form></form>'));
  assert.match(out, /<h3 class="location__name">Avanta Reizen<\/h3>/);
  assert.match(out, /<div class="location__address"><span>Dorpsstraat 1<\/span><span>4331 AB Middelburg<\/span><\/div>/);
  assert.match(out, /<a href="tel:0118638427">0118 638427<\/a>/);
  assert.match(out, /<li>Kvk: 12345678<\/li>/);
  assert.match(out, /<a href="\/faq\/">veelgestelde vragen<\/a>/);
  assert.match(out, /<h2 class="box__title" id="contact-titel">Verstuur bericht<\/h2>\s*&lt;form&gt;/, 'formulier als tekst wordt ge-escaped');
  const bare = toString(views.contactLayout({ siteName: 'Avanta', contact: { phone: '', email: '' } }, ''));
  assert.doesNotMatch(bare, /location__address|location__phone|Kvk/);
});

test('paginakop van een blogbericht: datum als dd/mm/jjjj, op mobiel de balk erboven', () => {
  const out = toString(renderPageHeader({ title: 'Avanta in 2017', date: new Date('2018-10-04T09:50:51Z'), backLink: '/blog/', single: true }));
  assert.match(out, /class="page-header page-header--single"/);
  assert.match(out, /<p class="page-header__pretitle"><time datetime="2018-10-04T09:50:51.000Z">04\/10\/2018<\/time><\/p>/);
  assert.match(out, /<a class="to-archive" href="\/blog\/">/);
});

test('site-content.json: aanmeldkop, tags, archieflink en galerijen worden gecontroleerd', () => {
  const fallback = normalizeSiteContent(null);
  assert.deepEqual(fallback.archives.aanmelden, DEFAULT_ARCHIVES.aanmelden);
  assert.deepEqual(fallback.blogTags, []);
  assert.deepEqual(fallback.blogArchiveLink, DEFAULT_BLOG_ARCHIVE_LINK);
  assert.equal(fallback.galleries.size, 0);
  const content = normalizeSiteContent({
    blogTags: [
      { slug: 'citytrip', name: 'Citytrip', image: '/media/t.jpg', posts: ['roadtrip', 'roadtrip', '../x', 'In Hoofdletters'] },
      { slug: 'citytrip', name: 'Dubbel' },
      { slug: 'Fout', name: 'X' },
      { slug: 'leeg', name: '' },
      { slug: 'vliegen', name: 'Vliegen', image: 'https://evil.example/x.jpg' },
    ],
    blogArchiveLink: { label: 'Archief', href: 'javascript:alert(1)' },
    galleries: {
      '/avanta-reizen/onzemaniervanreizen/': { title: 'Avanta = avontuur', images: ['/media/a.jpg', 'https://evil.example/b.jpg'] },
      '/zonder-fotos/': { title: 'Leeg', images: [] },
      '//evil.example/': { images: ['/media/c.jpg'] },
      '/met spatie/': { images: ['/media/c.jpg'] },
      'geen-slash': { images: ['/media/c.jpg'] },
    },
  });
  assert.deepEqual(content.blogTags, [
    { slug: 'citytrip', name: 'Citytrip', image: '/media/t.jpg', posts: ['roadtrip'] },
    { slug: 'vliegen', name: 'Vliegen', image: '', posts: [] },
  ]);
  assert.deepEqual(content.blogArchiveLink, DEFAULT_BLOG_ARCHIVE_LINK, 'onveilige link: de standaard');
  assert.deepEqual([...content.galleries.keys()], ['/avanta-reizen/onzemaniervanreizen/']);
  assert.deepEqual(content.galleries.get('/avanta-reizen/onzemaniervanreizen/'), { title: 'Avanta = avontuur', subtitle: '', images: ['/media/a.jpg'] });
});

test('import: tags met berichten, archieflink, aanmeldkop en galerijen van berichten en pagina\'s', () => {
  const blog = `<div class="tags"><a href='https://www.avantareizen.nl/tag/citytrip/' class='tags__item'>Citytrip</a>
    <a href='http://avantareizen.blogspot.com/' target='_blank' class='tags__item tags__item--extern'>Bekijk blog archief</a></div>`;
  assert.deepEqual(parsers.parseBlogTags(blog), {
    tags: [{ slug: 'citytrip', name: 'Citytrip' }],
    archiveLink: { label: 'Bekijk blog archief', href: 'https://avantareizen.blogspot.com/' },
    featured: '',
  });
  assert.equal(parsers.parseBlogTags('<div class="post-wrapper featured-post"><a href="https://www.avantareizen.nl/winter-fotochallenge-2026/" class="post-teaser"></a></div>').featured, 'winter-fotochallenge-2026');
  const tagPage = `<div class="page-header"><div class="page-header__image" style="background-image: url(https://www.avantareizen.nl/app/uploads/t.jpg); "></div></div>
    <div class="list archive archive--post"><div class="list__item"><a href="https://www.avantareizen.nl/roadtrip-zuidwest-vs/" class="post-teaser post-teaser--landscape"></a></div></div>`;
  assert.deepEqual(parsers.parseTagPage(tagPage), { image: 'https://www.avantareizen.nl/app/uploads/t.jpg', posts: ['roadtrip-zuidwest-vs'] });
  const page = `<html><body class="page-id-16"><div class="page-header"><h1 class="page-header__title">Onze manier</h1></div>
    <div class="page-content"><div class="page-content__text"><p>Tekst</p></div></div>
    <div class="section page-gallery"><div class="section__title">Avanta = avontuur</div><div class="section__subtitle">Kies avontuur</div>
    <div class="slick-slider"><div class="slick-slider__slide"><img src="https://www.avantareizen.nl/app/uploads/g1.jpg" alt=""></div></div></div></body></html>`;
  const parsedPage = parsers.parsePage(page, 'https://www.avantareizen.nl/avanta-reizen/onzemaniervanreizen/');
  assert.deepEqual(parsedPage.gallery, { title: 'Avanta = avontuur', subtitle: 'Kies avontuur', images: ['https://www.avantareizen.nl/app/uploads/g1.jpg'] });
  const parsedPost = parsers.parsePost('<html><body><h1 class="page-header__title">Zonder</h1></body></html>', 'https://www.avantareizen.nl/zonder/');
  assert.deepEqual(parsedPost.gallery, { title: '', subtitle: '', images: [] });
  const galleries = galleriesOf([{ slug: 'zonder', gallery: parsedPost.gallery }], [parsedPage]);
  assert.deepEqual(galleries.map((item) => item.path), ['/avanta-reizen/onzemaniervanreizen/'], 'alleen met foto\'s');

  const media = { local: (url) => (url ? `/media/${path.basename(url)}` : null) };
  const data = siteContentData({
    archives: { aanmelden: { pretitle: 'Ja! Ik ga graag mee op reis', title: 'Aanmelden', image: 'https://www.avantareizen.nl/app/uploads/a.jpg', introduction: '' } },
    guideOrder: [],
    blogTags: [{ slug: 'citytrip', name: 'Citytrip', ...parsers.parseTagPage(tagPage) }],
    blogArchiveLink: parsers.parseBlogTags(blog).archiveLink,
  }, [], media, galleries);
  assert.deepEqual(data.blogTags, [{ slug: 'citytrip', name: 'Citytrip', image: '/media/t.jpg', posts: ['roadtrip-zuidwest-vs'] }]);
  assert.deepEqual(data.galleries['/avanta-reizen/onzemaniervanreizen/'].images, ['/media/g1.jpg']);
  const checked = normalizeSiteContent(data);
  assert.equal(checked.archives.aanmelden.image, '/media/a.jpg');
  assert.equal(checked.archives.aanmelden.introduction, DEFAULT_ARCHIVES.aanmelden.introduction, 'lege inleiding: de vaste tekst');
  assert.deepEqual(checked.blogArchiveLink, { label: 'Bekijk blog archief', href: 'https://avantareizen.blogspot.com/' });
  // Niet gedownloade foto's vallen weg.
  const kept = withExistingSiteImages(data);
  assert.deepEqual(kept.blogTags[0].image, '');
  assert.deepEqual(kept.galleries['/avanta-reizen/onzemaniervanreizen/'].images, []);
});
