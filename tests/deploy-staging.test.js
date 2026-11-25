/**
 * Tests voor de stagingomgeving van de ombouw naar Vue (deploy/staging/install-staging.sh), met een echte git-repo en
 * nep-docker, -curl en -systemctl: eerste installatie met eigen geheimen, volgen van develop zodra die bestaat, de
 * timer die alleen bij een nieuwe commit iets doet, terugval bij een commit die niet start, en dat staging de
 * testomgeving niet aanraakt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const STAGING = path.join(ROOT, 'deploy', 'staging');
const SCRIPT = path.join(STAGING, 'install-staging.sh');

/**
 * Voert git uit in een map.
 * @param {string} cwd Map.
 * @param {...string} args Argumenten.
 * @returns {string} Uitvoer zonder witruimte aan het eind.
 */
function git(cwd, ...args) {
  const identity = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...identity } }).trim();
}

/**
 * Maakt een testopstelling: een origin-repo met de echte stagingbestanden, de .env van de "testomgeving" en
 * nepcommando's die hun aanroepen vastleggen.
 * @param {any} testContext Testcontext.
 * @returns {any} Paden en hulpfuncties.
 */
function setup(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-staging-'));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const base = path.join(root, 'staging');
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.txt');
  const mainEnv = path.join(root, 'testomgeving.env');
  const systemRoot = path.join(root, 'systeem');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(systemRoot, 'etc', 'systemd', 'system'), { recursive: true });
  fs.mkdirSync(path.join(systemRoot, 'usr', 'local', 'sbin'), { recursive: true });
  fs.writeFileSync(mainEnv, 'TUNNEL_CONTAINER=tunnel-cloudflared\nTUNNEL_NETWORK=tunnelnet\nAVANTA_MASTER_KEY=sleutel-van-de-testomgeving\nPOSTGRES_PASSWORD=wachtwoord-van-de-testomgeving\n');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
  git(work, 'checkout', '-q', '-B', 'main');

  /**
   * Maakt een commit op een branch met de echte stagingbestanden en een kenmerk.
   * @param {string} branch Branch.
   * @param {string} mark Inhoud die de commit uniek maakt.
   * @returns {string} De commit.
   */
  const commit = (branch, mark) => {
    git(work, 'checkout', '-q', '-B', branch);
    fs.mkdirSync(path.join(work, 'deploy', 'staging'), { recursive: true });
    fs.mkdirSync(path.join(work, 'deploy', 'apps01'), { recursive: true });
    for (const name of ['compose.yml', '.env.example', 'install-staging.sh']) fs.copyFileSync(path.join(STAGING, name), path.join(work, 'deploy', 'staging', name));
    fs.writeFileSync(path.join(work, 'deploy', 'apps01', 'app-rol.sql'), '-- rol van de app\n');
    fs.writeFileSync(path.join(work, 'kenmerk.txt'), mark);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', mark);
    git(work, 'push', '-q', 'origin', branch);
    return git(work, 'rev-parse', 'HEAD');
  };

  // Nep-docker: legt alles vast; `inspect` geeft het IP van cloudflared, een telling van reizen komt uit een bestand,
  // en bouwen mislukt voor de commit in `fail-build`.
  fs.writeFileSync(path.join(bin, 'docker'), [
    '#!/usr/bin/env bash',
    'case "$1" in',
    '  inspect) echo "172.20.0.9"; exit 0 ;;',
    '  info) echo "$TEST_DOCKER_ROOT"; exit 0 ;;',
    'esac',
    '[ "$1 $2" = "compose version" ] && exit 0',
    '[ -t 0 ] || cat >/dev/null',
    'echo "docker $*" >> "$CALLS_FILE"',
    'if [ "$1 $2" = "compose build" ] && [ "$(git -C "$BASE_DIR/repo" rev-parse HEAD)" = "$(cat "$TEST_STATE/fail-build" 2>/dev/null)" ]; then exit 1; fi',
    'case "$*" in *"count(*) FROM trips"*) cat "$TEST_STATE/trips" 2>/dev/null || echo 3 ;; esac',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\n[ -e "$TEST_STATE/unhealthy" ] && exit 22\necho \'{"ok":true}\'\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\necho "systemctl $*" >> "$CALLS_FILE"\nexit 0\n', { mode: 0o755 });

  /**
   * Draait install-staging.sh.
   * @param {...string} args Argumenten (bijv. `--timer`).
   * @returns {{status: (number|null), output: string}} Uitgangscode en uitvoer.
   */
  const run = (...args) => {
    const environment = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, BASE_DIR: base, REPO_URL: origin, MAIN_ENV: mainEnv, CALLS_FILE: calls,
      LOCK_FILE: path.join(root, 'lock'), STAGING_TEST_ROOT: systemRoot, TEST_STATE: root, TEST_DOCKER_ROOT: root, HEALTH_TRIES: '2', HEALTH_WAIT: '0', MIN_FREE_GB: '0',
    };
    const out = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: environment });
    return { status: out.status, output: out.stdout + out.stderr };
  };
  const takeCalls = () => {
    const text = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
    fs.rmSync(calls, { force: true });
    return text.split('\n').filter(Boolean);
  };
  const deployed = () => fs.readFileSync(path.join(base, '.deployed-commit'), 'utf8');
  const stagingEnv = () => fs.readFileSync(path.join(base, 'repo', 'deploy', 'staging', '.env'), 'utf8');
  return { root, base, mainEnv, systemRoot, commit, run, takeCalls, deployed, stagingEnv };
}

