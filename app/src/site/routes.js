/**
 * Routes van de publieke website. De URL's zijn gelijk aan die van de huidige WordPress-site, zodat links en
 * zoekmachineposities bij de overstap blijven werken.
 */
const express = require('express');
const { html, raw } = require('./html');
const { renderPage, renderPageHeader, cssImageUrl } = require('./layout');
const { isExcluded } = require('./site-settings');
const { createContent, today } = require('./content');
const pageViews = require('./page-view');
const homeViews = require('./home-view');
const { createHomepageStore, YOUTUBE_ORIGIN } = require('./homepage');
const { addCspSources } = require('../security/csp');
const tripViews = require('./trip-view');
const { createSiteContentStore, sortGuides, EMPTY_GUIDE } = require('./site-content');
const { DATA_DIR } = require('../paths');
const { isoDate, toDate, tripPath, categoryPath, guidePath, postPath } = require('./format');
const seo = require('./seo');

/** Hoe lang de sitemap uit het geheugen komt voordat hij opnieuw wordt opgebouwd (milliseconden). */
const SITEMAP_CACHE_MS = 10 * 60 * 1000;

/**
 * Vangt fouten van een asynchrone route op en geeft ze aan Express door.
 * @param {Function} handler Asynchrone route.
 * @returns {Function} Express-route.
 */
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Leest een slug uit de URL; alleen redelijke tekens en lengte.
 * @param {string} value Waarde uit de URL.
 * @returns {(string|null)} De slug of null.
 */
