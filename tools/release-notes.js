#!/usr/bin/env node
/**
 * Releasenotes per wijziging: leest de kleine bestanden in `changes/`, geeft elk een volgend
 * versienummer en zet de notes in app/package.json en app/CHANGELOG.md.
 * Wordt door .github/workflows/release.yml na een merge op main gedraaid; een PR raakt die
 * twee bestanden zelf niet aan.
 *
 * Gebruik: node tools/release-notes.js                          (verwerkt en verwijdert de bestanden)
 *          node tools/release-notes.js --check                  (controleert alleen of alle bestanden kloppen)
 *          node tools/release-notes.js --pull-request origin/main (controle van een PR, zie version.yml)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHANGES_DIR = path.join(REPO_ROOT, 'changes');
const APP_FOLDER = 'app';
const APP_DIR = path.join(REPO_ROOT, APP_FOLDER);
const PACKAGE_FILE = path.join(APP_DIR, 'package.json');
const CHANGELOG_FILE = path.join(APP_DIR, 'CHANGELOG.md');
const PACKAGE_PATH = `${APP_FOLDER}/package.json`;
const CHANGELOG_PATH = `${APP_FOLDER}/CHANGELOG.md`;
const CHANGELOG_HEADING = /^# Changelog\r?\n\r?\n/;

/**
 * Leest één bestand uit `changes/`: kopregels (titel, optioneel bump), het kopje Nieuws
 * (punten voor gebruikers) en het kopje Changelog (vrije markdown).
 * @param {string} text Inhoud van het bestand.
 * @returns {{title: string, bump: string, items: string[], changelog: string}} De gelezen wijziging.
 * @throws {Error} Als het bestand niet aan het formaat voldoet.
 */
function parseFragment(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(String(text).replace(/^﻿/, ''));
  if (!match) throw new Error('begint niet met een kop tussen --- regels (titel: ...)');
  const header = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (pair) header[pair[1]] = pair[2].trim();
  }
  const title = header.titel || '';
  if (!title) throw new Error('de kop mist "titel:"');
  if (title.length > 120) throw new Error('de titel is langer dan 120 tekens');
  const bump = header.bump || 'patch';
  if (!['patch', 'minor'].includes(bump)) throw new Error('bump mag alleen patch of minor zijn (major doet alleen de beheerder)');

  const sections = { nieuws: '', changelog: '' };
  let current = null;
  for (const line of match[2].split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && ['nieuws', 'changelog'].includes(heading[1].toLowerCase())) {
      current = heading[1].toLowerCase();
    } else if (current) {
      sections[current] += `${line}\n`;
    }
  }
  const items = [];
  for (const line of sections.nieuws.split('\n')) {
    const point = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (point) items.push(point[1]);
  }
  const changelog = sections.changelog.trim();
  if (!changelog) throw new Error('het kopje "## Changelog" is leeg of ontbreekt');
  return { title, bump, items, changelog };
}

/**
 * Berekent het volgende versienummer: patch + 1, na x.y.9 komt x.(y+1).0; met bump minor
 * komt x.(y+1).0. Een major-versie verhoogt alleen de beheerder met de hand.
 * @param {string} version Huidige versie (x.y.z).
 * @param {string} [bump] 'patch' (standaard) of 'minor'.
 * @returns {string} De nieuwe versie.
 */
function nextVersion(version, bump = 'patch') {
  const [major, minor, patch] = String(version).split('.').map(Number);
  if ([major, minor, patch].some((part) => !Number.isInteger(part))) throw new Error(`onbekende versie: ${version}`);
  if (bump === 'minor' || patch >= 9) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Maakt het blok voor CHANGELOG.md: kop met versie, datum en titel, de punten voor gebruikers en de technische notes.
 * @param {string} version Versienummer.
 * @param {string} date Datum (JJJJ-MM-DD).
 * @param {{title: string, items: string[], changelog: string}} fragment De gelezen wijziging.
 * @returns {string} Het blok, afgesloten met een lege regel.
 */
function renderChangelog(version, date, fragment) {
  const news = fragment.items.length ? `${fragment.items.map((item) => `- ${item}`).join('\n')}\n\n` : '';
  return `## ${version} — ${date} — ${fragment.title}\n\n${news}${fragment.changelog}\n\n`;
}

/**
 * Zoekt de wijzigingen op in `changes/` (zonder README), op volgorde van toevoegen.
 * @param {string} [directory] Map met de bestanden.
 * @returns {string[]} Bestandsnamen, oudste eerst.
 */
function listFragments(directory = CHANGES_DIR) {
  if (!fs.existsSync(directory)) return [];
  const names = fs.readdirSync(directory).filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md');
  /**
   * Tijdstip waarop het bestand voor het eerst is toegevoegd (git), 0 als dat onbekend is.
   * @param {string} name Bestandsnaam.
   * @returns {number} Unix-tijd in seconden.
   */
  const addedAt = (name) => {
    try {
      const output = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '--', path.join(directory, name)], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return Math.min(...output.split('\n').filter(Boolean).map(Number), Infinity) || 0;
    } catch (_) {
      return 0;
    }
  };
  const times = new Map(names.map((name) => [name, addedAt(name)]));
  return names.sort((left, right) => times.get(left) - times.get(right) || left.localeCompare(right));
}

