/**
 * Koppeling met Mollie (iDEAL en andere betaalmethoden) voor online betalen, standaard uit (Beheer > CRM > Online
 * betalen: `mollieEnabled`, sleutel `mollieApiKey` als geheim). Alleen het vaste adres `https://api.mollie.com/v2`;
 * nooit een adres uit invoer. De sleutel gaat nooit naar het logboek of de browser; fouten krijgen een korte code.
 * Mollie meldt een statuswijziging via de webhook met alleen het betaal-id: de app vraagt de betaling daarna zelf op,
 * dus de inhoud van de webhook wordt nooit vertrouwd.
 */

/** Vast adres van de Mollie-API. */
const API_BASE = 'https://api.mollie.com/v2';

/** Tijdslimiet per verzoek. */
const TIMEOUT_MS = 10 * 1000;

/** Patroon van een Mollie-sleutel (test- of live-sleutel). */
const API_KEY_PATTERN = /^(test|live)_[A-Za-z0-9]{20,64}$/;

/** Patroon van een Mollie-betaal-id. */
const PAYMENT_ID_PATTERN = /^tr_[A-Za-z0-9]{4,40}$/;

/**
 * Fout bij een verzoek aan Mollie, met een korte code die veilig getoond kan worden.
 */
class MollieError extends Error {
  /**
   * @param {string} code Korte code (`not_configured`, `http_<status>`, `network`, `invalid_response`).
   * @param {string} message Uitleg in gewone taal (zonder sleutel).
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Bedrag in centen als Mollie-bedrag ("12.50").
 * @param {number} cents Bedrag.
 * @returns {{currency: string, value: string}} Bedrag voor de API.
 */
function mollieAmount(cents) {
  return { currency: 'EUR', value: (cents / 100).toFixed(2) };
}

/**
 * Mollie-bedrag naar centen.
 * @param {{currency?: string, value?: string}} amount Bedrag van de API.
 * @returns {(number|null)} Centen, of null als het geen euro's zijn of geen geldig bedrag.
 */
function centsFromMollie(amount) {
  if (!amount || amount.currency !== 'EUR' || !/^\d{1,9}\.\d{2}$/.test(String(amount.value))) return null;
  const [euros, cents] = String(amount.value).split('.');
  return Number(euros) * 100 + Number(cents);
}

/**
 * Maakt de Mollie-koppeling.
 * @param {{settings: object, fetchImpl?: Function}} options Instellingen en (voor tests) fetch.
 * @returns {{enabled: Function, createPayment: Function, getPayment: Function}} Functies.
 */
function createMollie(options) {
  const { settings } = options;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  /**
   * Of online betalen aan staat en er een geldige sleutel is.
   * @returns {boolean} Waar als de koppeling bruikbaar is.
   */
  const enabled = () => Boolean(settings.get('mollieEnabled')) && API_KEY_PATTERN.test(String(settings.get('mollieApiKey') || ''));

  /**
   * Doet een verzoek aan de API.
   * @param {string} method GET of POST.
   * @param {string} path Pad onder `/v2` (vaste tekst of een gecontroleerd id).
   * @param {object} [body] JSON-inhoud.
   * @returns {Promise<object>} Het antwoord.
   * @throws {MollieError} Bij een fout.
   */
  const call = async (method, path, body) => {
    if (!enabled()) throw new MollieError('not_configured', 'Online betalen staat uit of er is geen geldige Mollie-sleutel.');
    let response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${settings.get('mollieApiKey')}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (_) {
      throw new MollieError('network', 'Mollie is niet bereikbaar.');
    }
    if (!response.ok) throw new MollieError(`http_${response.status}`, `Mollie weigert het verzoek (HTTP ${response.status}).`);
    try {
      return await response.json();
    } catch (_) {
      throw new MollieError('invalid_response', 'Mollie gaf een onleesbaar antwoord.');
    }
  };

  /**
   * Maakt een betaling aan.
   * @param {{amountCents: number, description: string, redirectUrl: string, webhookUrl: string, metadata: object}} input Gegevens.
   * @returns {Promise<{id: string, checkoutUrl: string}>} Id en adres van het betaalscherm.
   */
  const createPayment = async (input) => {
    const payment = await call('POST', '/payments', {
      amount: mollieAmount(input.amountCents),
      description: String(input.description).slice(0, 255),
      redirectUrl: input.redirectUrl,
      webhookUrl: input.webhookUrl,
      metadata: input.metadata,
      locale: 'nl_NL',
    });
    const checkoutUrl = payment && payment._links && payment._links.checkout && payment._links.checkout.href;
    if (!PAYMENT_ID_PATTERN.test(String(payment && payment.id)) || !/^https:\/\/[^/]*mollie\.com\//.test(String(checkoutUrl))) {
      throw new MollieError('invalid_response', 'Mollie gaf geen geldig betaalscherm terug.');
    }
    return { id: payment.id, checkoutUrl };
  };

  /**
   * Vraagt een betaling op.
   * @param {string} id Mollie-id (`tr_…`).
   * @returns {Promise<{id: string, status: string, amountCents: (number|null), paidAt: (string|null), metadata: object}>} Stand.
   */
  const getPayment = async (id) => {
    if (!PAYMENT_ID_PATTERN.test(String(id))) throw new MollieError('invalid_id', 'Ongeldig betaal-id.');
    const payment = await call('GET', `/payments/${id}`);
    return {
      id: String(payment.id),
      status: String(payment.status || ''),
      amountCents: centsFromMollie(payment.amount),
      paidAt: payment.paidAt ? String(payment.paidAt) : null,
      metadata: payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {},
    };
  };

  return { enabled, createPayment, getPayment };
}

module.exports = { createMollie, MollieError, mollieAmount, centsFromMollie, API_KEY_PATTERN, PAYMENT_ID_PATTERN, API_BASE };