test('install-staging.sh: eerste installatie met eigen geheimen, volgt main zolang develop niet bestaat', (testContext) => {
  const env = setup(testContext);
  const first = env.commit('main', 'eerste');
  fs.writeFileSync(path.join(env.root, 'trips'), '0\n');
  const mainEnvBefore = fs.readFileSync(env.mainEnv, 'utf8');

  const result = env.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(env.deployed(), first);
  assert.match(result.output, /volgt de branch main/);
  assert.match(result.output, /avanta-staging\.den-hollander\.com/);
  assert.match(result.output, /http:\/\/avanta-staging-app:3400/);

  // Eigen geheimen en de cloudflared van de testomgeving; niets van haar sleutels overgenomen.
  const settings = env.stagingEnv();
  assert.match(settings, /^POSTGRES_PASSWORD=[0-9a-f]{48}$/m);
  assert.match(settings, /^APP_DB_PASSWORD=[0-9a-f]{48}$/m);
  assert.match(settings, /^AVANTA_MASTER_KEY=[0-9a-f]{64}$/m);
  assert.match(settings, /^TUNNEL_NETWORK=tunnelnet$/m);
  assert.match(settings, /^TUNNEL_CONTAINER=tunnel-cloudflared$/m);
  assert.match(settings, /^TRUST_PROXY=172\.20\.0\.9$/m);
  assert.doesNotMatch(settings, /(sleutel|wachtwoord)-van-de-testomgeving/);
  assert.equal(fs.statSync(path.join(env.base, 'repo', 'deploy', 'staging', '.env')).mode & 0o077, 0);
  assert.equal(fs.readFileSync(env.mainEnv, 'utf8'), mainEnvBefore);
  assert.doesNotMatch(result.output, /[0-9a-f]{48}/);

  // Volgorde: bouwen, database, rol, starten; daarna de timer en (lege database) de testdata.
  const calls = env.takeCalls();
  const index = (pattern) => calls.findIndex((line) => pattern.test(line));
  assert.ok(index(/compose build app/) >= 0 && index(/compose build app/) < index(/compose up -d --wait db/), calls.join('\n'));
  assert.ok(index(/compose up -d --wait db/) < index(/psql -q -v ON_ERROR_STOP=1/), calls.join('\n'));
  assert.ok(index(/psql -q -v ON_ERROR_STOP=1/) < index(/compose up -d --remove-orphans/), calls.join('\n'));
  assert.ok(calls.some((line) => /systemctl enable --now avanta-staging-update\.timer/.test(line)), calls.join('\n'));
  assert.ok(calls.some((line) => /node src\/dev\/seed\/cli\.js vullen --testomgeving/.test(line)), calls.join('\n'));
  assert.ok(calls.some((line) => /image prune -f --filter label=nl\.avantareizen\.stack=avanta-staging/.test(line)), calls.join('\n'));
  assert.ok(!calls.some((line) => /label=nl\.avantareizen\.stack=avanta( |$)/.test(line)), 'ruimt geen images van de testomgeving op');
  const unit = fs.readFileSync(path.join(env.systemRoot, 'etc', 'systemd', 'system', 'avanta-staging-update.service'), 'utf8');
  assert.match(unit, /ExecStart=\/usr\/local\/sbin\/avanta-staging-update --timer/);
  assert.ok(fs.existsSync(path.join(env.systemRoot, 'usr', 'local', 'sbin', 'avanta-staging-update')));
});

