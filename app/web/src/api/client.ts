/**
 * De enige weg van de frontend naar de server: een getypte client voor de JSON-API onder `/app/api/`. Geen losse
 * `fetch` in schermen.
 *
 * - Altijd naar dezelfde herkomst, met de sessiecookie, de vaste kop `X-Avanta-Api: 1` (zonder die kop weigert de
 *   server, zie `app/src/api/guard.js`) en zonder cache.
 * - 401: de sessie is verlopen; de browser gaat naar het inlogscherm (of de tweede stap) dat de server noemt.
 * - Een GET-verzoek gebruikt eerst een antwoord dat de server voor het eerste scherm in de pagina meestuurde
 *   (`preload.ts`), zodat dat scherm niet op een extra verzoek wacht.
 * - Elke andere fout wordt een `ApiError` met een nette melding voor het scherm (403, 404, 429, 503 en de rest), en bij
 *   ongeldige invoer de melding per veld.
 */
import type { ApiErrorBody, ApiErrorCode, SessionInfo } from './types';
import { takePreloaded } from './preload';

/** Begin van elk adres van de API. */
export const API_BASE = '/app/api';

/** Meldingen als de server geen bruikbare melding meestuurt (bijvoorbeeld een proxy die een fout geeft). */
const FALLBACK_MESSAGES: Record<number, string> = {
  403: 'Je hebt geen toegang tot dit onderdeel.',
  404: 'Niet gevonden.',
  413: 'Het verzoek is te groot.',
  429: 'Te veel verzoeken. Probeer het over een minuut opnieuw.',
  503: 'Even geduld: er wordt onderhoud gedaan. Probeer het zo opnieuw.',
};

/** Melding als de server niet te bereiken is. */
export const OFFLINE_MESSAGE = 'De server is niet bereikbaar. Controleer de verbinding en probeer het opnieuw.';

/** Fout van de API, met de vaste code, een melding voor het scherm en eventueel meldingen per veld. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'offline';
  readonly fields: Record<string, string>;
  readonly errorCode: string;

  /**
   * @param status HTTP-status (0 als de server niet bereikbaar was).
   * @param code Vaste code van de server, of `offline`.
   * @param message Melding voor het scherm.
   * @param extra Meldingen per veld en de foutcode uit het logboek.
   */
  constructor(status: number, code: ApiErrorCode | 'offline', message: string, extra: { fields?: Record<string, string>; errorCode?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields || {};
    this.errorCode = extra.errorCode || '';
  }
}

/** Wat de client van de omgeving gebruikt; tests geven een eigen versie mee. */
export interface ClientEnvironment {
  fetch: typeof fetch;
  /** Gaat naar een ander adres (bij een verlopen sessie). */
  navigate: (path: string) => void;
  /** Geeft een voorgeladen antwoord voor een GET-verzoek, één keer (`preload.ts`); zonder deze functie nooit. */
  preloaded?: (path: string) => { value: unknown } | undefined;
}

/** Standaardomgeving: de echte `fetch` en navigatie van de browser. */
const browserEnvironment: ClientEnvironment = {
  fetch: (...args) => window.fetch(...args),
  navigate: (path) => window.location.assign(path),
  preloaded: takePreloaded,
};

/**
 * Controleert een pad binnen de API: begint met `/`, zonder `//`, `..`, `\` of een schema, zodat een verzoek nooit
 * buiten `/app/api/` uitkomt.
 * @param path Pad, bijvoorbeeld `/faq/12/`.
 * @returns Het pad.
 * @throws Error bij een ongeldig pad.
 */
export function checkPath(path: string): string {
  if (!path.startsWith('/') || path.includes('//') || path.includes('..') || path.includes('\\') || /[\s#]/.test(path)) {
    throw new Error(`Ongeldig pad voor de API: '${path}'`);
  }
  return path;
}

/**
 * Leest een foutantwoord; geeft null als de body niet het foutformaat van de server heeft.
 * @param response Antwoord.
 * @returns De fout uit de body, of null.
 */
async function readErrorBody(response: Response): Promise<ApiErrorBody['fout'] | null> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return body && body.fout && typeof body.fout.melding === 'string' ? body.fout : null;
  } catch {
    return null;
  }
}

/**
 * Pad om naartoe te gaan bij een verlopen sessie: alleen een pad onder `/app/` dat de server noemt.
 * @param candidate Het pad uit het antwoord.
 * @returns Een veilig pad.
 */
function loginPath(candidate: string | undefined): string {
  return candidate && /^\/app\/[a-z0-9/-]*$/.test(candidate) ? candidate : '/app/inloggen/';
}

/** Opties per verzoek. */
export interface RequestOptions {
  /** Inhoud die als JSON wordt meegestuurd. */
  body?: unknown;
  /** Een upload (`multipart/form-data`) in plaats van JSON. */
  form?: FormData;
  /** Om een verzoek af te breken (bijvoorbeeld bij het verlaten van een scherm). */
  signal?: AbortSignal;
}

/**
 * Maakt een client.
 * @param environment Omgeving (standaard de browser).
 * @returns Functies per methode.
 */
export function createApiClient(environment: ClientEnvironment = browserEnvironment) {
  /**
   * Doet een verzoek naar de API.
   * @param method HTTP-methode.
   * @param path Pad binnen `/app/api`.
   * @param options Inhoud en afbreken.
   * @returns De JSON van het antwoord (of `undefined` bij 204).
   * @throws ApiError bij elke fout.
   */
  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { 'X-Avanta-Api': '1', Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await environment.fetch(API_BASE + checkPath(path), {
        method, headers, body, signal: options.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'offline', OFFLINE_MESSAGE);
    }
    if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
    const fout = await readErrorBody(response);
    if (response.status === 401) environment.navigate(loginPath(fout?.naar));
    throw new ApiError(response.status, fout?.code || 'fout', fout?.melding || FALLBACK_MESSAGES[response.status] || 'Er ging iets mis. Probeer het later opnieuw.', {
      fields: fout?.velden, errorCode: fout?.foutcode,
    });
  }

  /**
   * Een GET-verzoek; eerst een antwoord dat de server in de pagina meestuurde (`preload.ts`), één keer per pad.
   * @param path Pad binnen `/app/api`.
   * @param options Afbreken.
   * @returns De JSON van het antwoord.
   */
  async function get<T>(path: string, options?: RequestOptions): Promise<T> {
    const preloaded = environment.preloaded ? environment.preloaded(checkPath(path)) : undefined;
    return preloaded ? preloaded.value as T : request<T>('GET', path, options);
  }

  return {
    request,
    get,
    post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
    put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
    delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
    upload: <T>(path: string, form: FormData, options?: RequestOptions) => request<T>('POST', path, { ...options, form }),
    /** Wie is ingelogd en met welke rechten. */
    session: () => request<SessionInfo>('GET', '/sessie/'),
  };
}

/** Type van een client. */
export type ApiClient = ReturnType<typeof createApiClient>;

/** De client van de app. */
export const api = createApiClient();
