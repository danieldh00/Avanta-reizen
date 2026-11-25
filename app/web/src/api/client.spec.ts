/**
 * Tests van de getypte client (`client.ts`): kop en opties, JSON en uploads, het pad, 401 naar inloggen, nette
 * meldingen bij 403/404/429/503 en zonder server.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError, OFFLINE_MESSAGE, api, checkPath, createApiClient } from './client';

/**
 * Maakt een client met een nagebootste server.
 * @param status Status van het antwoord.
 * @param body Body (object wordt JSON, tekst blijft tekst).
 * @returns Client, de nagebootste fetch en navigatie.
 */
function clientWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const navigate = vi.fn();
  return { client: createApiClient({ fetch: fetchMock as unknown as typeof fetch, navigate }), fetchMock, navigate };
}

/**
 * Vangt de fout van een belofte.
 * @param promise Belofte die moet mislukken.
 * @returns De fout.
 */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('verwachtte een fout');
}

describe('api-client', () => {
  it('stuurt de vaste kop, de cookie en geen cache mee, en leest JSON', async () => {
    const { client, fetchMock } = clientWith(200, { gebruiker: { naam: 'Rita', rol: 'redacteur', rolNaam: 'Redacteur' }, rechten: ['content'] });
    const session = await client.session();
    expect(session.rechten).toEqual(['content']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/app/api/sessie/');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    expect(init.headers).toEqual({ 'X-Avanta-Api': '1', Accept: 'application/json' });
    expect(init.body).toBeUndefined();
  });

  it('stuurt inhoud als JSON en geeft niets terug bij 204', async () => {
    const { client, fetchMock } = clientWith(204, '');
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    expect(await client.put('/faq/3/', { vraag: 'Waarom?' })).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"vraag":"Waarom?"}');
  });

  it('kent alle methoden en stuurt een upload als formulier', async () => {
    const { client, fetchMock } = clientWith(200, { ok: true });
    await client.get('/a/');
    await client.post('/a/', { x: 1 });
    await client.patch('/a/', { x: 2 });
    await client.delete('/a/');
    const form = new FormData();
    form.append('bestand', new Blob(['x']), 'x.jpg');
    await client.upload('/a/', form);
    const methods = fetchMock.mock.calls.map((call) => ((call as unknown as [string, RequestInit])[1]).method);
    expect(methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE', 'POST']);
    const [, uploadInit] = fetchMock.mock.calls[4] as unknown as [string, RequestInit];
    expect(uploadInit.body).toBe(form);
    expect((uploadInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('weigert een pad buiten de API', () => {
    expect(checkPath('/faq/12/')).toBe('/faq/12/');
    for (const path of ['faq/', '//evil.example/', '/../beheer/', '/a\\b', '/a b', '/a#b']) expect(() => checkPath(path)).toThrow('Ongeldig pad');
  });

  it('gaat bij 401 naar het inlogscherm dat de server noemt, en alleen binnen /app/', async () => {
    let setup = clientWith(401, { fout: { code: 'niet-ingelogd', melding: 'Log opnieuw in.', naar: '/app/inloggen/code/' } });
    const error = await failure(setup.client.get('/a/'));
    expect(error.status).toBe(401);
    expect(setup.navigate).toHaveBeenCalledWith('/app/inloggen/code/');
    setup = clientWith(401, { fout: { code: 'niet-ingelogd', melding: 'Log opnieuw in.', naar: 'https://evil.example/' } });
    await failure(setup.client.get('/a/'));
    expect(setup.navigate).toHaveBeenCalledWith('/app/inloggen/');
  });

  it('geeft de melding en de velden van de server door', async () => {
    const { client, navigate } = clientWith(400, { fout: { code: 'ongeldig', melding: 'Controleer de gemarkeerde velden.', velden: { vraag: 'Vul een vraag in.' } } });
    const error = await failure(client.post('/faq/', {}));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('ongeldig');
    expect(error.message).toBe('Controleer de gemarkeerde velden.');
    expect(error.fields).toEqual({ vraag: 'Vul een vraag in.' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('geeft de foutcode uit het logboek door', async () => {
    const { client } = clientWith(500, { fout: { code: 'fout', melding: 'Er ging iets mis.', foutcode: 'abcd1234' } });
    const error = await failure(client.get('/a/'));
    expect(error.errorCode).toBe('abcd1234');
    expect(error.fields).toEqual({});
  });

  it.each([
    [403, 'Je hebt geen toegang tot dit onderdeel.'],
    [404, 'Niet gevonden.'],
    [413, 'Het verzoek is te groot.'],
    [429, 'Te veel verzoeken. Probeer het over een minuut opnieuw.'],
    [503, 'Even geduld: er wordt onderhoud gedaan. Probeer het zo opnieuw.'],
    [502, 'Er ging iets mis. Probeer het later opnieuw.'],
  ])('geeft bij %i zonder foutformaat een nette melding', async (status, message) => {
    const { client } = clientWith(status, '<html>proxy</html>');
    const error = await failure(client.get('/a/'));
    expect(error.status).toBe(status);
    expect(error.code).toBe('fout');
    expect(error.message).toBe(message);
  });

  it('meldt een onbereikbare server en laat afbreken door', async () => {
    const offline = createApiClient({ fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, navigate: vi.fn() });
    const error = await failure(offline.get('/a/'));
    expect(error.code).toBe('offline');
    expect(error.message).toBe(OFFLINE_MESSAGE);
    const aborted = createApiClient({ fetch: vi.fn(async () => { throw new DOMException('afgebroken', 'AbortError'); }) as unknown as typeof fetch, navigate: vi.fn() });
    const abortError = await failure(aborted.get('/a/'));
    expect((abortError as unknown as DOMException).name).toBe('AbortError');
  });

  it('gebruikt standaard de fetch en navigatie van de browser', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ fout: { code: 'niet-ingelogd', melding: 'Log opnieuw in.' } }), { status: 401 }));
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ assign } as unknown as Location);
    await failure(api.get('/a/'));
    expect(fetchSpy).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/app/inloggen/');
  });
});
