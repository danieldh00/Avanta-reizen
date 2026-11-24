// Tests voor `routePath` (routes met een patroon per parameter onder Express 5) en de foutafhandeling van async routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { routePath } = require('../src/route-path');

/**
 * Start een kleine Express-app op een vrije poort en geeft een functie om er paden op te vragen.
 * @param {(app: import('express').Express) => void} setup Registreert de routes.
 * @param {import('node:test').TestContext} context Testcontext (sluit de server na de test).
 * @returns {Promise<(path: string, init?: RequestInit) => Promise<{status: number, text: string}>>} Opvrager.
 */
async function startApp(setup, context) {
  const app = express();
  setup(app);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return async (path, init) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
    return { status: response.status, text: await response.text() };
  };
}

test('routePath: patronen, gewone parameters, escaping en fouten', () => {
  const trip = routePath('/reizen/:id(\\d{1,9})/fotos/:link(\\d{1,9})/:action(omhoog|omlaag)/');
  const match = trip.exec('/reizen/12/fotos/3/omhoog/');
  assert.deepEqual({ ...match.groups }, { id: '12', link: '3', action: 'omhoog' });
  assert.ok(trip.test('/reizen/12/fotos/3/omhoog'), 'slash aan het eind mag ontbreken (zoals zonder strict)');
  assert.ok(trip.test('/REIZEN/12/FOTOS/3/OMHOOG/'), 'hoofdletterongevoelig zoals Express');
  assert.equal(trip.test('/reizen/nieuw/fotos/3/omhoog/'), false);
  assert.equal(trip.test('/reizen/1234567890/fotos/3/omhoog/'), false, 'patroon begrenst de lengte');
  assert.equal(trip.test('/reizen/12/fotos/3/weg/'), false);
  assert.equal(trip.test('/x/reizen/12/fotos/3/omhoog/'), false, 'verankerd aan het begin');

  const download = routePath('/beheer/back-ups/download/:name([a-z0-9.-]{1,60})');
  assert.equal(download.exec('/beheer/back-ups/download/avanta-1.dump.enc').groups.name, 'avanta-1.dump.enc');
  assert.equal(download.test('/beheer/back-ups/download/../geheim'), false);

  const plain = routePath('/betalen/:link/klaar.html');
  assert.equal(plain.exec('/betalen/abc/klaar.html').groups.link, 'abc');
  assert.equal(plain.test('/betalen/abc/klaarxhtml'), false, 'een punt in het pad is letterlijk');
  assert.equal(plain.test('/betalen/a/b/klaar.html'), false, 'gewone parameter is één segment');

  assert.throws(() => routePath('reizen/:id(\\d+)/'), /moet met "\/" beginnen/);
  assert.throws(() => routePath('/a/:id(\\d+)/b/:id(\\d+)/'), /komt twee keer voor/);
});

test('routePath in een Express 5-router: params, doorvallen naar de volgende route', async (t) => {
  const request = await startApp((app) => {
    const router = express.Router();
    router.get(routePath('/reizen/:id(\\d{1,9})/'), (req, res) => res.send(`reis ${req.params.id}`));
    router.get('/reizen/nieuw/', (req, res) => res.send('nieuw'));
    app.use('/app', router);
  }, t);
  assert.deepEqual(await request('/app/reizen/42/'), { status: 200, text: 'reis 42' });
  assert.deepEqual(await request('/app/reizen/nieuw/'), { status: 200, text: 'nieuw' });
  assert.equal((await request('/app/reizen/42x/')).status, 404);
});

test('Express 5: een afgewezen promise in een route gaat naar de foutafhandelaar', async (t) => {
  const request = await startApp((app) => {
    app.get('/stuk/', async () => {
      throw new Error('kapot');
    });
    app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
      res.status(500).send(`afgehandeld: ${error.message}`);
    });
  }, t);
  assert.deepEqual(await request('/stuk/'), { status: 500, text: 'afgehandeld: kapot' });
});
