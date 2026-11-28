/**
 * Bezoekersstatistieken met Google Analytics (GA4) en Microsoft Clarity, alleen na toestemming van de bezoeker. De
 * server zet het meet-ID als `data-analytics` en het Clarity-project als `data-clarity` op <body> (alleen als ze in
 * Beheer actief zijn, en Clarity niet op Mijn Avanta, het aanmeldformulier en online betalen). Zonder toestemming
 * wordt er niets van Google of Microsoft geladen: geen script, geen cookie, geen verbinding.
 *
 * Google: Consent Mode v2 staat standaard op "geweigerd"; bij Accepteren gaat alleen `analytics_storage` op
 * "toegestaan", advertentie-opslag nooit. Weigeren of intrekken zet `ga-disable-<id>` en wist de `_ga`-cookies.
 * Clarity: pas na Accepteren geladen, met toestemming alleen voor statistieken (advertentie-opslag geweigerd); elk
 * formulier krijgt vooraf `data-clarity-mask`, zodat wat iemand invult nooit in een opname komt. Weigeren of
 * intrekken wist de `_clck`/`_clsk`-cookies; liep Clarity al op de pagina, dan laadt de pagina opnieuw zonder Clarity.
 *
 * De keuze staat met versie, datum en de diensten waarvoor ze geldt in localStorage en is altijd te wijzigen via
 * "Cookie-instellingen" in de voettekst. Komt er een dienst bij waarvoor nog geen toestemming is gegeven, dan vraagt de
 * balk het opnieuw; een weigering blijft gelden.
 */
