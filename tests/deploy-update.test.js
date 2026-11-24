/**
 * Tests voor de hostscripts van updaten vanuit de app (pakket D1):
 * - deploy/apps01/update.sh met een echte git-repo en nep-docker/curl/install.sh: automatisch bijwerken, uit laten,
 *   een aanvraag van de app (juiste, verkeerde en onleesbare commit), alleen controleren, terugval bij een mislukte
 *   start en het overslaan van een mislukte commit;
 * - deploy/apps01/servertaken.sh: dezelfde taak-id's als HOST_TASKS in de app en een functie per taak;
 * - alle scripts in deploy/apps01 zijn geldige bash.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const DEPLOY = path.join(__dirname, '..', 'deploy', 'apps01');
const UPDATE_SCRIPT = path.join(DEPLOY, 'update.sh');

/**
 * Voert git uit in een map.
 * @param {string} cwd Map.
 * @param {...string} args Argumenten.
 * @returns {string} Uitvoer zonder witruimte aan het eind.
 */
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.nl', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.nl' } }).trim();
}

/**
 * Maakt een testopstelling: een origin-repo, de checkout op de "server" (BASE_DIR/repo) en nepcommando's.
 * @param {object} t Testcontext.
 * @returns {object} Paden en hulpfuncties.
 */
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const base = path.join(root, 'base');
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.txt');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(base, 'update', 'request'), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
  git(work, 'checkout', '-q', '-b', 'main');

  /**
   * Maakt een commit met een versie (en een nep-install.sh die de aanroep vastlegt en de code uitcheckt).
   * @param {string} version Versie in app/package.json.
   * @returns {string} De commit.
   */
  const commit = (version) => {
    fs.mkdirSync(path.join(work, 'app'), { recursive: true });
    fs.mkdirSync(path.join(work, 'deploy', 'apps01'), { recursive: true });
    fs.writeFileSync(path.join(work, 'app', 'package.json'), JSON.stringify({ name: 'avanta', version }, null, 2));
    fs.writeFileSync(path.join(work, 'app', 'CHANGELOG.md'), `# Changelog\n\n## ${version} — 2026-11-21 — Versie ${version}\n\n- Iets nieuws in ${version}.\n`);
    fs.writeFileSync(path.join(work, 'deploy', 'apps01', 'install.sh'), [
      '#!/usr/bin/env bash',
      'echo "install $1 ${INSTALL_PHASE:-volledig}" >> "$CALLS_FILE"',
      'git -C "$BASE_DIR/repo" checkout -q --detach "$1"',
      'version="$(grep -oE \'[0-9]+\\.[0-9]+\\.[0-9]+\' "$BASE_DIR/repo/app/package.json")"',
      '[ "${INSTALL_PHASE:-}" != build ] && [ "$version" = "$(cat "$BASE_DIR/fail-version" 2>/dev/null)" ] && exit 1',
      'exit 0',
    ].join('\n'));
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', `versie ${version}`);
    git(work, 'push', '-q', 'origin', 'main');
    return git(work, 'rev-parse', 'HEAD');
  };

  const first = commit('0.5.0');
  execFileSync('git', ['clone', '-q', origin, path.join(base, 'repo')], { stdio: 'pipe' });
  fs.writeFileSync(path.join(base, 'repo', 'deploy', 'apps01', '.env'), 'AVANTA_TRACK=main\nAPP_PORT=3400\n');
  // Nep-docker legt alles vast; nep-curl meldt de versie die nu is uitgecheckt (zoals /api/health na een start).
  fs.writeFileSync(path.join(bin, 'docker'), '#!/usr/bin/env bash\n[ "$1" = inspect ] && exit 0\necho "docker $*" >> "$CALLS_FILE"\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash\nprintf '{"ok":true,"version":"%s"}' "$(grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' "$BASE_DIR/repo/app/package.json")"\n`, { mode: 0o755 });

  /**
   * Draait update.sh.
   * @returns {{status: number, output: string}} Uitgangscode en uitvoer.
   */
  const run = () => {
    const out = spawnSync('bash', [UPDATE_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BASE_DIR: base, CALLS_FILE: calls, DRAIN_SECONDS: '0', LOCK_FILE: path.join(root, 'lock') },
    });
    return { status: out.status, output: out.stdout + out.stderr };
  };
  const status = (name) => JSON.parse(fs.readFileSync(path.join(base, 'update', 'status', name), 'utf8'));
  const head = () => git(path.join(base, 'repo'), 'rev-parse', 'HEAD');
  const takeCalls = () => {
    const text = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
    fs.rmSync(calls, { force: true });
    return text.split('\n').filter(Boolean);
  };
  const request = (body) => fs.writeFileSync(path.join(base, 'update', 'request', 'request.json'), JSON.stringify(body));
  return { base, first, commit, run, status, head, takeCalls, request };
}

