/**
 * Bewaakt de afspraken rond de integratiebranch `develop` (docs/VUE-OMBOUW.md): de versiecontrole draait ook op PR's
 * naar develop, en de sync maakt altijd een eigen mergecommit en forceert nooit.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_DIR = path.join(__dirname, '..', '.github', 'workflows');

/**
 * Leest een workflowbestand.
 * @param {string} name Bestandsnaam in .github/workflows.
 * @returns {string} De inhoud.
 */
function readWorkflow(name) {
  return fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
}

test('de versiecontrole draait op PR\'s naar main en naar develop', () => {
  assert.match(readWorkflow('version.yml'), /pull_request:\n\s+branches: \[main, develop\]/);
});

test('de sync merget main in develop met een eigen mergecommit en zonder force', () => {
  const workflow = readWorkflow('develop-sync.yml');
  assert.match(workflow, /git merge --no-ff --no-edit -m "main naar develop" origin\/main/);
  assert.match(workflow, /git push origin HEAD:develop/);
  assert.doesNotMatch(workflow, /git push[^\n]*(--force|-f\b)/);
  assert.match(workflow, /git merge --abort/);
});

test('de sync draait na een geslaagde release, elke nacht en op afroep', () => {
  const workflow = readWorkflow('develop-sync.yml');
  assert.match(workflow, /workflow_run:\n\s+workflows: \[Release\]/);
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
});