test('install-staging.sh --timer: niets bij dezelfde commit, develop zodra die bestaat, terugval bij een mislukte commit', (testContext) => {
  const env = setup(testContext);
  const first = env.commit('main', 'eerste');
  assert.equal(env.run().status, 0);
  const secrets = env.stagingEnv();
  env.takeCalls();

  // Zelfde commit en gezond: de timer doet niets.
  let result = env.run('--timer');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(env.takeCalls(), []);

  // develop bestaat: staging stapt over, met dezelfde geheimen en zonder testdata te vullen.
  const second = env.commit('develop', 'tweede');
  result = env.run('--timer');
  assert.equal(result.status, 0, result.output);
  assert.equal(env.deployed(), second);
  assert.match(result.output, /\(develop\)/);
  assert.equal(env.stagingEnv(), secrets);
  assert.ok(!env.takeCalls().some((line) => /seed\/cli\.js/.test(line)));

  // Een commit die niet bouwt: terug naar de vorige, en de timer slaat hem daarna over.
  const third = env.commit('develop', 'derde');
  fs.writeFileSync(path.join(env.root, 'fail-build'), third);
  result = env.run('--timer');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /overgeslagen; staging draait weer op/);
  assert.equal(env.deployed(), second);
  assert.equal(git(path.join(env.base, 'repo'), 'rev-parse', 'HEAD'), second);
  env.takeCalls();
  result = env.run('--timer');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /faalde eerder; overslaan/);
  assert.deepEqual(env.takeCalls(), []);

  // Een nieuwere commit die wel start, wordt weer opgepakt.
  fs.rmSync(path.join(env.root, 'fail-build'));
  const fourth = env.commit('develop', 'vierde');
  assert.notEqual(fourth, first);
  result = env.run('--timer');
  assert.equal(result.status, 0, result.output);
  assert.equal(env.deployed(), fourth);
});

test('install-staging.sh weigert zonder de cloudflared van de testomgeving en bij te weinig ruimte', (testContext) => {
  const env = setup(testContext);
  env.commit('main', 'eerste');
  fs.writeFileSync(env.mainEnv, 'AVANTA_TRACK=main\n');
  const result = env.run();
  assert.equal(result.status, 1);
  assert.match(result.output, /naam of netwerk van de cloudflared-container niet gevonden/);
  assert.equal(fs.existsSync(path.join(env.base, '.deployed-commit')), false);
});

test('de stagingbestanden: geldige bash, eigen projectnaam, nooit vindbaar, image op digest', () => {
  const syntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const compose = fs.readFileSync(path.join(STAGING, 'compose.yml'), 'utf8');
  assert.match(compose, /^name: avanta-staging$/m);
  assert.match(compose, /image: avanta-reizen-staging:local/);
  assert.match(compose, /SITE_INDEXABLE: "false"/);
  assert.match(compose, /aliases: \[avanta-staging-app\]/);
  assert.match(compose, /image: postgres:17@sha256:[0-9a-f]{64}/);
  assert.match(compose, /"127\.0\.0\.1:\$\{APP_PORT:-3401\}:3400"/);
  assert.doesNotMatch(compose, /UPDATE_(STATUS|REQUEST)_DIR/);
});
