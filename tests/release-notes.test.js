/**
 * Tests voor tools/release-notes.js: fragmenten lezen, versie ophogen, verwerken en de PR-controle.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const notes = require('../tools/release-notes.js');

const FRAGMENT = '---\ntitel: Zoeken op bestemming\n---\n\n## Nieuws\n- Je kunt zoeken op bestemming.\n\n## Changelog\nNieuwe zoekroute.\n';

test('parseFragment leest titel, punten en changelog', () => {
  const fragment = notes.parseFragment(FRAGMENT);
  assert.equal(fragment.title, 'Zoeken op bestemming');
  assert.equal(fragment.bump, 'patch');
  assert.deepEqual(fragment.items, ['Je kunt zoeken op bestemming.']);
  assert.equal(fragment.changelog, 'Nieuwe zoekroute.');
});

test('parseFragment weigert een fragment zonder changelog, titel of met major', () => {
  assert.throws(() => notes.parseFragment('---\ntitel: x\n---\n## Nieuws\n- a\n'), /Changelog/);
  assert.throws(() => notes.parseFragment('---\nbump: patch\n---\n## Changelog\na\n'), /titel/);
  assert.throws(() => notes.parseFragment('---\ntitel: x\nbump: major\n---\n## Changelog\na\n'), /bump/);
  assert.throws(() => notes.parseFragment('geen kop'), /kop/);
});

test('nextVersion: patch, overloop na 9 en minor', () => {
  assert.equal(notes.nextVersion('0.1.0'), '0.1.1');
  assert.equal(notes.nextVersion('0.1.9'), '0.2.0');
  assert.equal(notes.nextVersion('1.4.3', 'minor'), '1.5.0');
  assert.throws(() => notes.nextVersion('abc'), /onbekende versie/);
});

test('applyFragments werkt versie en changelog bij en verwijdert de fragmenten', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  const changesDir = path.join(workDir, 'changes');
  fs.mkdirSync(changesDir);
  fs.writeFileSync(path.join(changesDir, 'README.md'), 'uitleg');
  fs.writeFileSync(path.join(changesDir, 'a-zoeken.md'), FRAGMENT);
  fs.writeFileSync(path.join(changesDir, 'b-boeken.md'), '---\ntitel: Boeken\nbump: minor\n---\n## Changelog\nBoekingsflow.\n');
  const packageFile = path.join(workDir, 'package.json');
  const changelogFile = path.join(workDir, 'CHANGELOG.md');
  fs.writeFileSync(packageFile, '{\n  "name": "x",\n  "version": "0.1.0"\n}\n');
  fs.writeFileSync(changelogFile, '# Changelog\n\n## 0.1.0\n\nStart.\n');

  const versions = notes.applyFragments({ directory: changesDir, packageFile, changelogFile, date: '2026-11-19' });

  assert.deepEqual(versions, ['0.1.1', '0.2.0']);
  assert.equal(JSON.parse(fs.readFileSync(packageFile, 'utf8')).version, '0.2.0');
  const changelog = fs.readFileSync(changelogFile, 'utf8');
  assert.ok(changelog.indexOf('## 0.2.0 — 2026-11-19 — Boeken') < changelog.indexOf('## 0.1.1 — 2026-11-19 — Zoeken op bestemming'));
  assert.match(changelog, /- Je kunt zoeken op bestemming\./);
  assert.deepEqual(fs.readdirSync(changesDir), ['README.md']);
});

test('evaluatePullRequest: app-wijziging zonder fragment faalt, met label of fragment slaagt', () => {
  const appFile = { status: 'M', name: 'app/server.js' };
  assert.equal(notes.evaluatePullRequest({ files: [appFile], versionLineChanged: false, labels: [] }).length, 1);
  assert.deepEqual(notes.evaluatePullRequest({ files: [appFile], versionLineChanged: false, labels: ['geen-releasenotes'] }), []);
  assert.deepEqual(notes.evaluatePullRequest({ files: [appFile, { status: 'A', name: 'changes/x.md' }], versionLineChanged: false, labels: [] }), []);
  assert.deepEqual(notes.evaluatePullRequest({ files: [{ status: 'M', name: 'README.md' }], versionLineChanged: false, labels: [] }), []);
});

test('evaluatePullRequest: eigen versie- of changelogwijziging faalt', () => {
  const problems = notes.evaluatePullRequest({
    files: [{ status: 'M', name: 'app/CHANGELOG.md' }, { status: 'A', name: 'changes/x.md' }],
    versionLineChanged: true,
    labels: [],
  });
  assert.equal(problems.length, 2);
});

test('evaluatePullRequest: nieuw toegevoegd package.json en CHANGELOG.md zijn het startpunt', () => {
  const problems = notes.evaluatePullRequest({
    files: [{ status: 'A', name: 'app/package.json' }, { status: 'A', name: 'app/CHANGELOG.md' }],
    versionLineChanged: false,
    labels: [],
  });
  assert.deepEqual(problems, []);
});

test('changelog-correctie: met het label mag bestaande tekst in de changelog wijzigen, zonder label niet', () => {
  const files = [{ status: 'M', name: 'app/CHANGELOG.md' }];
  assert.equal(notes.evaluatePullRequest({ files, versionLineChanged: false, labels: [] }).length, 1);
  assert.deepEqual(notes.evaluatePullRequest({ files, versionLineChanged: false, labels: ['changelog-correctie'] }), []);
  // Het label staat geen eigen versieverhoging toe.
  assert.equal(notes.evaluatePullRequest({ files, versionLineChanged: true, labels: ['changelog-correctie'] }).length, 1);
});

test('checkChangelogCorrection: alleen tekst verbeteren; geen regels erbij of eraf en geen andere versie of datum', () => {
  const before = '# Changelog\n\n## 1.2.3 — 2026-11-21 — Oude titel\n\n- regel met een fout\n';
  assert.deepEqual(notes.checkChangelogCorrection(before, before.replace('Oude titel', 'Nieuwe titel').replace('een fout', 'verbetering')), []);
  assert.equal(notes.checkChangelogCorrection(before, `${before}- extra regel\n`).length, 1);
  assert.equal(notes.checkChangelogCorrection(before, before.replace('1.2.3', '1.2.4')).length, 1);
  assert.equal(notes.checkChangelogCorrection(before, before.replace('2026-11-21', '2026-11-22')).length, 1);
});
