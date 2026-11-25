// @ts-check
/**
 * Koppeling tussen de server en de bundels van de frontend (`app/web/`, Vite). Vite schrijft per module een bundel met
 * een hash in de naam en een manifest (`web/dist/.vite/manifest.json`); hier wordt per module opgezocht welk script,
 * welke opmaak en welke voorladers de pagina nodig heeft. De bestanden zelf serveert `server.js` onder `/bundel/`.
 *
 * Het manifest wordt één keer gelezen en daarna alleen opnieuw als het bestand veranderd is (na `npm run dev` of een
 * nieuwe bouw). Ontbreekt de uitvoer (de frontend is niet gebouwd), dan geeft `assetsFor` null en toont de pagina een
 * melding in plaats van een leeg scherm.
 */
const fs = require('node:fs');
const path = require('node:path');
const { html } = require('../site/html');

/** Standaardmap met de uitvoer van Vite (in het image: `/app/web/dist`). */
const WEB_DIST_DIR = path.join(__dirname, '..', '..', 'web', 'dist');

/** Publiek pad van de bundels; gelijk aan `PUBLIC_BASE` in `web/vite.config.ts`. */
const BUNDLE_BASE = '/bundel/';

/** Naam van een module: kleine letters, cijfers en streepjes, zoals de map in `web/src/modules/`. */
const MODULE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Bestandsnaam in het manifest: alleen de vorm die Vite schrijft (`assets/<naam>-<hash>.js|css`). */
const ASSET_FILE = /^assets\/[A-Za-z0-9_.-]+\.(js|css)$/;

/**
 * Maakt de lezer van het manifest.
 * @param {{distDir?: string}} [options] Map met de uitvoer (tests geven een eigen map mee).
 * @returns {{assetsFor: (name: string) => ({script: string, styles: string[], preloads: string[]}|null)}} De lezer.
 */
function createWebBundle(options = {}) {
  const manifestFile = path.join(options.distDir || WEB_DIST_DIR, '.vite', 'manifest.json');
  /** @type {{mtimeMs: number, manifest: Record<string, any>}|null} */
  let cached = null;

  /**
   * Het manifest, opnieuw gelezen als het bestand veranderd is; null als het er niet is of niet te lezen is.
   * @returns {Record<string, any>|null} Het manifest.
   */
  const readManifest = () => {
    let stat;
    try {
      stat = fs.statSync(manifestFile);
    } catch {
      cached = null;
      return null;
    }
    if (!cached || cached.mtimeMs !== stat.mtimeMs) {
      try {
        cached = { mtimeMs: stat.mtimeMs, manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')) };
      } catch {
        cached = null;
        return null;
      }
    }
    return cached.manifest;
  };

  /**
   * Zoekt de bestanden van een module op: het script van de ingang, alle opmaak (ook van gedeelde stukken) en de
   * gedeelde stukken om vooraf te laden.
   * @param {string} name Naam van de module (`faq`).
   * @returns {{script: string, styles: string[], preloads: string[]}|null} Publieke paden, of null zonder bundel.
   */
  const assetsFor = (name) => {
    if (!MODULE_NAME.test(name)) return null;
    const manifest = readManifest();
    const entry = manifest && manifest[`src/modules/${name}/main.ts`];
    if (!entry || !entry.isEntry || !ASSET_FILE.test(entry.file)) return null;
    const styles = new Set();
    const preloads = new Set();
    const seen = new Set();
    /**
     * Loopt een stuk en zijn imports af.
     * @param {any} chunk Stuk uit het manifest.
     * @returns {void}
     */
    const visit = (chunk) => {
      for (const css of chunk.css || []) if (ASSET_FILE.test(css)) styles.add(BUNDLE_BASE + css);
      for (const key of chunk.imports || []) {
        const imported = manifest[key];
        if (!imported || seen.has(key)) continue;
        seen.add(key);
        if (ASSET_FILE.test(imported.file)) preloads.add(BUNDLE_BASE + imported.file);
        visit(imported);
      }
    };
    visit(entry);
    return { script: BUNDLE_BASE + entry.file, styles: [...styles], preloads: [...preloads] };
  };

  return { assetsFor };
}

/**
 * De koppen voor de bundel van een module in de `<head>` van de pagina: opmaak, voorladers en het script als module
 * (wordt na het lezen van de pagina uitgevoerd). Geen inline script of opmaak: de CSP blijft gelijk.
 * @param {{script: string, styles: string[], preloads: string[]}|null|undefined} assets Bestanden uit `assetsFor`.
 * @returns {any} HTML, of leeg.
 */
function renderBundleHead(assets) {
  if (!assets) return '';
  return html`${assets.styles.map((href) => html`
  <link rel="stylesheet" href="${href}">`)}${assets.preloads.map((href) => html`
  <link rel="modulepreload" href="${href}">`)}
  <script type="module" src="${assets.script}"></script>`;
}

/**
 * Het koppelpunt van een module in het midden van de pagina. Zonder bundel een melding in plaats van een leeg scherm.
 *
 * Met `preload` gaan de antwoorden van de GET-verzoeken van het eerste scherm mee in de pagina (attribuut
 * `data-voorgeladen`, JSON per pad binnen `/app/api`, ge-escapet door `html`): het scherm hoeft dan niet eerst op een
 * extra verzoek te wachten (`web/src/api/preload.ts`). Alleen voor wat de route zelf met hetzelfde recht mag lezen.
 * @param {{name: string, base: string, available: boolean, preload?: Record<string, any>}} mount Naam, basispad (onder
 *   `/app/`, eindigt op `/`), of de bundel er is en eventueel de voorgeladen antwoorden.
 * @returns {any} HTML.
 */
function renderMountPoint(mount) {
  if (!mount.available) {
    return html`<p class="form-alert" role="alert">Dit scherm is niet beschikbaar: de nieuwe schermen zijn niet meegebouwd. Meld dit aan de beheerder.</p>`;
  }
  const preload = mount.preload && Object.keys(mount.preload).length ? html` data-voorgeladen="${JSON.stringify(mount.preload)}"` : '';
  return html`<div id="crm-app" data-module="${mount.name}" data-base="${mount.base}"${preload}><p class="crm-empty">Laden…</p></div>
    <noscript><p class="form-alert">Dit scherm werkt alleen met JavaScript.</p></noscript>`;
}

module.exports = { createWebBundle, renderBundleHead, renderMountPoint, WEB_DIST_DIR, BUNDLE_BASE };