/**
 * Verwerkt alle wijzigingen: nieuwe versie, notes erin, bestanden weg.
 * @param {{date?: string, directory?: string, packageFile?: string, changelogFile?: string}} [options] Paden en datum (voor tests).
 * @returns {string[]} De nieuwe versies, oudste eerst (leeg als er niets te doen was).
 */
function applyFragments(options = {}) {
  const directory = options.directory || CHANGES_DIR;
  const packageFile = options.packageFile || PACKAGE_FILE;
  const changelogFile = options.changelogFile || CHANGELOG_FILE;
  const date = options.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const names = listFragments(directory);
  if (!names.length) return [];

  const fragments = names.map((name) => {
    try {
      return { name, ...parseFragment(fs.readFileSync(path.join(directory, name), 'utf8')) };
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  });

  let packageText = fs.readFileSync(packageFile, 'utf8');
  let changelog = fs.readFileSync(changelogFile, 'utf8');
  if (!CHANGELOG_HEADING.test(changelog)) throw new Error(`${CHANGELOG_PATH} begint niet met "# Changelog" en een lege regel`);
  let version = JSON.parse(packageText).version;
  const versions = [];
  for (const fragment of fragments) {
    version = nextVersion(version, fragment.bump);
    versions.push(version);
    packageText = packageText.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
    changelog = changelog.replace(CHANGELOG_HEADING, (heading) => heading + renderChangelog(version, date, fragment));
  }
  fs.writeFileSync(packageFile, packageText);
  fs.writeFileSync(changelogFile, changelog);
  for (const name of names) fs.unlinkSync(path.join(directory, name));
  return versions;
}

/**
 * Controleert alle bestanden in `changes/` zonder iets te wijzigen.
 * @param {string} [directory] Map met de bestanden.
 * @returns {string[]} Foutmeldingen (leeg als alles klopt).
 */
function checkFragments(directory = CHANGES_DIR) {
  const problems = [];
  for (const name of listFragments(directory)) {
    try {
      parseFragment(fs.readFileSync(path.join(directory, name), 'utf8'));
    } catch (error) {
      problems.push(`changes/${name}: ${error.message}`);
    }
  }
  return problems;
}

/** Label waarmee een PR bij uitzondering bestaande tekst in de changelog mag verbeteren (geen nieuwe notes). */
const CHANGELOG_CORRECTION_LABEL = 'changelog-correctie';
const VERSION_HEADING = /^## \d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}/;

/**
 * Controleert dat een correctie van de changelog alleen bestaande tekst verbetert: evenveel regels en dezelfde
 * versies met dezelfde datums op dezelfde plek. Nieuwe notes of een versie erbij of eraf horen niet in een correctie.
 * @param {string} before Inhoud van de changelog op de basis.
 * @param {string} after Inhoud van de changelog in de PR.
 * @returns {string[]} Foutmeldingen (leeg als de correctie in orde is).
 */
function checkChangelogCorrection(before, after) {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  if (oldLines.length !== newLines.length) {
    return [`${CHANGELOG_PATH}: een correctie voegt geen regels toe en haalt er geen weg (was ${oldLines.length}, nu ${newLines.length}).`];
  }
  const problems = [];
  oldLines.forEach((line, index) => {
    const oldVersion = (line.match(VERSION_HEADING) || [''])[0];
    const newVersion = (newLines[index].match(VERSION_HEADING) || [''])[0];
    if (oldVersion !== newVersion) problems.push(`${CHANGELOG_PATH} regel ${index + 1}: versie en datum van een release veranderen niet in een correctie.`);
  });
  return problems;
}

/**
 * Beoordeelt de wijzigingen van een pull request (zie .github/workflows/version.yml).
 * @param {{files: {status: string, name: string, similarity?: number}[], versionLineChanged: boolean, labels: string[]}} change Wat de PR wijzigt.
 * @returns {string[]} Foutmeldingen (leeg als de PR in orde is).
 */
function evaluatePullRequest(change) {
  const problems = [];
  // Met het label voor een correctie mag bestaande tekst in de changelog worden verbeterd (zie checkPullRequest).
  const correction = change.labels.includes(CHANGELOG_CORRECTION_LABEL);
  const forbidden = [CHANGELOG_PATH];
  // Een nieuw toegevoegd app/package.json of CHANGELOG.md is het startpunt van de app, geen eigen versiewijziging.
  const startFiles = [PACKAGE_PATH, CHANGELOG_PATH];
  for (const file of change.files) {
    if (file.status === 'R' && file.similarity === 100) continue; // alleen verplaatst, inhoud ongewijzigd
    if (file.status === 'A' && startFiles.includes(file.name)) continue;
    if (file.name === CHANGELOG_PATH && file.status === 'M' && correction) continue;
    if (forbidden.includes(file.name)) problems.push(`${file.name} wordt na het mergen automatisch bijgewerkt; haal deze wijziging uit de PR en zet de notes in changes/<naam>.md.`);
  }
  if (change.versionLineChanged) problems.push(`Het versienummer in ${PACKAGE_PATH} wordt na het mergen automatisch verhoogd; haal die wijziging uit de PR.`);
  const appChanged = change.files.some((file) => file.name.startsWith(`${APP_FOLDER}/`)
    && !forbidden.includes(file.name)
    && !(file.status === 'A' && startFiles.includes(file.name)));
  const hasFragment = change.files.some((file) => file.status !== 'D' && /^changes\/(?!README\.md$)[^/]+\.md$/.test(file.name));
  if (appChanged && !hasFragment && !change.labels.includes('geen-releasenotes')) {
    problems.push('Voeg een bestand changes/<naam>.md toe met de releasenotes (zie changes/README.md), of geef de PR het label "geen-releasenotes" als er niets te melden is.');
  }
  return problems;
}

/**
 * Leest uit git wat de PR wijzigt ten opzichte van de basis en beoordeelt dat.
 * @param {string} baseRef Git-verwijzing van de basisbranch (bijv. origin/main).
 * @returns {string[]} Foutmeldingen.
 */
function checkPullRequest(baseRef) {
  /**
   * Voert een git-opdracht uit in de repository.
   * @param {...string} args Argumenten voor git.
   * @returns {string} De uitvoer.
   */
  const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = git('diff', '--name-status', `${baseRef}...HEAD`).split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status: status[0], name: rest[rest.length - 1], oldName: rest[0], similarity: Number(status.slice(1)) || 0 };
  });
  // Het versienummer vergelijken we met het bestand op de oude plek, zodat een verplaatste map niet als wijziging telt.
  const packageEntry = files.find((file) => file.name === PACKAGE_PATH);
  /**
   * Leest het versienummer uit package.json op een bepaald punt in git.
   * @param {string} ref Git-verwijzing.
   * @param {string} filePath Pad van package.json bij die verwijzing.
   * @returns {(string|null)} Het versienummer, of null als het bestand daar niet bestaat.
   */
  const versionOf = (ref, filePath) => { try { return JSON.parse(git('show', `${ref}:${filePath}`)).version; } catch (_) { return null; } };
  // Bestond package.json nog niet op de basis, dan is dit het startpunt en geen versiewijziging.
  const baseVersion = packageEntry ? versionOf(baseRef, packageEntry.oldName) : null;
  const versionLineChanged = baseVersion !== null && baseVersion !== versionOf('HEAD', packageEntry.name);
  const labels = JSON.parse(process.env.PR_LABELS || '[]');
  const changelogEntry = files.find((file) => file.name === CHANGELOG_PATH && file.status === 'M');
  const correctionProblems = changelogEntry && labels.includes(CHANGELOG_CORRECTION_LABEL)
    ? checkChangelogCorrection(git('show', `${baseRef}:${CHANGELOG_PATH}`), git('show', `HEAD:${CHANGELOG_PATH}`))
    : [];
  return [...evaluatePullRequest({ files, versionLineChanged, labels }), ...correctionProblems, ...checkFragments()];
}

if (require.main === module) {
  const argument = process.argv[2];
  try {
    if (argument === '--check') {
      const problems = checkFragments();
      if (problems.length) throw new Error(problems.join('\n'));
      console.log('Alle bestanden in changes/ zijn in orde.');
    } else if (argument === '--pull-request') {
      const problems = checkPullRequest(process.argv[3]);
      if (problems.length) throw new Error(problems.join('\n'));
      console.log('Releasenotes in orde.');
    } else {
      const versions = applyFragments();
      console.log(versions.length ? `Nieuwe versie(s): ${versions.join(', ')}` : 'Geen wijzigingen in changes/; niets te doen.');
    }
  } catch (error) {
    console.error(`FOUT: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseFragment, nextVersion, renderChangelog, listFragments, applyFragments, checkFragments, evaluatePullRequest, checkChangelogCorrection };