test('update.sh: automatisch bijwerken, uit, aanvraag, controle en terugval', (t) => {
  const env = setup(t);
  // Niets nieuws: alleen de status bijwerken.
  let result = env.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(env.status('status.json').currentCommit, env.first);
  assert.deepEqual(env.takeCalls(), []);

  // Nieuwe commit, automatisch aan: eerst bouwen, dan back-up en starten; onderhoudsmodus weer weg.
  const second = env.commit('0.5.1');
  result = env.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(env.head(), second);
  const calls = env.takeCalls();
  assert.equal(calls[0], `install ${second} build`);
  assert.ok(calls.some((line) => /docker compose exec -T app node src\/backup\/cli\.js create --update/.test(line)), calls.join('\n'));
  assert.equal(calls[calls.length - 1], `install ${second} volledig`);
  assert.equal(env.status('run.json').state, 'geslaagd');
  assert.equal(env.status('run.json').automatic, true);
  assert.equal(env.status('status.json').current, '0.5.1');
  assert.match(fs.readFileSync(path.join(env.base, 'update', 'status', 'changelog.md'), 'utf8'), /## 0\.5\.1/);
  assert.equal(fs.existsSync(path.join(env.base, 'update', 'status', 'maintenance.json')), false);

  // Automatisch uit: niets installeren, wel melden wat klaarstaat.
  fs.writeFileSync(path.join(env.base, 'update', 'request', 'policy.json'), '{"auto":false}');
  const third = env.commit('0.5.2');
  result = env.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(env.head(), second);
  assert.deepEqual(env.takeCalls(), []);
  assert.equal(env.status('status.json').availableCommit, third);
  assert.equal(env.status('status.json').auto, false);

  // Alleen controleren: aanvraag weg, niets geïnstalleerd.
  env.request({ id: '00000000-0000-4000-8000-000000000001', check: true });
  assert.equal(env.run().status, 0);
  assert.equal(fs.existsSync(path.join(env.base, 'update', 'request', 'request.json')), false);
  assert.deepEqual(env.takeCalls(), []);

  // Aanvraag voor een andere commit: geweigerd. Onleesbaar: geweigerd.
  env.request({ id: '00000000-0000-4000-8000-000000000002', commit: env.first });
  env.run();
  assert.equal(env.status('run.json').state, 'geweigerd');
  assert.equal(env.status('run.json').requestId, '00000000-0000-4000-8000-000000000002');
  env.request({ id: '00000000-0000-4000-8000-000000000003', commit: 'kapot' });
  env.run();
  assert.match(env.status('run.json').message, /onleesbaar/);
  assert.equal(env.head(), second);
  assert.deepEqual(env.takeCalls(), []);

  // Aanvraag voor de klaarstaande commit: geïnstalleerd, ook met automatisch uit.
  env.request({ id: '00000000-0000-4000-8000-000000000004', commit: third });
  assert.equal(env.run().status, 0);
  assert.equal(env.head(), third);
  assert.equal(env.status('run.json').state, 'geslaagd');
  assert.equal(env.status('run.json').automatic, false);
  env.takeCalls();

  // Nieuwe versie start niet: terug naar de vorige, commit onthouden en daarna overgeslagen.
  fs.writeFileSync(path.join(env.base, 'update', 'request', 'policy.json'), '{"auto":true}');
  fs.writeFileSync(path.join(env.base, 'fail-version'), '0.5.3');
  const fourth = env.commit('0.5.3');
  result = env.run();
  assert.equal(result.status, 1, result.output);
  assert.equal(env.head(), third);
  assert.deepEqual(env.takeCalls().filter((line) => line.startsWith('install')), [`install ${fourth} build`, `install ${fourth} volledig`, `install ${third} volledig`]);
  assert.equal(env.status('run.json').state, 'mislukt');
  assert.match(env.status('run.json').message, /vorige versie draait weer/);
  assert.equal(fs.readFileSync(path.join(env.base, '.failed-commit'), 'utf8').trim(), fourth);
  assert.equal(env.run().status, 0);
  assert.deepEqual(env.takeCalls(), [], 'mislukte commit wordt overgeslagen');
});

test('servertaken.sh: dezelfde taken als HOST_TASKS, met een functie per taak', () => {
  const { HOST_TASKS } = require('../app/src/system/host-tasks');
  const script = fs.readFileSync(path.join(DEPLOY, 'servertaken.sh'), 'utf8');
  const block = /HOST_TASK_IDS=\(\n([\s\S]*?)\n\)/.exec(script);
  assert.ok(block, 'HOST_TASK_IDS ontbreekt');
  const ids = block[1].split('\n').map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(ids, HOST_TASKS.map((task) => task.id));
  for (const id of ids) assert.match(script, new RegExp(`^hosttask_${id.replace(/-/g, '_')}\\(\\) \\{`, 'm'), `functie voor ${id}`);
  assert.equal(new Set(ids).size, ids.length, 'id\'s uniek');
});

test('servertaken.sh schijf: toont de ruimte en ruimt alleen buildcache en oude Avanta-images op', (testContext) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schijf-'));
  testContext.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'base', 'repo'), { recursive: true });
  const callsFile = path.join(dir, 'calls');
  // Nep-docker: buildcache via CACHE, oude images via IMAGES; elke aanroep komt in het bestand calls.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/bin/bash
