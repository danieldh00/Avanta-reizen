// @ts-check
/**
 * Verkleint de publieke CSS en JavaScript voor het image (plan PR 6.6). Alleen voor het bouwen: de Dockerfile draait
 * dit script in een aparte bouwstap en zet de verkleinde bestanden over de bron heen in het image. De bron in
 * `app/public/` blijft leesbaar en wordt nooit overschreven; lokaal en in de tests draait de app op die bron.
 *
 * Gebruik: `node tools/minify-public.js <bronmap> <doelmap>`, bijvoorbeeld `node tools/minify-public.js public
 * public-min`. Het script schrijft per `.css`- en `.js`-bestand onder `<bronmap>/css` en `<bronmap>/js` een verkleinde
 * versie op hetzelfde relatieve pad onder `<doelmap>` en toont de grootte vooraf en achteraf. Een bestand dat niet te
 * verwerken is laat het bouwen mislukken: liever geen image dan een kapotte site.
 *
 * Het hulpmiddel is esbuild (alleen een ontwikkelafhankelijkheid, niet in de draaiende app). Er wordt niets gebundeld
 * of omgezet: `url()`-verwijzingen, de volgorde van de regels en de syntaxis blijven zoals in de bron, alleen spaties,
 * commentaar en lokale namen worden korter.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Mappen onder de bronmap die worden verkleind, met de esbuild-lader per extensie. */
const ASSET_DIRS = ['css', 'js'];
const LOADERS = { '.css': 'css', '.js': 'js' };

/**
 * Zoekt de te verkleinen bestanden: alle `.css` en `.js` direct in de mappen uit `ASSET_DIRS` (geen submappen, die
 * zijn er niet).
 * @param {string} sourceDir Bronmap (bijvoorbeeld `public`).
 * @returns {string[]} Relatieve paden, gesorteerd (bijvoorbeeld `css/site.css`).
 */
function listAssets(sourceDir) {
  const found = [];
  for (const dir of ASSET_DIRS) {
    const full = path.join(sourceDir, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && LOADERS[path.extname(entry.name)]) found.push(path.posix.join(dir, entry.name));
    }
  }
  return found.sort();
}

/**
 * Verkleint één bestand. Commentaar verdwijnt helemaal (ook `/*!`-licentieblokken: alle code is eigen code), tekens
 * buiten ASCII blijven leesbaar staan in plaats van als escape.
 * @param {string} code Inhoud van het bronbestand.
 * @param {('css'|'js')} loader Soort bestand.
 * @param {string} name Naam voor foutmeldingen.
 * @returns {Promise<string>} Verkleinde inhoud.
 */
async function minifyCode(code, loader, name) {
  const esbuild = require('esbuild');
  const result = await esbuild.transform(code, { loader, minify: true, legalComments: 'none', charset: 'utf8', sourcefile: name, logLevel: 'silent' });
  return result.code;
}

/**
 * Verkleint alle publieke CSS en JavaScript van `sourceDir` naar `targetDir`. De bronmap wordt alleen gelezen; een
 * doelmap gelijk aan (of binnen) de bronmap weigert het script, zodat de leesbare bron nooit verloren gaat.
 * @param {string} sourceDir Bronmap.
 * @param {string} targetDir Doelmap (wordt aangemaakt).
 * @returns {Promise<Array<{file: string, before: number, after: number}>>} Grootte per bestand in bytes.
 */
async function minifyPublic(sourceDir, targetDir) {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('de doelmap mag niet in de bronmap liggen');
  const results = [];
  for (const file of listAssets(source)) {
    const code = fs.readFileSync(path.join(source, file), 'utf8');
    const minified = await minifyCode(code, LOADERS[path.extname(file)], file);
    const out = path.join(target, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, minified);
    results.push({ file, before: Buffer.byteLength(code), after: Buffer.byteLength(minified) });
  }
  return results;
}

/**
 * Maakt een leesbaar overzicht van de meting (per bestand en totaal).
 * @param {Array<{file: string, before: number, after: number}>} results Uitkomst van `minifyPublic`.
 * @returns {string} Tekst met één regel per bestand.
 */
function formatReport(results) {
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const line = (label, before, after) => `${label.padEnd(18)} ${kb(before).padStart(9)} -> ${kb(after).padStart(9)} (-${Math.round((1 - after / before) * 100)}%)`;
  const before = results.reduce((sum, row) => sum + row.before, 0);
  const after = results.reduce((sum, row) => sum + row.after, 0);
  return [...results.map((row) => line(row.file, row.before, row.after)), line('totaal', before, after)].join('\n');
}

if (require.main === module) {
  const [sourceDir, targetDir] = process.argv.slice(2);
  if (!sourceDir || !targetDir) {
    console.error('Gebruik: node tools/minify-public.js <bronmap> <doelmap>');
    process.exit(2);
  }
  minifyPublic(sourceDir, targetDir).then(
    (results) => console.log(formatReport(results)),
    (error) => {
      console.error(`Verkleinen mislukt: ${error.message}`);
      process.exit(1);
    },
  );
}

module.exports = { listAssets, minifyCode, minifyPublic, formatReport };
