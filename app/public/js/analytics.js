/**
 * Bezoekersstatistieken met Google Analytics (GA4), alleen na toestemming van de bezoeker. De server zet het meet-ID
 * als `data-analytics` op <body> (alleen als Analytics in Beheer aan staat). Zonder toestemming wordt er niets van
 * Google geladen: geen script, geen cookie, geen verbinding. Consent Mode v2 staat standaard op "geweigerd"; bij
 * Accepteren gaat alleen `analytics_storage` op "toegestaan", advertentie-opslag nooit. De keuze staat met versie en
 * datum in localStorage en is altijd te wijzigen via "Cookie-instellingen" in de voettekst. Weigeren of intrekken zet
 * `ga-disable-<id>` en wist de `_ga`-cookies. Er gaan nooit persoonsgegevens naar Google.
 */
(function analyticsModule(root) {
  'use strict';

  /** Sleutel in localStorage voor de keuze van de bezoeker. */
  var CONSENT_KEY = 'avanta_cookie_consent';
  /** Versie van de toestemmingstekst; een andere versie in de opslag telt als geen keuze. */
  var CONSENT_VERSION = 1;
  /** Een GA4-meet-ID (de server controleert dit ook). */
  var MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,14}$/;

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
   * Leest de eerder gemaakte keuze.
   * @param {?Storage} storage De opslag van de browser.
   * @returns {?string} "granted", "denied", of null als de bezoeker nog niet koos (of de versie niet meer klopt).
   */
  function readConsent(storage) {
    try {
      var parsed = JSON.parse((storage && storage.getItem(CONSENT_KEY)) || 'null');
      if (!parsed || parsed.v !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') return null;
      return parsed.analytics ? 'granted' : 'denied';
    } catch (error) {
      return null;
    }
  }

  /**
   * Bewaart de keuze met versie en datum; lukt dat niet, dan geldt hij alleen voor deze pagina.
   * @param {?Storage} storage De opslag van de browser.
   * @param {string} decision "granted" of "denied".
   * @returns {void}
   */
  function writeConsent(storage, decision) {
    try {
      if (storage) storage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, analytics: decision === 'granted', at: new Date().toISOString() }));
    } catch (error) {
      // Niet bewaren kan; de vraag komt dan op de volgende pagina terug.
    }
  }

  /**
   * Wist de cookies van Google Analytics (`_ga` en `_ga_*`) van deze site, op het hoofdpad en de bovenliggende domeinen.
   * @param {Window} win Het venster.
   * @param {Document} doc Het document.
   * @returns {void}
   */
  function clearAnalyticsCookies(win, doc) {
    var names = String(doc.cookie || '').split(';').map(function nameOf(part) { return part.split('=')[0].trim(); })
      .filter(function isAnalytics(name) { return name === '_ga' || name.indexOf('_ga_') === 0; });
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
   * De meting: houdt de toestemming bij en laadt Google pas na Accepteren.
   * @param {{window: Window, document: Document, measurementId: string}} environment Browseromgeving en meet-ID.
   * @returns {{grant: Function, deny: Function, isLoaded: Function}} De bediening.
   */
  function createTracker(environment) {
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
   * Toont de cookiebalk met de huidige keuze; een keuze sluit de balk.
   * @param {Document} doc Het document.
   * @param {{privacyUrl: string, current: ?string, onChoice: Function}} options Privacyverklaring, huidige keuze en wat er
   *   bij een keuze gebeurt.
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
    var paragraph = makeElement(doc, 'p', '', 'We gebruiken alleen noodzakelijke cookies. Met jouw toestemming meten we ook met Google Analytics hoe de site wordt gebruikt, zonder advertenties of persoonsgegevens. ');
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
   * Start de meting op deze pagina: keuze lezen, de balk tonen als de bezoeker nog niet koos en de knop
   * "Cookie-instellingen" laten werken.
   * @param {{window: Window, document: Document, storage: ?Storage}} environment Browseromgeving.
   * @returns {?object} De bediening, of null als de pagina geen (geldig) meet-ID heeft.
   */
  function start(environment) {
    var win = environment.window;
    var doc = environment.document;
    var storage = environment.storage;
    var body = doc.body;
    var measurementId = body && body.getAttribute('data-analytics');
    if (!measurementId || !MEASUREMENT_ID_PATTERN.test(measurementId)) return null;
    var privacyUrl = body.getAttribute('data-privacy-url') || '/privacy/';
    var tracker = createTracker({ window: win, document: doc, measurementId: measurementId });

    /**
     * Verwerkt een keuze: bewaren en de meting aan- of uitzetten.
     * @param {string} decision "granted" of "denied".
     * @returns {void}
     */
    function choose(decision) {
      writeConsent(storage, decision);
      if (decision === 'granted') tracker.grant();
      else tracker.deny();
    }

    var earlier = readConsent(storage);
    if (earlier === 'granted') tracker.grant();
    else if (earlier === null) showBanner(doc, { privacyUrl: privacyUrl, current: null, onChoice: choose });

    doc.addEventListener('click', function openSettings(event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-consent-settings]') : null;
      if (target) showBanner(doc, { privacyUrl: privacyUrl, current: readConsent(storage), onChoice: choose });
    });
    return tracker;
  }

  root.AvantaAnalytics = { start: start, readConsent: readConsent, CONSENT_KEY: CONSENT_KEY };
  if (root.document && root.document.body) root.AvantaAnalytics.tracker = start({ window: root, document: root.document, storage: safeStorage(root) });
}(typeof window !== 'undefined' ? window : this));
