// @ts-check
/**
 * *Wat is er nieuw*: de wijzigingen in de app per versie, gelezen uit de changelog die de release zelf bijhoudt
 * (`app/CHANGELOG.md`, geschreven door `tools/release-notes.js`). Er is geen tweede bron. Per versie staan eerst de
 * punten voor gebruikers (kopje *Nieuws* van het releasefragment) en daarna de technische beschrijving; die twee
 * blokken zijn in de changelog gescheiden door een lege regel. De technische punten ziet alleen wie het recht
 * `systeem` heeft. Het bestand wordt opnieuw gelezen zodra het verandert (na een update).
 */
const fs = require('node:fs');
const path = require('node:path');
const { html } = require('../site/html');

/** De changelog naast `package.json` (in het image `/app/CHANGELOG.md`). */
const CHANGELOG_FILE = path.join(__dirname, '..', '..', 'CHANGELOG.md');

/** Grenzen, zodat een kapot of heel groot bestand de pagina niet onbruikbaar maakt. */
const LIMITS = { bytes: 2_000_000, releases: 200, items: 40, text: 2000, title: 200 };

/**
 * @typedef {{version: string, date: string, title: string, news: string[], details: string[]}} Release
 */

/**
 * Zet de regels van één blok om naar punten: een regel die met `- ` of `* ` begint is een nieuw punt, elke andere
 * regel hoort bij het vorige punt; tekst zonder punt ervoor is één punt.
 * @param {string[]} lines Regels van het blok.
 * @returns {string[]} Punten (ingekort tot `LIMITS.text`).
 */
function blockItems(lines) {
  /** @type {string[]} */
  const items = [];
  for (const line of lines) {
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) items.push(bullet[1].trim());
    else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
    else items.push(line.trim());
  }
  return items.map((item) => item.slice(0, LIMITS.text)).filter(Boolean).slice(0, LIMITS.items);
}

/**
 * Is dit blok het nieuws voor gebruikers? Dat zijn alleen punten van één regel (de release zet elk nieuwspunt op één
 * regel); de technische beschrijving heeft ingesprongen vervolgregels of gewone tekst.
 * @param {string[]} lines Regels van het blok.
 * @returns {boolean} Waar als alle regels een punt zijn.
 */
function isNewsBlock(lines) {
  return lines.length > 0 && lines.every((line) => /^[-*]\s+\S/.test(line));
}

/**
 * Leest de changelog: kopjes `## <versie> — <datum> — <titel>`, daaronder het nieuws en de technische punten.
 * Het eerste blok is nieuws als er daarna nog een blok volgt en het alleen uit punten van één regel bestaat.
 * @param {string} text Inhoud van de changelog.
 * @returns {Release[]} Versies, nieuwste eerst (zoals in het bestand).
 */
function parseReleaseNotes(text) {
  /** @type {Release[]} */
  const releases = [];
  /** @type {string[][]} */
  let blocks = [];
  /** @type {Release|null} */
  let current = null;
  const finish = () => {
    if (!current) return;
    const filled = blocks.filter((block) => block.length);
    const hasNews = filled.length > 1 && isNewsBlock(filled[0]);
    current.news = hasNews ? blockItems(filled[0]) : [];
    current.details = blockItems((hasNews ? filled.slice(1) : filled).flat());
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = /^##\s+(\d{1,4}\.\d{1,4}\.\d{1,4})\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*(?:[—–-]\s*(.*))?$/.exec(line);
    if (heading) {
      finish();
      if (releases.length >= LIMITS.releases) { current = null; break; }
      current = { version: heading[1], date: heading[2] || '', title: (heading[3] || '').trim().slice(0, LIMITS.title), news: [], details: [] };
      releases.push(current);
      blocks = [[]];
      continue;
    }
    if (!current) continue;
    if (/^#/.test(line)) { finish(); current = null; continue; }
    if (!line.trim()) blocks.push([]);
    else blocks[blocks.length - 1].push(line);
  }
  finish();
  return releases;
}

/**
 * Maakt een lezer van de changelog die het bestand alleen opnieuw leest als het is gewijzigd.
 * @param {string} [file] Pad naar de changelog (standaard `app/CHANGELOG.md`).
 * @returns {() => Release[]} Geeft de versies; een ontbrekend of onleesbaar bestand geeft een lege lijst.
 */
function createChangelogReader(file = CHANGELOG_FILE) {
  /** @type {{key: string, releases: Release[]}} */
  let cache = { key: '', releases: [] };
  return () => {
    try {
      const stats = fs.statSync(file);
      const key = `${stats.mtimeMs}:${stats.size}`;
      if (key !== cache.key) {
        const text = stats.size > LIMITS.bytes ? '' : fs.readFileSync(file, 'utf8');
        cache = { key, releases: parseReleaseNotes(text) };
      }
      return cache.releases;
    } catch {
      return [];
    }
  };
}

/**
 * Tekst van een punt met `code` tussen backticks als `<code>`, **vet** en *cursief*; al het andere ge-escapet.
 * @param {string} text Tekst.
 * @returns {object} HTML.
 */
function inlineText(text) {
  return String(text).split(/`([^`]+)`/).map((part, index) => (index % 2
    ? html`<code>${part}</code>`
    // Buiten code: **vet** en *cursief* zoals in de changelog; de rest als gewone tekst.
    : part.split(/\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/).map((piece, position) => {
      if (piece === undefined) return '';
      if (position % 3 === 1) return html`<strong>${piece}</strong>`;
      if (position % 3 === 2) return html`<em>${piece}</em>`;
      return piece;
    })));
}

/**
 * Datum als `24 november 2026`.
 * @param {string} isoDate Datum `JJJJ-MM-DD`.
 * @returns {string} Datum in het Nederlands, of '' als hij ontbreekt.
 */
function longDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!match) return '';
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || ''} ${match[1]}`.trim();
}

/**
 * De inhoud van de pagina *Wat is er nieuw*.
 * @param {Release[]} releases Versies, nieuwste eerst.
 * @param {{currentVersion: string, showDetails: boolean}} options De draaiende versie en of de technische punten
 *   getoond worden.
 * @returns {object} HTML.
 */
function renderWhatsNew(releases, options) {
  if (!releases.length) return html`<p>Er zijn nog geen wijzigingen om te tonen.</p>`;
  return html`<p class="crm-summary">Je werkt met versie <strong>${options.currentVersion}</strong>. Hieronder staat per versie wat er is veranderd, de nieuwste bovenaan.</p>
    <ol class="crm-news">${releases.map((release) => {
      const details = options.showDetails ? release.details : [];
      const news = release.news.length ? release.news : (options.showDetails ? [] : ['Onderhoud en verbeteringen achter de schermen.']);
      return html`<li class="crm-news__release" id="versie-${release.version}">
        <h2 class="crm-news__title">${release.title || `Versie ${release.version}`}</h2>
        <p class="crm-news__meta">Versie ${release.version}${release.date ? html` · <time datetime="${release.date}">${longDate(release.date)}</time>` : ''}</p>
        ${news.length ? html`<ul class="crm-news__items">${news.map((item) => html`<li>${inlineText(item)}</li>`)}</ul>` : ''}
        ${details.length ? html`<details class="crm-news__details"><summary>Technische details</summary>
          <ul class="crm-news__items">${details.map((item) => html`<li>${inlineText(item)}</li>`)}</ul></details>` : ''}
      </li>`;
    })}</ol>`;
}

module.exports = { parseReleaseNotes, createChangelogReader, renderWhatsNew, longDate, CHANGELOG_FILE };
