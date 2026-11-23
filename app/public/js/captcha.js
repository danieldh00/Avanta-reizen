/**
 * Onzichtbare captcha (Google reCAPTCHA v3) in de browser. Een formulier met
 * <input type="hidden" name="captchaToken" data-site-key="…" data-captcha-action="contact"> krijgt vlak vóór het
 * verzenden een vers token. Het script van Google wordt pas geladen als de bezoeker het formulier begint in te vullen
 * (of verstuurt), niet bij het openen van de pagina. Lukt het laden niet (adblocker, geen verbinding), dan gaat het
 * formulier zonder token weg en toont de server een duidelijke melding.
 */
(function setupCaptcha() {
  'use strict';

  /** Hoe lang (ms) op Google wordt gewacht voordat het formulier zonder token verzonden wordt. */
  const TIMEOUT_MS = 10000;

  /** Lopende of voltooide laadpoging per sitesleutel. */
  const loading = new Map();

  /**
   * Laadt het script van Google voor een sitesleutel (één keer per sleutel).
   * @param {string} siteKey De sitesleutel.
   * @returns {Promise<object>} Het object `grecaptcha`, klaar voor gebruik.
   */
  function load(siteKey) {
    if (loading.has(siteKey)) return loading.get(siteKey);
    const promise = new Promise((resolve, reject) => {
      if (window.grecaptcha && window.grecaptcha.execute) {
        window.grecaptcha.ready(() => resolve(window.grecaptcha));
        return;
      }
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.onload = () => {
        if (window.grecaptcha) window.grecaptcha.ready(() => resolve(window.grecaptcha));
        else reject(new Error('captcha'));
      };
      script.onerror = () => reject(new Error('captcha'));
      document.head.appendChild(script);
    });
    // Een mislukte poging mag een volgende poging niet blokkeren.
    promise.catch(() => loading.delete(siteKey));
    loading.set(siteKey, promise);
    return promise;
  }

  /**
   * Vraagt een token voor één actie (elk token is eenmalig en twee minuten geldig).
   * @param {string} siteKey De sitesleutel.
   * @param {string} action De actienaam (moet bij de server passen).
   * @returns {Promise<string>} Het token.
   */
  function token(siteKey, action) {
    const run = load(siteKey).then((grecaptcha) => grecaptcha.execute(siteKey, { action }));
    const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS));
    return Promise.race([run, timeout]);
  }

  /**
   * Het captchaveld van een formulier.
   * @param {Element} form Het formulier.
   * @returns {(HTMLInputElement|null)} Het verborgen veld, of null.
   */
  function fieldOf(form) {
    return form && form.querySelector ? form.querySelector('input[name="captchaToken"][data-site-key]') : null;
  }

  document.addEventListener('focusin', (event) => {
    const field = fieldOf(event.target.form);
    if (field) load(field.dataset.siteKey).catch(() => {});
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    const field = fieldOf(form);
    if (!field || form.dataset.captchaReady === '1') return;
    event.preventDefault();
    const submitter = event.submitter;
    try {
      field.value = await token(field.dataset.siteKey, field.dataset.captchaAction);
    } catch (error) {
      field.value = '';
    }
    // Eerst de huidige verzending laten aflopen: een snel antwoord kan nog binnen dezelfde gebeurtenis vallen, en dan
    // negeert de browser een nieuwe verzending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    form.dataset.captchaReady = '1';
    try {
      if (form.requestSubmit) form.requestSubmit(submitter || undefined);
      else form.submit();
    } finally {
      delete form.dataset.captchaReady;
    }
  }, true);
}());
