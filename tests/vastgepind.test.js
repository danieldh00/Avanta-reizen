/**
 * Bewaakt dat de toeleveringsketen vastgepind blijft (P7.2, bevinding A12): elke GitHub Action staat op een volledige
 * commit-SHA en elk container-image (workflows, Dockerfile, docker-compose, deploy-scripts) op een digest. Een tag
 * alleen (`@v4`, `postgres:17`) kan stil naar andere code gaan wijzen; Renovate werkt de vaste waarden bij.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

/** `uses:` met een volledige SHA van 40 tekens (lokale acties met `./` tellen niet). */
const PINNED_ACTION = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}(\s+#.*)?$/;
/** Een image-verwijzing met digest. */
const PINNED_IMAGE = /@sha256:[0-9a-f]{64}\b/;
/**
 * Bekende images met een versietag; een verwijzing hiernaar moet een digest hebben. De tag moet op een versie lijken,
 * zodat `postgres://postgres:wachtwoord@…` en `chown node:node` niet meetellen.
 */
const IMAGE_NAMES = /(?<![\w/:@.-])(postgres|node|aquasec\/trivy|zricethezav\/gitleaks|ghcr\.io\/zaproxy\/zaproxy):(?:v?\d[\w.-]*|stable|latest|lts[\w.-]*|alpine[\w.-]*)/g;

/**
 * Leest een bestand als regels met hun nummer.
 * @param {string} file Absoluut pad.
 * @returns {{line: string, number: number}[]} De regels (commentaarregels weggelaten).
 */
function codeLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line));
}

/**
 * Geeft de workflowbestanden.
 * @returns {string[]} Absolute paden.
 */
function workflowFiles() {
  return fs.readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name)).map((name) => path.join(WORKFLOW_DIR, name));
}

/**
 * Zoekt image-verwijzingen zonder digest in een bestand.
 * @param {string} file Absoluut pad.
 * @returns {string[]} Vindplaatsen als `pad:regel verwijzing`.
 */
function unpinnedImages(file) {
  const found = [];
  for (const { line, number } of codeLines(file)) {
    for (const match of line.matchAll(IMAGE_NAMES)) {
      const rest = line.slice(match.index + match[0].length);
      if (!PINNED_IMAGE.test(rest.split(/\s/)[0] || '')) found.push(`${path.relative(ROOT, file)}:${number} ${match[0]}`);
    }
  }
  return found;
}

test('elke GitHub Action staat op een volledige commit-SHA', () => {
  const unpinned = [];
  for (const file of workflowFiles()) {
    for (const { line, number } of codeLines(file)) {
      const match = /^\s*(?:-\s*)?uses:\s*(\S.*)$/.exec(line);
      if (!match || match[1].startsWith('./')) continue;
      if (!PINNED_ACTION.test(match[1].trim())) unpinned.push(`${path.relative(ROOT, file)}:${number} ${match[1].trim()}`);
    }
  }
  assert.deepEqual(unpinned, [], `Actions zonder vaste SHA:\n${unpinned.join('\n')}`);
});

test('elk container-image staat op een digest', () => {
  const files = [
    ...workflowFiles(),
    path.join(ROOT, 'app', 'Dockerfile'),
    path.join(ROOT, 'docker-compose.yml'),
    path.join(ROOT, 'deploy', 'apps01', 'docker-compose.yml'),
    path.join(ROOT, 'deploy', 'staging', 'compose.yml'),
    path.join(ROOT, 'deploy', 'apps01', 'restore-test.sh'),
  ];
  const unpinned = files.flatMap(unpinnedImages);
  assert.deepEqual(unpinned, [], `Images zonder digest:\n${unpinned.join('\n')}`);
});

test('de controle herkent een tag zonder SHA of digest', () => {
  assert.equal(PINNED_ACTION.test('actions/checkout@v4'), false);
  assert.equal(PINNED_ACTION.test('actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0'), true);
  const line = 'image: postgres:17';
  const [match] = line.matchAll(IMAGE_NAMES);
  assert.equal(PINNED_IMAGE.test(line.slice(match.index + match[0].length)), false);
});