echo "$*" >> "${callsFile}"
case "$1 $2" in
  "system df") printf 'Images|1GB|0B\\nBuild Cache|%s|%s\\n' "$CACHE" "$CACHE" ;;
  "images -q") [[ "$IMAGES" == 1 ]] && echo abc123 ;;
esac
exit 0
`, { mode: 0o755 });
  const run = (action, extra) => spawnSync('bash', [path.join(DEPLOY, 'servertaken.sh'), action], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, SERVERTAKEN_REMOTE: '1', BASE_DIR: path.join(dir, 'base'), ...extra },
  });

  const nothing = run('schijf-check', { CACHE: '0B', IMAGES: '0' });
  assert.equal(nothing.status, 0, nothing.stderr);
  assert.match(nothing.stdout, /Niets te doen/);
  assert.match(nothing.stdout, /buildcache: +0B/);

  const something = run('schijf-check', { CACHE: '7.9GB', IMAGES: '1' });
  assert.equal(something.status, 10, something.stderr);
  assert.match(something.stdout, /Op te ruimen: de buildcache van de hele server.*7\.9GB.*andere stacks.* 1 ongebruikt/);
  assert.doesNotMatch(fs.readFileSync(callsFile, 'utf8'), /prune/, 'de controle ruimt niets op');

  const cleaned = run('schijf-run', {});
  assert.equal(cleaned.status, 0, cleaned.stderr);
  const calls = fs.readFileSync(callsFile, 'utf8');
  assert.match(calls, /^builder prune -f --filter until=168h$/m);
  assert.match(calls, /^image prune -f --filter label=nl\.avantareizen\.stack=avanta$/m);
  assert.doesNotMatch(calls, /volume (rm|prune)|system prune|container prune/, 'volumes en containers blijven staan');
});

test('alle hostscripts zijn geldige bash', () => {
  for (const name of fs.readdirSync(DEPLOY).filter((file) => file.endsWith('.sh'))) {
    const out = spawnSync('bash', ['-n', path.join(DEPLOY, name)], { encoding: 'utf8' });
    assert.equal(out.status, 0, `${name}: ${out.stderr}`);
  }
});