(function analyticsModule(root) {
  'use strict';

  /** Sleutel in localStorage voor de keuze van de bezoeker. */
  var CONSENT_KEY = 'avanta_cookie_consent';
  /** Versie van de toestemmingstekst; een andere versie in de opslag telt als geen keuze. */
  var CONSENT_VERSION = 1;
  /** Een GA4-meet-ID (de server controleert dit ook). */
  var MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,14}$/;
  /** Een Clarity-project-ID (de server controleert dit ook). */
  var CLARITY_ID_PATTERN = /^[a-z0-9]{6,20}$/;
  /** Namen van de diensten zoals de bezoeker ze in de balk leest. */
  var TOOL_NAMES = { ga: 'Google Analytics', clarity: 'Microsoft Clarity' };

  /**
   * Geeft de opslag van de browser terug, of null als die niet beschikbaar is (privévenster, geblokkeerd).
   * @param {Window} win Het venster.
   * @returns {?Storage} localStorage, of null.
   */
  function safeStorage(win) {
    try {
      var storage = win.localStorage;
      storage.getItem(CONSENT_KEY);
      return storage;
    } catch (error) {
      return null;
    }
  }

  /**
   * Leest de eerder gemaakte keuze. Een toestemming geldt alleen voor de diensten die toen in de balk stonden; een
   * keuze van vóór Clarity (zonder lijst) geldt alleen voor Google Analytics.
   * @param {?Storage} storage De opslag van de browser.
   * @param {string[]} [tools] De diensten op deze pagina ("ga", "clarity"); standaard alleen "ga".
   * @returns {?string} "granted", "denied", of null als de bezoeker nog niet koos, de versie niet meer klopt of de
   *   toestemming niet alle diensten dekt.
   */
  function readConsent(storage, tools) {
    try {
      var parsed = JSON.parse((storage && storage.getItem(CONSENT_KEY)) || 'null');
      if (!parsed || parsed.v !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') return null;
      if (!parsed.analytics) return 'denied';
      var covered = Array.isArray(parsed.tools) ? parsed.tools : ['ga'];
      var allCovered = (tools || ['ga']).every(function isCovered(tool) { return covered.indexOf(tool) !== -1; });
      return allCovered ? 'granted' : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Bewaart de keuze met versie, datum en de diensten waarvoor ze geldt; lukt dat niet, dan geldt hij alleen voor deze
   * pagina.
   * @param {?Storage} storage De opslag van de browser.
   * @param {string} decision "granted" of "denied".
   * @param {string[]} tools De diensten die in de balk stonden.
   * @returns {void}
   */
  function writeConsent(storage, decision, tools) {
    try {
      if (storage) storage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, analytics: decision === 'granted', tools: tools, at: new Date().toISOString() }));
    } catch (error) {
      // Niet bewaren kan; de vraag komt dan op de volgende pagina terug.
    }
  }

  /**
   * Wist cookies van deze site op het hoofdpad en de bovenliggende domeinen.
   * @param {Window} win Het venster.
   * @param {Document} doc Het document.
   * @param {Function} matches Bepaalt per cookienaam of hij weg moet.
   * @returns {void}
   */
  function clearCookies(win, doc, matches) {
    var names = String(doc.cookie || '').split(';').map(function nameOf(part) { return part.split('=')[0].trim(); })
      .filter(function shouldClear(name) { return name && matches(name); });
    var host = (win.location && win.location.hostname) || '';
    var parts = host.split('.');
    var domains = [''];
    for (var i = 0; i < parts.length - 1; i += 1) domains.push('.' + parts.slice(i).join('.'));
    names.forEach(function clear(name) {
      domains.forEach(function clearOn(domain) {
        doc.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  /**
   * Wist de cookies van Google Analytics (`_ga` en `_ga_*`).
   * @param {Window} win Het venster.
   * @param {Document} doc Het document.
   * @returns {void}
   */
  function clearAnalyticsCookies(win, doc) {
    clearCookies(win, doc, function isAnalytics(name) { return name === '_ga' || name.indexOf('_ga_') === 0; });
  }

  /**
   * Wist de cookies van Clarity op deze site (`_clck` voor de bezoeker, `_clsk` voor de sessie).
   * @param {Window} win Het venster.
   * @param {Document} doc Het document.
   * @returns {void}
   */
  function clearClarityCookies(win, doc) {
    clearCookies(win, doc, function isClarity(name) { return name === '_clck' || name === '_clsk'; });
  }

  /**
   * De meting met Google Analytics: houdt de toestemming bij en laadt Google pas na Accepteren.
   * @param {{window: Window, document: Document, measurementId: string}} environment Browseromgeving en meet-ID.
   * @returns {{grant: Function, deny: Function, isLoaded: Function}} De bediening.
   */
  function createGoogleTracker(environment) {
    var win = environment.window;
    var doc = environment.document;
    var measurementId = environment.measurementId;
    var loaded = false;
    win.dataLayer = win.dataLayer || [];
    /**
     * Zet een aanroep in de dataLayer, zoals Google het verwacht (het object arguments, geen lijst).
     * @returns {void}
     */
    function gtag() { win.dataLayer.push(arguments); }
    // Alles geweigerd tot de bezoeker kiest. Dit zet alleen een regel in de dataLayer; er wordt niets geladen.
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 });

    /**
     * Laadt het Google-script (één keer) en stelt de meting in zonder advertentiefuncties.
     * @returns {void}
     */
    function load() {
      if (loaded) return;
      loaded = true;
      var script = doc.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
      doc.head.appendChild(script);
      gtag('js', new Date());
      gtag('config', measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
    }

    return {
      /**
       * De bezoeker staat statistieken toe: alleen analytics_storage aan en Google laden.
       * @returns {void}
       */
      grant: function grant() {
        win['ga-disable-' + measurementId] = false;
        gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
        load();
      },
      /**
       * De bezoeker weigert of trekt in: niets meer sturen en de cookies van Google weghalen.
       * @returns {void}
       */
      deny: function deny() {
        win['ga-disable-' + measurementId] = true;
        gtag('consent', 'update', { analytics_storage: 'denied' });
        clearAnalyticsCookies(win, doc);
      },
      /**
       * Of het Google-script is gevraagd (alleen na toestemming).
       * @returns {boolean} Waar als het script is gevraagd.
       */
      isLoaded: function isLoaded() { return loaded; },
    };
  }

  /**
   * Maskeert elk formulier op de pagina voor Clarity: velden, keuzes en wat erin staat komen nooit in een opname, ook
   * niet als de maskering in het Clarity-project losser is ingesteld.
   * @param {Document} doc Het document.
   * @returns {void}
   */
  function maskForms(doc) {
    if (!doc.querySelectorAll) return;
    Array.prototype.forEach.call(doc.querySelectorAll('form'), function mask(form) { form.setAttribute('data-clarity-mask', 'true'); });
  }

  /**
   * De opname met Microsoft Clarity: laadt Clarity pas na Accepteren, met toestemming alleen voor statistieken.
   * @param {{window: Window, document: Document, projectId: string, reload: Function}} environment Browseromgeving,
   *   project-ID en hoe de pagina opnieuw laadt (na intrekken terwijl Clarity al liep).
   * @returns {{grant: Function, deny: Function, isLoaded: Function}} De bediening.
   */
  function createClarityTracker(environment) {
    var win = environment.window;
    var doc = environment.document;
    var loaded = false;

    /**
     * Zet een opdracht voor Clarity klaar; het script verwerkt de rij zodra het geladen is (zoals de officiële code).
     * @returns {void}
     */
    function clarity() {
      if (!win.clarity) {
        win.clarity = function queueCommand() { (win.clarity.q = win.clarity.q || []).push(arguments); };
      }
      win.clarity.apply(null, arguments);
    }

    return {
      /**
       * De bezoeker staat statistieken toe: formulieren maskeren, toestemming doorgeven en Clarity laden (één keer).
       * @returns {void}
       */
      grant: function grant() {
        if (loaded) return;
        loaded = true;
        maskForms(doc);
        clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
        var script = doc.createElement('script');
        script.async = true;
        script.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(environment.projectId);
        doc.head.appendChild(script);
      },
      /**
       * De bezoeker weigert of trekt in: cookies van Clarity weg. Liep Clarity al, dan eerst de toestemming intrekken
       * en de pagina opnieuw laden, want zonder toestemming neemt Clarity anders zonder cookies verder op.
       * @returns {void}
       */
      deny: function deny() {
        if (loaded) clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
        clearClarityCookies(win, doc);
        if (loaded) environment.reload();
      },
      /**
       * Of het Clarity-script is gevraagd (alleen na toestemming).
       * @returns {boolean} Waar als het script is gevraagd.
       */
      isLoaded: function isLoaded() { return loaded; },
    };
  }

  /**
   * Maakt een element met een klasse en tekst.
   * @param {Document} doc Het document.
   * @param {string} tag Tagnaam.
   * @param {string} className Klasse (leeg = geen).
   * @param {string} text Tekst (leeg = geen).
   * @returns {Element} Het element.
   */
  function makeElement(doc, tag, className, text) {
    var element = doc.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  /**
   * De uitleg in de cookiebalk, met de diensten die op deze pagina meedoen.
   * @param {string[]} tools De diensten ("ga", "clarity").
   * @returns {string} De tekst, met een spatie aan het eind voor de link naar de privacyverklaring.
   */
  function bannerText(tools) {
    var names = tools.map(function nameOf(tool) { return TOOL_NAMES[tool]; }).join(' en ');
    var text = 'We gebruiken alleen noodzakelijke cookies. Met jouw toestemming meten we ook met ' + names + ' hoe de site wordt gebruikt, zonder advertenties. ';
    if (tools.indexOf('clarity') !== -1) text += 'Microsoft Clarity legt daarvoor vast waar je klikt en scrolt; wat je in formulieren invult, wordt nooit vastgelegd. ';
    return text;
  }

  /**
   * Toont de cookiebalk met de huidige keuze; een keuze sluit de balk.
   * @param {Document} doc Het document.
   * @param {{privacyUrl: string, tools: string[], current: ?string, onChoice: Function}} options Privacyverklaring, de
   *   diensten op deze pagina, huidige keuze en wat er bij een keuze gebeurt.
   * @returns {void}
   */
  function showBanner(doc, options) {
    var existing = doc.querySelector('[data-consent-banner]');
    if (existing) existing.remove();
    var banner = makeElement(doc, 'section', 'consent-banner', '');
    banner.setAttribute('data-consent-banner', '');
    banner.setAttribute('aria-label', 'Cookies');
    var text = makeElement(doc, 'div', 'consent-banner__text', '');
    text.appendChild(makeElement(doc, 'h2', 'consent-banner__title', 'Cookies'));
    var paragraph = makeElement(doc, 'p', '', bannerText(options.tools));
    var link = makeElement(doc, 'a', '', 'Privacy- en cookieverklaring');
    link.setAttribute('href', options.privacyUrl);
    paragraph.appendChild(link);
    text.appendChild(paragraph);
    if (options.current) {
      text.appendChild(makeElement(doc, 'p', 'consent-banner__current', options.current === 'granted' ? 'Je hebt statistieken nu toegestaan.' : 'Je hebt statistieken nu geweigerd.'));
    }
    banner.appendChild(text);
    var actions = makeElement(doc, 'div', 'consent-banner__actions', '');
    [['Accepteren', 'btn', 'granted'], ['Weigeren', 'btn btn--outline', 'denied']].forEach(function addButton(spec) {
      var button = makeElement(doc, 'button', spec[1], spec[0]);
      button.type = 'button';
      button.setAttribute('data-consent-choice', spec[2]);
      button.addEventListener('click', function choose() {
        banner.remove();
        options.onChoice(spec[2]);
      });
      actions.appendChild(button);
    });
    banner.appendChild(actions);
    doc.body.appendChild(banner);
  }

  /**
   * Bouwt de bediening voor de diensten die op deze pagina actief zijn (geldige ID op <body>).
   * @param {{window: Window, document: Document, reload: Function}} environment Browseromgeving.
   * @returns {{tools: string[], trackers: Array<{grant: Function, deny: Function, isLoaded: Function}>}} De diensten
   *   en hun bediening, in dezelfde volgorde.
   */
  function createTrackers(environment) {
    var body = environment.document.body;
    var measurementId = body && body.getAttribute('data-analytics');
    var clarityId = body && body.getAttribute('data-clarity');
    var tools = [];
    var trackers = [];
    if (measurementId && MEASUREMENT_ID_PATTERN.test(measurementId)) {
      tools.push('ga');
      trackers.push(createGoogleTracker({ window: environment.window, document: environment.document, measurementId: measurementId }));
    }
    if (clarityId && CLARITY_ID_PATTERN.test(clarityId)) {
      tools.push('clarity');
      trackers.push(createClarityTracker({ window: environment.window, document: environment.document, projectId: clarityId, reload: environment.reload }));
    }
    return { tools: tools, trackers: trackers };
  }

  /**
   * Start de meting op deze pagina: keuze lezen, de balk tonen als de bezoeker nog niet koos (of er een dienst bij
   * kwam) en de knop "Cookie-instellingen" laten werken.
   * @param {{window: Window, document: Document, storage: ?Storage, reload?: Function}} environment Browseromgeving;
   *   `reload` laadt de pagina opnieuw (standaard `location.reload`).
   * @returns {?object} De bediening (`grant`, `deny`, `isLoaded`, `tools`), of null als de pagina geen geldige ID heeft.
   */
  function start(environment) {
    var win = environment.window;
    var doc = environment.document;
    var storage = environment.storage;
    if (!doc.body) return null;
    var reload = environment.reload || function reloadPage() { win.location.reload(); };
    var active = createTrackers({ window: win, document: doc, reload: reload });
    if (!active.tools.length) return null;
    var privacyUrl = doc.body.getAttribute('data-privacy-url') || '/privacy/';
    var tracker = {
      tools: active.tools,
      grant: function grant() { active.trackers.forEach(function grantEach(each) { each.grant(); }); },
      deny: function deny() { active.trackers.forEach(function denyEach(each) { each.deny(); }); },
      isLoaded: function isLoaded() { return active.trackers.some(function loadedEach(each) { return each.isLoaded(); }); },
    };

    /**
     * Verwerkt een keuze: bewaren en de meting aan- of uitzetten.
     * @param {string} decision "granted" of "denied".
     * @returns {void}
     */
    function choose(decision) {
      writeConsent(storage, decision, active.tools);
      if (decision === 'granted') tracker.grant();
      else tracker.deny();
    }

    var earlier = readConsent(storage, active.tools);
    if (earlier === 'granted') tracker.grant();
    // Bewaarde weigering: ook achtergebleven cookies van een eerdere toestemming wissen.
    else if (earlier === 'denied') tracker.deny();
    else showBanner(doc, { privacyUrl: privacyUrl, tools: active.tools, current: null, onChoice: choose });

    doc.addEventListener('click', function openSettings(event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-consent-settings]') : null;
      if (target) showBanner(doc, { privacyUrl: privacyUrl, tools: active.tools, current: readConsent(storage, active.tools), onChoice: choose });
    });
    return tracker;
  }

  root.AvantaAnalytics = { start: start, readConsent: readConsent, CONSENT_KEY: CONSENT_KEY };
  if (root.document && root.document.body) root.AvantaAnalytics.tracker = start({ window: root, document: root.document, storage: safeStorage(root) });
}(typeof window !== 'undefined' ? window : this));
