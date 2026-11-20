/**
 * Routes van de publieke website. De URL's zijn gelijk aan die van de huidige WordPress-site, zodat links en
 * zoekmachineposities bij de overstap blijven werken.
 */
const express = require('express');
const { html, raw } = require('./html');
const { renderPage, renderPageHeader, CONTACT } = require('./layout');
const { createContent, today } = require('./content');
const views = require('./views');
const { formatLongDate, isoDate, toDate, tripPath, categoryPath, guidePath, postPath } = require('./format');
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
 * @param {{db: object, indexable?: boolean, siteUrl?: string, contactForm?: object}} options Database, indexeerinstelling,
 *   basisadres (standaard `SITE_URL` uit de omgeving, anders https://www.avantareizen.nl) en het contactformulier
 *   (`contact/routes.js`; zonder formulier is `/contact/` een gewone pagina).
 * @returns {express.Router} De router.
 */
function createSiteRouter(options) {
  const router = express.Router({ strict: true });
  const content = createContent(options.db);
  const indexable = Boolean(options.indexable);
  const siteUrl = seo.normalizeSiteUrl(options.siteUrl ?? process.env.SITE_URL);
  let sitemapCache = null;

  /**
   * Gegevens voor de SEO-tags van een pagina, met absolute URL's.
   * @param {string} canonicalPath Echte pad van de pagina (niet het menupad), eventueel met querystring.
   * @param {{imageUrl?: string, type?: string, structuredData?: object[]}} [extra] Afbeelding, og:type en JSON-LD.
   * @returns {object} Gegevens voor `renderSeoHead`.
   */
  const seoFor = (canonicalPath, extra = {}) => ({
    canonicalUrl: seo.absoluteUrl(siteUrl, canonicalPath),
    imageUrl: seo.absoluteUrl(siteUrl, extra.imageUrl || '/images/logo.png'),
    type: extra.type || 'website',
    structuredData: extra.structuredData || [],
  });

  /**
   * Kruimelpad als JSON-LD, altijd beginnend bij de homepage.
   * @param {Array<{name: string, path: string}>} items Stappen na de homepage.
   * @returns {object} `BreadcrumbList`.
   */
  const breadcrumbs = (items) => seo.breadcrumbData(siteUrl, [{ name: 'Home', path: '/' }, ...items]);

  /**
   * Stuurt een volledige pagina.
   * @param {object} res Express-antwoord.
   * @param {object} page Gegevens voor renderPage.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const send = (res, page, status = 200) => {
    res.status(status).type('html').send(renderPage({ indexable, contact: res.locals.contact, ...page }));
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
    const limit = new Date(`${today()}T12:00:00`);
    limit.setDate(limit.getDate() + 75);
    const [finder, lastMinutes, upcoming, types, blog, about] = await Promise.all([
      finderOptions(),
      content.upcomingTrips({ before: isoDate(limit), onlyAvailable: true, limit: 6 }),
      content.upcomingTrips({ limit: 12 }),
      content.categories('type'),
      content.posts({ perPage: 4 }),
      content.pageByPath('/avanta-reizen/onzemaniervanreizen/'),
    ]);
    const newTrips = upcoming.filter((trip) => trip.is_new).slice(0, 6);
    const heroImage = upcoming.find((trip) => trip.card_image_url)?.card_image_url;
    send(res, {
      path: '/',
      seo: seoFor('/', { imageUrl: heroImage, structuredData: [seo.travelAgencyData(siteUrl, res.locals.contact || CONTACT)] }),
      bodyClass: 'home',
      header: html`<section class="hero"${heroImage ? html` style="--header-image: url('${heroImage}')"` : ''}>
        <div class="container hero__inner">
          <p class="hero__pretitle">your adventure starts here</p>
          <h1 class="hero__title">Avontuurlijke groepsreizen over heel de wereld</h1>
          ${views.tripFinder(finder)}
        </div>
      </section>`,
      body: html`
        <section class="section">
          <div class="container">
            <h2 class="section__title">Inpakken en wegwezen!</h2>
            <p class="section__subtitle">voor plotselinge reiskriebels</p>
            ${views.tripGrid(lastMinutes, 'Op dit moment geen last-minutes.')}
            <p class="section__footer"><a class="btn btn--outline" href="/reis/">Bekijk alle reizen</a></p>
          </div>
        </section>
        <section class="section section--soil">
          <div class="container">
            <h2 class="section__title">Met Avanta reis je zoals reizen bedoeld is</h2>
            <p class="section__subtitle">voor verschillende leeftijden</p>
            <ul class="type-grid">${types.map((type) => html`<li><a class="type-tile" href="/reis-categorie/${encodeURIComponent(type.slug)}/"><span>${type.name}</span><small>${type.trip_count} ${type.trip_count === 1 ? 'reis' : 'reizen'}</small></a></li>`)}</ul>
          </div>
        </section>
        ${newTrips.length ? html`<section class="section">
          <div class="container">
            <h2 class="section__title">Nieuwe reizen</h2>
            <p class="section__subtitle">laat je inspireren</p>
            ${views.tripGrid(newTrips)}
          </div>
        </section>` : ''}
        <section class="section section--soft">
          <div class="container">
            <h2 class="section__title">Weblog</h2>
            <p class="section__subtitle">verhalen van onderweg</p>
            <div class="card-grid card-grid--four">${blog.posts.map(views.postCard)}</div>
            <p class="section__footer"><a class="btn btn--outline" href="/blog/">Naar het weblog</a></p>
          </div>
        </section>
        ${about ? html`<section class="section section--about">
          <div class="container container--narrow">
            <h2 class="section__title">De Avanta way of life</h2>
            <p class="lead">${about.intro}</p>
            <p><a class="btn" href="${about.path}">Onze manier van reizen</a></p>
          </div>
        </section>` : ''}`,
    });
  }));

  // Sitemap met alle openbare adressen; robots.txt verwijst er alleen naar als de site geïndexeerd mag worden.
  router.get('/sitemap.xml', asyncRoute(async (req, res) => {
    if (!sitemapCache || Date.now() - sitemapCache.builtAt > SITEMAP_CACHE_MS) {
      const entries = await content.sitemapEntries();
      sitemapCache = { builtAt: Date.now(), xml: seo.renderSitemap(siteUrl, seo.sitemapUrls(entries)) };
    }
    res.set('Cache-Control', 'public, max-age=600').type('application/xml').send(sitemapCache.xml);
  }));

  router.get('/reis/', asyncRoute(async (req, res) => {
    const selected = { bestemming: queryValue(req.query.bestemming), type: queryValue(req.query.type), vertrek: queryValue(req.query.vertrek) };
    const departure = /^\d{4}-\d{2}-\d{2}$/.test(selected.vertrek) ? selected.vertrek : '';
    const [finder, trips] = await Promise.all([
      finderOptions(),
      content.upcomingTrips({ destination: selected.bestemming, type: selected.type, departure }),
    ]);
    send(res, {
      title: 'Reizen',
      path: '/reis/',
      seo: seoFor('/reis/'),
      header: renderPageHeader({ title: 'Ons reisaanbod', subtitle: 'start exploring' }),
      body: html`<div class="container section">
        ${views.tripFinder({ ...finder, selected, compact: true })}
        <p class="result-count">${trips.length} ${trips.length === 1 ? 'reis' : 'reizen'} gevonden</p>
        ${views.tripGrid(trips, 'Geen reizen gevonden op basis van het filter.')}
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
          seo.tripData(siteUrl, trip, { today: today() }),
          breadcrumbs([{ name: 'Reizen', path: '/reis/' }, { name: trip.title, path: tripPath(trip.slug) }]),
        ],
      }),
      header: renderPageHeader({ title: trip.title, pretitle: destinations.join(' · '), imageUrl: trip.hero_image_url, backLink: '/reis/' }),
      body: views.tripDetail(trip, { isPast }),
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
      header: renderPageHeader({ title: category.name, subtitle: category.intro, imageUrl: category.image_url, backLink: '/reis/' }),
      body: html`<div class="container section">
        ${category.body_html ? html`<div class="prose prose--intro">${raw(category.body_html)}</div>` : ''}
        ${views.tripGrid(trips, 'Op dit moment geen reizen in deze categorie.')}
      </div>`,
    });
  }));

  router.get('/reisleider/', asyncRoute(async (req, res) => {
    const guides = await content.guides();
    send(res, {
      title: 'Reisleiders',
      path: '/reisleider/',
      seo: seoFor('/reisleider/'),
      header: renderPageHeader({ title: 'Onze reisleiders' }),
      body: html`<div class="container section"><div class="card-grid card-grid--guides">${guides.map(views.guideCard)}</div></div>`,
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
      header: renderPageHeader({ title: guide.name, subtitle: guide.intro, backLink: '/reisleider/' }),
      body: html`<div class="container section guide">
        ${guide.photo_url ? html`<img class="guide__photo" src="${guide.photo_url}" alt="${guide.name}">` : ''}
        <div class="prose">${raw(guide.body_html)}</div>
      </div>
      ${guide.trips.length ? html`<section class="section section--soft"><div class="container">
        <h2 class="section__title">Reizen met ${guide.name}</h2>${views.tripGrid(guide.trips)}
      </div></section>` : ''}`,
    });
  }));

  router.get('/blog/', asyncRoute(async (req, res) => {
    const page = Math.max(1, Math.min(500, Number.parseInt(req.query.pagina, 10) || 1));
    const perPage = 12;
    const { posts, total } = await content.posts({ page, perPage });
    send(res, {
      title: 'Weblog',
      path: '/blog/',
      seo: seoFor(page > 1 ? `/blog/?pagina=${page}` : '/blog/'),
      header: renderPageHeader({ title: 'Weblog', subtitle: 'verhalen van onderweg' }),
      body: html`<div class="container section">
        <div class="card-grid">${posts.map(views.postCard)}</div>
        ${views.pagination({ page, pages: Math.ceil(total / perPage), basePath: '/blog/' })}
      </div>`,
    });
  }));

  router.get('/faq/', asyncRoute(async (req, res) => {
    const faqs = await content.faqs();
    const groups = new Map();
    for (const faq of faqs) groups.set(faq.category, [...(groups.get(faq.category) || []), faq]);
    send(res, {
      title: 'Veelgestelde vragen',
      path: '/faq/',
      seo: seoFor('/faq/'),
      header: renderPageHeader({ title: 'Veelgestelde vragen' }),
      body: html`<div class="container container--narrow section">
        ${[...groups.entries()].map(([category, items]) => html`<section class="faq-group" id="${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">
          <h2>${category}</h2>
          ${items.map((faq) => html`<details class="faq"><summary>${faq.question}</summary><div class="prose">${raw(faq.answer_html)}</div></details>`)}
        </section>`)}
      </div>`,
    });
  }));

  // Oude FAQ-adressen: losse vragen en categorieën staan nu op één pagina.
  router.get(['/faq/:slug/', '/faq-categorie/:slug/'], (req, res) => {
    const anchor = req.path.startsWith('/faq-categorie/') ? `#${encodeURIComponent(req.params.slug)}` : '';
    res.redirect(301, `/faq/${anchor}`);
  });
  router.get(['/category/:slug/', '/tag/:slug/'], (req, res) => res.redirect(301, '/blog/'));

  router.get('/zoeken/', asyncRoute(async (req, res) => {
    const term = typeof req.query.s === 'string' ? req.query.s.trim().slice(0, 80) : '';
    const results = term.length >= 2 ? await content.search(term) : { trips: [], posts: [], pages: [] };
    const count = results.trips.length + results.posts.length + results.pages.length;
    send(res, {
      title: 'Zoeken',
      path: '/zoeken/',
      seo: seoFor('/zoeken/'),
      header: renderPageHeader({ title: term ? `Zoekresultaten voor "${term}"` : 'Zoeken' }),
      body: html`<div class="container section">
        <form class="search-form" action="/zoeken/" method="get" role="search">
          <label class="visually-hidden" for="zoekterm">Zoekterm</label>
          <input id="zoekterm" type="search" name="s" value="${term}" placeholder="Waar ben je naar op zoek?" maxlength="80" required>
          <button class="btn" type="submit">Zoeken</button>
        </form>
        ${term ? html`<p class="result-count">${count} resultaten</p>` : ''}
        ${results.trips.length ? html`<h2>Reizen</h2>${views.tripGrid(results.trips)}` : ''}
        ${results.posts.length ? html`<h2>Weblog</h2><div class="card-grid">${results.posts.map(views.postCard)}</div>` : ''}
        ${results.pages.length ? html`<h2>Pagina's</h2><ul class="link-list">${results.pages.map((page) => html`<li><a href="${page.path}">${page.title}</a>${page.intro ? html` — ${page.intro}` : ''}</li>`)}</ul>` : ''}
      </div>`,
    });
  }));

  if (options.contactForm) {
    const contactForm = options.contactForm;

    /**
     * Stuurt de contactpagina: de geïmporteerde inhoud met daaronder het formulier (of de bedanktmelding).
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
        body: html`${page ? html`<div class="container container--narrow section">
          ${page.intro ? html`<p class="lead">${page.intro}</p>` : ''}
          <div class="prose">${raw(page.body_html)}</div>
        </div>` : ''}${formHtml}`,
      }, status);
    };

    router.get('/contact/', asyncRoute(async (req, res) => {
      if (req.query.verzonden === '1') return sendContactPage(res, contactForm.renderThanks());
      return sendContactPage(res, contactForm.renderForm({ trip: await contactForm.findTrip(req.query.reis) }));
    }));

    router.post('/contact/', ...contactForm.middleware, asyncRoute(async (req, res) => {
      const result = await contactForm.submit(req.body || {});
      if (result.redirect) return res.redirect(303, result.redirect);
      return sendContactPage(res, contactForm.renderForm(result), 422);
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
      return send(res, {
        title: page.title,
        description: page.intro,
        path,
        seo: seoFor(seo.encodePagePath(page.path), { imageUrl: page.image_url }),
        header: renderPageHeader({ title: page.title, pretitle: page.pretitle, imageUrl: page.image_url }),
        body: html`<div class="container container--narrow section">
          ${page.intro ? html`<p class="lead">${page.intro}</p>` : ''}
          <div class="prose">${raw(page.body_html)}</div>
        </div>`,
      });
    }
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 1) return next();
    const post = await content.postBySlug(segments[0]);
    if (!post) return next();
    return send(res, {
      title: post.title,
      description: post.excerpt,
      path: '/blog/',
      seo: seoFor(postPath(post.slug), {
        imageUrl: post.image_url,
        type: 'article',
        structuredData: [
          seo.blogPostingData(siteUrl, post),
          breadcrumbs([{ name: 'Weblog', path: '/blog/' }, { name: post.title, path: postPath(post.slug) }]),
        ],
      }),
      header: renderPageHeader({ title: post.title, pretitle: post.published_at ? formatLongDate(new Date(post.published_at)) : '', imageUrl: post.image_url, backLink: '/blog/' }),
      body: html`<article class="container container--narrow section">
        ${post.intro ? html`<p class="lead">${post.intro}</p>` : ''}
        <div class="prose">${raw(post.body_html)}</div>
      </article>`,
    });
  }));

  return router;
}

module.exports = { createSiteRouter, safeSlug, toDate };
