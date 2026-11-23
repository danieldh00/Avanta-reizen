/**
 * Tests voor deploy/apps01/tunnel-ingress.py: een hostname toevoegen aan de ingress van een bestaande tunnel zonder
 * andere regels of instellingen te verliezen, en altijd met een catch-all als laatste regel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'deploy', 'apps01', 'tunnel-ingress.py');
const FQDN = 'avanta.den-hollander.com';
const SERVICE = 'http://avanta-app:3400';

/**
 * Draait het script op een API-antwoord en geeft de nieuwe config terug.
 * @param {object} response Antwoord van GET .../configurations.
 * @returns {object} De config uit de body voor de PUT.
 */
function merge(response) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingress-'));
  try {
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(response));
    execFileSync('python3', [SCRIPT, path.join(dir, 'current.json'), path.join(dir, 'new.json'), FQDN, SERVICE], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(dir, 'new.json'), 'utf8')).config;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HUB = { hostname: 'hub.den-hollander.com', service: 'http://hub:3300', originRequest: { noTLSVerify: false } };
const CATCH_ALL = { service: 'http_status:404' };

test('nieuwe regel komt vóór de catch-all; andere regels en instellingen blijven', () => {
  const config = merge({ success: true, result: { config: { ingress: [HUB, CATCH_ALL], 'warp-routing': { enabled: false } } } });
  assert.deepEqual(config.ingress, [HUB, { hostname: FQDN, service: SERVICE }, CATCH_ALL]);
  assert.deepEqual(config['warp-routing'], { enabled: false });
});

test('bestaande regel voor de hostname wordt bijgewerkt, niet verdubbeld', () => {
  const config = merge({ result: { config: { ingress: [HUB, { hostname: FQDN, service: 'http://oud:1' }, CATCH_ALL] } } });
  assert.deepEqual(config.ingress, [HUB, { hostname: FQDN, service: SERVICE }, CATCH_ALL]);
});

test('ontbrekende config of ingress: regel plus catch-all', () => {
  for (const response of [{ result: {} }, { result: { config: null } }, { result: { config: { ingress: [] } } }]) {
    assert.deepEqual(merge(response).ingress, [{ hostname: FQDN, service: SERVICE }, CATCH_ALL]);
  }
});

test('zonder catch-all wordt er een toegevoegd', () => {
  assert.deepEqual(merge({ result: { config: { ingress: [HUB] } } }).ingress, [HUB, { hostname: FQDN, service: SERVICE }, CATCH_ALL]);
});