function safeSlug(value) {
  const slug = String(value || '').trim();
  return slug && slug.length <= 200 && !/[\s/\\<>"']/.test(slug) ? slug : null;
}

/**
 * Leest een optionele filterwaarde uit de querystring.
 * @param {*} value Waarde.
 * @returns {string} Slug of leeg.
 */
function queryValue(value) {
  return typeof value === 'string' ? (safeSlug(value) || '') : '';
}

/**
 * Bouwt de router van de website.
 * @param {{db: object, contactForm?: object, homepage?: {load: Function}, siteContent?: {load: Function}}} options Database,
 *   het contactformulier en (voor tests) de vaste inhoud van de homepage (standaard `DATA_DIR/homepage.json`, zie
 *   `site/homepage.js`) en van lijstkoppen en reisleiders (standaard `DATA_DIR/site-content.json`, zie
 *   `site/site-content.js`). Indexeren, basisadres, naam en
 *   de overige site-instellingen komen per verzoek uit `res.locals.site` (Beheer, zie `site/site-settings.js`).
 *   Zonder contactformulier (`contact/routes.js`) is `/contact/` een gewone pagina.
 * @returns {express.Router} De router.
 */
function createSiteRouter(options) {
  const router = express.Router({ strict: true });
  const content = createContent(options.db);
  const homepage = options.homepage || createHomepageStore(DATA_DIR);
  const siteContent = options.siteContent || createSiteContentStore(DATA_DIR);
  let sitemapCache = null;

  /**
   * Gegevens voor de SEO-tags van een pagina, nog met relatieve paden: `send` maakt ze absoluut met het basisadres uit
   * Beheer. JSON-LD mag een functie `(site) => object` zijn, die pas bij het versturen wordt aangeroepen.
   * @param {string} canonicalPath Echte pad van de pagina (niet het menupad), eventueel met querystring.
   * @param {{imageUrl?: string, type?: string, structuredData?: Array<(object|Function)>}} [extra] Afbeelding, og:type en JSON-LD.
   * @returns {object} Gegevens voor `send`.
   */
  const seoFor = (canonicalPath, extra = {}) => ({
    canonicalPath,
    imagePath: extra.imageUrl || '',
    type: extra.type || 'website',
    structuredData: extra.structuredData || [],
  });

  /**
   * Kruimelpad als JSON-LD, altijd beginnend bij de homepage.
   * @param {Array<{name: string, path: string}>} items Stappen na de homepage.
   * @returns {Function} `(site) => BreadcrumbList`.
   */
  const breadcrumbs = (items) => (site) => seo.breadcrumbData(site.siteUrl, [{ name: 'Home', path: '/' }, ...items]);

  /**
   * Stuurt een volledige pagina met de site-instellingen van dit verzoek (indexeren, basisadres, naam, contact).
   * @param {object} res Express-antwoord.
   * @param {object} page Gegevens voor renderPage; `seo` uit `seoFor`.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const send = (res, page, status = 200) => {
    const site = res.locals.site;
    const pageSeo = page.seo ? {
      canonicalUrl: seo.absoluteUrl(site.siteUrl, page.seo.canonicalPath),
      imageUrl: page.seo.imagePath ? seo.absoluteUrl(site.siteUrl, page.seo.imagePath) : site.imageUrl,
      type: page.seo.type,
      structuredData: page.seo.structuredData.map((item) => (typeof item === 'function' ? item(site) : item)),
    } : undefined;
    res.status(status).type('html').send(renderPage({ ...page, indexable: site.indexable, site, seo: pageSeo }));
  };

  /**
   * Gegevens voor de zoeker (bestemmingen, types, vertrekdata).
   * @returns {Promise<object>} Keuzes.
   */
  const finderOptions = async () => {
    const [destinations, types, dates] = await Promise.all([content.categories('bestemming'), content.categories('type'), content.departureDates()]);
    return { destinations, types, dates };
  };

  // WordPress-adressen zonder slash aan het eind: doorsturen naar de vorm met slash.
  router.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(req.path) && !req.path.startsWith('/api/')) {
      const query = req.originalUrl.slice(req.path.length);
      // Voorloop-slashes en backslashes samenvoegen: '//evil.example' zou anders een open redirect naar een ander domein zijn.
      const localPath = req.path.replace(/^[/\\]+/, '/');
      return res.redirect(301, `${localPath}/${query}`);
    }
    return next();
  });

  router.get('/', asyncRoute(async (req, res) => {
    if (typeof req.query.s === 'string') return res.redirect(302, `/zoeken/?s=${encodeURIComponent(req.query.s)}`);
    const home = homepage.load();
    const [finder, lastMinutes, upcoming, types, blog, newCount] = await Promise.all([
      finderOptions(),
      content.upcomingTrips({ onlyAvailable: true, limit: 6 }),
      content.upcomingTrips({ limit: 60 }),
      content.categories('type'),
      content.posts({ perPage: 5 }),
      content.newTripCount(),
    ]);
    // Blog: drie nieuwste links, het uitgelichte bericht (of anders het vierde) groot rechts, zoals de huidige site.
    const featuredSlug = siteContent.load().featuredPost;
    const featuredPost = featuredSlug && !blog.posts.some((post) => post.slug === featuredSlug) ? (await content.postsBySlugs([featuredSlug]))[0] : null;
    const arranged = pageViews.arrangePosts(featuredPost ? [...blog.posts, featuredPost] : blog.posts, featuredSlug);
    const homePosts = [...arranged.list, ...(arranged.featured ? [arranged.featured] : [])];
    const typeBySlug = new Map(types.map((type) => [type.slug, type]));
    const homeTypes = home.typeSlugs.map((slug) => typeBySlug.get(slug)).filter(Boolean);
    const destinations = finder.destinations.filter((destination) => destination.trip_count > 0);
    const tripImages = upcoming.map((trip) => cssImageUrl(trip.card_image_url)).filter(Boolean);
    const filled = homeViews.withFallbackImages(home, tripImages);
    const heroImage = cssImageUrl(filled.slides[0].image || filled.slides[0].fallbackImage);
    // Een videodia laadt de video van youtube-nocookie.com; alleen dan mag de homepage dat adres in een iframe tonen.
    if (filled.slides.some((slide) => slide.videoId)) res.set('Content-Security-Policy', addCspSources(res.get('Content-Security-Policy'), { 'frame-src': [YOUTUBE_ORIGIN] }));
    send(res, {
      path: '/',
      seo: seoFor('/', { imageUrl: heroImage, structuredData: [(site) => seo.travelAgencyData(site.siteUrl, site.contact, { ...site.organisation, name: site.siteName, imageUrl: site.imageUrl })] }),
      bodyClass: 'home',
      body: homeViews.renderHome({
        home: filled,
        finder,
        newCount,
        lastMinutes,
        types: homeTypes.length ? homeTypes : types.filter((type) => type.trip_count > 0),
        destinations,
        posts: homePosts,
      }),
    });
  }));

  // Sitemap met alle openbare adressen; robots.txt verwijst er alleen naar als de site geïndexeerd mag worden.
  router.get('/sitemap.xml', asyncRoute(async (req, res) => {
    const site = res.locals.site;
    // De cache geldt voor één combinatie van basisadres en uitsluitingen; een wijziging in Beheer bouwt hem opnieuw.
    const cacheKey = JSON.stringify([site.siteUrl, site.sitemapExclude]);
    if (!sitemapCache || sitemapCache.key !== cacheKey || Date.now() - sitemapCache.builtAt > SITEMAP_CACHE_MS) {
      const entries = await content.sitemapEntries();
      const urls = seo.sitemapUrls(entries).filter((url) => !isExcluded(url.path, site.sitemapExclude));
      sitemapCache = { key: cacheKey, builtAt: Date.now(), xml: seo.renderSitemap(site.siteUrl, urls) };
    }
    res.set('Cache-Control', 'public, max-age=600').type('application/xml').send(sitemapCache.xml);
  }));

  // llms.txt voor AI-zoekmachines: alleen als de site geïndexeerd mag worden en het in Beheer aan staat.
  router.get('/llms.txt', asyncRoute(async (req, res, next) => {
    const site = res.locals.site;
    if (!site.indexable || !site.llms.enabled) return next();
    const [destinations, types] = await Promise.all([content.categories('bestemming'), content.categories('type')]);
    return res.set('Cache-Control', 'public, max-age=600').type('text/plain').send(seo.llmsTxt(site, { categories: [...types, ...destinations] }));
  }));

  router.get('/reis/', asyncRoute(async (req, res) => {
    const selected = { bestemming: queryValue(req.query.bestemming), type: queryValue(req.query.type), vertrek: queryValue(req.query.vertrek) };
    const newFirst = req.query.nieuw === '1';
    const departure = /^\d{4}-\d{2}-\d{2}$/.test(selected.vertrek) ? selected.vertrek : '';
    const [finder, trips, newCount] = await Promise.all([
      finderOptions(),
      content.upcomingTrips({ destination: selected.bestemming, type: selected.type, departure, newFirst }),
      content.newTripCount(),
    ]);
    const archive = siteContent.load().archives.reis;
    send(res, {
      title: 'Reizen',
      path: '/reis/',
      seo: seoFor('/reis/', { imageUrl: archive.image }),
      header: html`${renderPageHeader({ title: archive.title, pretitle: archive.pretitle, imageUrl: archive.image })}
        ${homeViews.renderFilterBar(finder, newCount, { ...selected, nieuw: newFirst })}`,
      body: html`<div class="content-main">
        <div class="layout-container">
          <p class="visually-hidden" role="status">${trips.length} ${trips.length === 1 ? 'reis' : 'reizen'} gevonden</p>
          ${tripViews.tripList(trips, 'Geen reizen gevonden op basis van het filter.')}
        </div>
      </div>`,
    });
  }));

  router.get('/reis/:slug/', asyncRoute(async (req, res, next) => {
    const slug = safeSlug(req.params.slug);
    const trip = slug && await content.tripBySlug(slug);
    if (!trip) return next();
    const isPast = isoDate(trip.departure_date) < today();
    const destinations = trip.categories.filter((category) => category.kind === 'bestemming').map((category) => category.name);
    return send(res, {
      title: trip.title,
      description: trip.tagline || trip.summary,
      path: '/reis/',
      seo: seoFor(tripPath(trip.slug), {
        imageUrl: trip.hero_image_url || trip.card_image_url,
        structuredData: [
          (site) => seo.tripData(site.siteUrl, trip, { today: today(), siteName: site.siteName }),
          breadcrumbs([{ name: 'Reizen', path: '/reis/' }, { name: trip.title, path: tripPath(trip.slug) }]),
        ],
      }),
      header: renderPageHeader({ title: trip.title, destinations, imageUrl: trip.hero_image_url, backLink: '/reis/' }),
      body: tripViews.tripDetail(trip, { isPast }),
    });
  }));

  router.get('/reis-categorie/:slug/', asyncRoute(async (req, res, next) => {
    const slug = safeSlug(req.params.slug);
    const category = slug && await content.categoryBySlug(slug);
    if (!category) return next();
    const trips = await content.upcomingTrips(category.kind === 'type' ? { type: category.slug } : { destination: category.slug });
    return send(res, {
      title: category.name,
      description: category.intro,
      path: '/reis/',
      seo: seoFor(categoryPath(category.slug), {
        imageUrl: category.image_url,
        structuredData: [breadcrumbs([{ name: 'Reizen', path: '/reis/' }, { name: category.name, path: categoryPath(category.slug) }])],
      }),
      header: renderPageHeader({ title: category.name, imageUrl: category.image_url }),
      body: html`<div class="content-main">
        <div class="layout-container">
          ${tripViews.pageIntroduction(category.intro)}
          ${category.body_html ? html`<div class="page-content"><div class="page-content__text">${raw(category.body_html)}</div></div>` : ''}
          ${tripViews.tripList(trips, 'Op dit moment geen reizen in deze categorie.')}
        </div>
      </div>`,
    });
  }));

  router.get('/reisleider/', asyncRoute(async (req, res) => {
    const extra = siteContent.load();
    const archive = extra.archives.reisleider;
    const guides = sortGuides(await content.guides(), extra.guideOrder).map((guide) => ({ ...guide, extra: extra.guides.get(guide.slug) || EMPTY_GUIDE }));
    send(res, {
      title: 'Reisleiders',
      path: '/reisleider/',
      seo: seoFor('/reisleider/', { imageUrl: archive.image }),
      header: renderPageHeader({ title: archive.title, pretitle: archive.pretitle, imageUrl: archive.image }),
      body: tripViews.guideList(guides, archive.introduction),
    });
  }));

  router.get('/reisleider/:reference/', asyncRoute(async (req, res, next) => {
    const reference = safeSlug(req.params.reference);
    const guide = reference && await content.guideByReference(reference);
    if (!guide) return next();
    if (/^\d+$/.test(reference) && guide.slug !== reference) return res.redirect(301, `/reisleider/${encodeURIComponent(guide.slug)}/`);
    return send(res, {
      title: guide.name,
      description: guide.intro,
      path: '/reisleider/',
      seo: seoFor(guidePath(guide.slug), { imageUrl: guide.photo_url }),
      header: renderPageHeader({ bare: true, backLink: '/reisleider/' }),
      body: html`${tripViews.guideDetail({ ...guide, extra: siteContent.load().guides.get(guide.slug) || EMPTY_GUIDE })}
      ${guide.trips.length ? html`<section class="section guide-trips"><div class="layout-container">
        <h2 class="section__title">Reizen met ${guide.name}</h2>
        ${tripViews.tripList(guide.trips, '')}
      </div></section>` : ''}`,
    });
  }));

  /**
   * Staat video's toe op deze pagina: alleen youtube-nocookie.com in een iframe.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const allowVideos = (res) => {
    res.set('Content-Security-Policy', addCspSources(res.get('Content-Security-Policy'), { 'frame-src': [YOUTUBE_ORIGIN] }));
  };

  router.get('/blog/', asyncRoute(async (req, res) => {
    const archive = siteContent.load().archives.blog;
    const { posts } = await content.posts({ perPage: 500 });
    const { blogTags, blogArchiveLink, featuredPost } = siteContent.load();
    send(res, {
      title: archive.title,
      description: archive.introduction,
      path: '/blog/',
      seo: seoFor('/blog/', { imageUrl: archive.image }),
      header: renderPageHeader({ title: archive.title, pretitle: archive.pretitle, imageUrl: archive.image }),
      body: html`<div class="content-main">${pageViews.blogArchive({ posts, introduction: archive.introduction, tags: blogTags, archiveLink: blogArchiveLink, featured: featuredPost })}</div>`,
    });
  }));

  // Tags van het weblog (uit `site-content.json`); een onbekende tag gaat naar het overzicht, zoals voorheen.
  router.get('/tag/:slug/', asyncRoute(async (req, res) => {
    const slug = safeSlug(req.params.slug);
    const tag = slug ? siteContent.load().blogTags.find((item) => item.slug === slug) : null;
    if (!tag) return res.redirect(301, '/blog/');
    const posts = await content.postsBySlugs(tag.posts);
    const tagPath = `/tag/${tag.slug}/`;
    return send(res, {
      title: tag.name,
      path: '/blog/',
      seo: seoFor(tagPath, { imageUrl: tag.image, structuredData: [breadcrumbs([{ name: 'Weblog', path: '/blog/' }, { name: tag.name, path: tagPath }])] }),
      header: renderPageHeader({ title: tag.name, imageUrl: tag.image, backLink: '/blog/' }),
      body: html`<div class="content-main">${pageViews.tagArchive(posts)}</div>`,
    });
  }));

  router.get('/faq/', asyncRoute(async (req, res) => {
    const archive = siteContent.load().archives.faq;
    const faqs = await content.faqs();
    send(res, {
      title: archive.title,
      path: '/faq/',
      seo: seoFor('/faq/', { imageUrl: archive.image }),
      header: renderPageHeader({ title: archive.title, pretitle: archive.pretitle, imageUrl: archive.image }),
      body: html`<div class="content-main">${pageViews.faqList(faqs)}</div>`,
    });
  }));

  // Oude FAQ-adressen: losse vragen en categorieën staan nu op één pagina.
  router.get(['/faq/:slug/', '/faq-categorie/:slug/'], (req, res) => {
    const anchor = req.path.startsWith('/faq-categorie/') ? `#${encodeURIComponent(req.params.slug)}` : '';
    res.redirect(301, `/faq/${anchor}`);
  });
  router.get('/category/:slug/', (req, res) => res.redirect(301, '/blog/'));

  router.get('/zoeken/', asyncRoute(async (req, res) => {
    const term = typeof req.query.s === 'string' ? req.query.s.trim().slice(0, 80) : '';
    const results = term.length >= 2 ? await content.search(term) : { trips: [], posts: [], pages: [] };
    const count = results.trips.length + results.posts.length + results.pages.length;
    send(res, {
      title: 'Zoeken',
      path: '/zoeken/',
      seo: seoFor('/zoeken/'),
      header: renderPageHeader({ title: term ? `Zoekresultaten voor "${term}"` : 'Zoeken' }),
      body: html`<div class="content-main"><div class="layout-container search-results">
        <form class="search-form form--theme" action="/zoeken/" method="get" role="search">
          <label class="visually-hidden" for="zoekterm">Zoekterm</label>
          <input id="zoekterm" type="search" name="s" value="${term}" placeholder="Waar ben je naar op zoek?" maxlength="80" required>
          <button class="btn" type="submit">Zoeken</button>
        </form>
        ${term ? html`<p class="result-count">${count} resultaten</p>` : ''}
        ${results.trips.length ? html`<h2>Reizen</h2>${tripViews.tripList(results.trips, '')}` : ''}
        ${results.posts.length ? html`<h2>Weblog</h2>${pageViews.postList(results.posts)}` : ''}
        ${results.pages.length ? html`<h2>Pagina's</h2><ul class="link-list">${results.pages.map((page) => html`<li><a href="${page.path}">${page.title}</a>${page.intro ? html` — ${page.intro}` : ''}</li>`)}</ul>` : ''}
      </div></div>`,
    });
  }));

  if (options.contactForm) {
    const contactForm = options.contactForm;

    /**
     * Stuurt de contactpagina: de geïmporteerde inhoud (als die er is), daaronder het adres, de verwijzing naar de
     * FAQ en het formulier (of de bedanktmelding), zoals de huidige site.
     * @param {object} res Express-antwoord.
     * @param {object} formHtml Formulier of melding.
     * @param {number} [status] HTTP-status.
     * @returns {Promise<void>}
     */
    const sendContactPage = async (res, formHtml, status = 200) => {
      const page = await content.pageByPath('/contact/');
      res.set('Cache-Control', 'no-store');
      send(res, {
        title: page ? page.title : 'Contact',
        description: page ? page.intro : '',
        path: '/contact/',
        seo: seoFor('/contact/', { imageUrl: page ? page.image_url : '' }),
        header: renderPageHeader({ title: page ? page.title : 'Contact', pretitle: page ? page.pretitle : '', imageUrl: page ? page.image_url : '' }),
        body: html`<div class="content-main">${page ? pageViews.articleBody(page).body : ''}${pageViews.contactLayout(res.locals.site, formHtml)}</div>`,
      }, status);
    };

    router.get('/contact/', asyncRoute(async (req, res) => {
      if (req.query.verzonden === '1') return sendContactPage(res, contactForm.renderThanks());
      return sendContactPage(res, contactForm.renderForm({ trip: await contactForm.findTrip(req.query.reis) }));
    }));

    router.post('/contact/', ...contactForm.middleware, asyncRoute(async (req, res) => {
      const result = await contactForm.submit(req.body || {}, { ip: req.ip });
      if (result.redirect) return res.redirect(303, result.redirect);
      return sendContactPage(res, contactForm.renderForm(result), result.status || 422);
    }));
  }

  // Overige adressen: eerst een pagina op het volledige pad, dan een blogbericht op de slug.
  router.get(/^\/(.+)\/$/, asyncRoute(async (req, res, next) => {
    let path;
    try {
      path = decodeURI(req.path);
    } catch (_) {
      return next();
    }
    if (path.length > 300) return next();
    const page = await content.pageByPath(path);
    if (page) {
      const article = pageViews.articleBody(page, siteContent.load().galleries.get(page.path));
      if (article.hasVideo) allowVideos(res);
      return send(res, {
        title: page.title,
        description: page.intro,
        path,
        seo: seoFor(seo.encodePagePath(page.path), { imageUrl: page.image_url }),
        header: renderPageHeader({ title: page.title, pretitle: page.pretitle, imageUrl: page.image_url }),
        body: html`<div class="content-main">${article.body}</div>`,
      });
    }
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 1) return next();
    const post = await content.postBySlug(segments[0]);
    if (!post) return next();
    const article = pageViews.articleBody(post, siteContent.load().galleries.get(`/${post.slug}/`));
    if (article.hasVideo) allowVideos(res);
    const published = post.published_at ? new Date(post.published_at) : null;
    return send(res, {
      title: post.title,
      description: post.excerpt,
      path: '/blog/',
      seo: seoFor(postPath(post.slug), {
        imageUrl: post.image_url,
        type: 'article',
        structuredData: [
          (site) => seo.blogPostingData(site.siteUrl, post, site.siteName),
          breadcrumbs([{ name: 'Weblog', path: '/blog/' }, { name: post.title, path: postPath(post.slug) }]),
        ],
      }),
      header: renderPageHeader({ title: post.title, date: published, imageUrl: post.image_url, backLink: '/blog/', single: true }),
      body: html`<article class="content-main">${article.body}</article>`,
    });
  }));

  return router;
}

module.exports = { createSiteRouter, safeSlug, toDate };
