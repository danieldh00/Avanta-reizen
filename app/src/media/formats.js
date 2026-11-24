// @ts-check
/**
 * Lichtere formaten van de foto's voor de website. Importfoto's van de oude site staan als origineel (vaak een grote
 * JPEG of PNG) in `DATA_DIR/media`; die blijven ongewijzigd, want de back-up bewaart juist dat bestand. Daarnaast
 * maakt een achtergrondtaak per importfoto WebP-versies in vaste breedtes (`formaten/<naam>-<breedte>.webp`) en van
 * een JPEG een kleinere, opnieuw gecomprimeerde JPEG onder hetzelfde adres (`formaten/<naam>.jpg`). De afgeleide
 * bestanden zijn altijd opnieuw te maken en zitten daarom niet in de back-up.
 *
 * Voor de weergave houdt een index in het geheugen bij welke breedtes er per foto zijn (importfoto's én de
 * WebP-varianten van de fotobibliotheek, `bib-<hex>-<breedte>.webp`). `imageAttributes` en `sizedImageUrl` maken daar
 * `src`/`srcset`/`sizes` en een passend adres voor een achtergrondfoto van; zonder index of zonder versies geven ze
 * gewoon het oorspronkelijke adres terug, zodat de site altijd werkt.
 */
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { html } = require('../site/html');

/** Submap van de mediamap voor de afgeleide bestanden van importfoto's. */
const FORMAT_DIR = 'formaten';

/** Breedtes in pixels van de WebP-versies van een importfoto. Een foto wordt nooit vergroot. */
const IMPORT_WIDTHS = [400, 800, 1600];

/** Kwaliteit van de WebP-versies. */
const WEBP_QUALITY = 80;

/** Kwaliteit en grootste breedte van de opnieuw gecomprimeerde JPEG. */
const JPEG_QUALITY = 80;
const JPEG_MAX_WIDTH = 2000;

/** De nieuwe JPEG wordt alleen gebruikt als hij minstens zoveel kleiner is (factor van het origineel). */
const JPEG_MIN_GAIN = 0.85;

/** Maximaal aantal pixels van een origineel (tegen "decompressiebommen"), gelijk aan de upload. */
const MAX_INPUT_PIXELS = 60_000_000;

/** Onder deze vrije schijfruimte stopt het omzetten (bytes). */
const MIN_FREE_BYTES = 1024 * 1024 * 1024;

/** Pauze tussen twee foto's tijdens het omzetten, zodat de server rustig blijft (ms). */
const PAUSE_MS = 50;

/** Eerste ronde na het starten (ms) en daarna elke dag. */
const FIRST_RUN_MS = 60 * 1000;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Naam van een importfoto (`<20 hex>.<ext>`, zie de import) en van een bibliotheekvariant. */
const IMPORT_NAME = /^([0-9a-f]{20})\.(jpg|png|webp)$/;
const LIBRARY_NAME = /^(bib-[0-9a-f]{16})-(\d{1,5})\.webp$/;
/** Naam van een afgeleid bestand in `formaten/`. */
const FORMAT_WEBP = /^([0-9a-f]{20})-(\d{1,5})\.webp$/;
const FORMAT_JPEG = /^([0-9a-f]{20})\.jpg$/;

/**
 * @typedef {{widths: number[], jpeg: boolean}} ImageEntry Beschikbare versies van één foto.
 */

/**
 * Een lege of gevulde index van de beschikbare versies per foto.
 * @returns {{get: (key: string) => (ImageEntry|undefined), set: (key: string, entry: ImageEntry) => void, replace: (entries: Map<string, ImageEntry>) => void, size: () => number}} Index.
 */
function createImageIndex() {
  /** @type {Map<string, ImageEntry>} */
  let entries = new Map();
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => { entries.set(key, entry); },
    replace: (next) => { entries = next; },
    size: () => entries.size,
  };
}

/** De index die de weergave gebruikt (zie `useImageIndex`). */
let activeIndex = createImageIndex();

/**
 * Stelt de index in die de weergave van de site gebruikt (eenmaal bij het starten van de app).
 * @param {ReturnType<typeof createImageIndex>} index Index.
 * @returns {void}
 */
function useImageIndex(index) {
  activeIndex = index;
}

/**
 * Voegt een gevonden breedte toe aan een index-item in opbouw.
 * @param {Map<string, ImageEntry>} entries Index in opbouw.
 * @param {string} key Sleutel van de foto.
 * @returns {ImageEntry} Het item.
 */
function entryFor(entries, key) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { widths: [], jpeg: false };
    entries.set(key, entry);
  }
  return entry;
}

/**
 * Leest welke versies er op schijf staan: de bibliotheekvarianten in de mediamap en de afgeleide bestanden van
 * importfoto's in `formaten/`.
 * @param {string} mediaDir Mediamap.
 * @returns {Promise<Map<string, ImageEntry>>} Versies per foto, breedtes oplopend.
 */
async function scanFormats(mediaDir) {
  /** @type {Map<string, ImageEntry>} */
  const entries = new Map();
  const list = async (dir) => fs.readdir(dir).catch(() => /** @type {string[]} */ ([]));
  for (const name of await list(mediaDir)) {
    const match = LIBRARY_NAME.exec(name);
    if (match) entryFor(entries, match[1]).widths.push(Number(match[2]));
  }
  for (const name of await list(path.join(mediaDir, FORMAT_DIR))) {
    const webp = FORMAT_WEBP.exec(name);
    if (webp) entryFor(entries, webp[1]).widths.push(Number(webp[2]));
    else if (FORMAT_JPEG.test(name)) entryFor(entries, name.slice(0, 20)).jpeg = true;
  }
  for (const entry of entries.values()) entry.widths.sort((left, right) => left - right);
  return entries;
}

/**
 * Herkent een adres onder `/media/` en geeft de sleutel in de index en de adressen per breedte.
 * @param {string} url Adres van de foto.
 * @returns {({key: string, urlFor: (width: number) => string}|null)} Gegevens, of null voor een ander adres.
 */
function parseMediaUrl(url) {
  const name = /^\/media\/([^/?#]+)$/.exec(String(url || ''))?.[1];
  if (!name) return null;
  const library = LIBRARY_NAME.exec(name);
  if (library) return { key: library[1], urlFor: (width) => `/media/${library[1]}-${width}.webp` };
  const imported = IMPORT_NAME.exec(name);
  if (imported) return { key: imported[1], urlFor: (width) => `/media/${FORMAT_DIR}/${imported[1]}-${width}.webp` };
  return null;
}

/**
 * De beschikbare breedtes van een foto volgens de actieve index.
 * @param {string} url Adres van de foto.
 * @returns {({widths: number[], urlFor: (width: number) => string}|null)} Breedtes en adressen, of null als er geen versies zijn.
 */
function versionsOf(url) {
  const parsed = parseMediaUrl(url);
  const entry = parsed && activeIndex.get(parsed.key);
  if (!parsed || !entry || !entry.widths.length) return null;
  return { widths: entry.widths, urlFor: parsed.urlFor };
}

/**
 * Het adres van de kleinste versie die minstens zo breed is als gevraagd (of de grootste), voor een achtergrondfoto
 * of een plek waar geen `srcset` kan. Zonder versies het oorspronkelijke adres.
 * @param {string} url Adres van de foto.
 * @param {number} width Gewenste breedte in CSS-pixels maal de pixeldichtheid.
 * @returns {string} Adres.
 */
function sizedImageUrl(url, width) {
  const versions = versionsOf(url);
  if (!versions) return url;
  const chosen = versions.widths.find((candidate) => candidate >= width) ?? versions.widths[versions.widths.length - 1];
  return versions.urlFor(chosen);
}

/**
 * De attributen `src`, `srcset` en `sizes` voor een `<img>` (met een spatie ervoor), zodat de browser de passende
 * breedte kiest. Zonder versies alleen `src`.
 * @param {string} url Adres van de foto.
 * @param {string} sizes Waarde van `sizes` (weergegeven breedte per schermbreedte).
 * @param {number} fallbackWidth Breedte voor `src` als de browser `srcset` niet kent.
 * @returns {object} HTML-fragment.
 */
function imageAttributes(url, sizes, fallbackWidth) {
  const versions = versionsOf(url);
  if (!versions) return html` src="${url}"`;
  const srcset = versions.widths.map((width) => `${versions.urlFor(width)} ${width}w`).join(', ');
  return html` src="${sizedImageUrl(url, fallbackWidth)}" srcset="${srcset}" sizes="${sizes}"`;
}

/**
 * Wacht even.
 * @param {number} ms Milliseconden.
 * @returns {Promise<void>}
 */
function pause(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
}

/**
 * Schrijft een bestand via een tijdelijk bestand, zodat een half geschreven bestand nooit wordt uitgeserveerd.
 * @param {string} file Doelbestand.
 * @param {Buffer} data Inhoud.
 * @returns {Promise<void>}
 */
async function writeAtomic(file, data) {
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
}

/**
 * Maakt de afgeleide bestanden van één importfoto. Eerst de JPEG (als die genoeg scheelt), daarna de WebP-versies:
 * een foto met WebP-versies is daarmee klaar.
 * @param {Buffer} original Inhoud van het origineel.
 * @param {string} key Naam zonder extensie.
 * @param {string} formatDir Map voor de afgeleide bestanden.
 * @returns {Promise<ImageEntry>} De gemaakte versies.
 */
async function convertOne(original, key, formatDir) {
  const input = () => sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
  const metadata = await input().metadata();
  const turned = (metadata.orientation || 1) >= 5;
  const width = (turned ? metadata.height : metadata.width) || 0;
  if (!width) throw new Error('geen breedte');
  /** @type {ImageEntry} */
  const entry = { widths: [], jpeg: false };
  if (metadata.format === 'jpeg') {
    const jpeg = await input().rotate().resize({ width: JPEG_MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    if (jpeg.length < original.length * JPEG_MIN_GAIN) {
      await writeAtomic(path.join(formatDir, `${key}.jpg`), jpeg);
      entry.jpeg = true;
    }
  }
  const targets = [...new Set(IMPORT_WIDTHS.map((target) => Math.min(target, width)))];
  for (const target of targets) {
    const { data, info } = await input().rotate().resize({ width: target, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
    await writeAtomic(path.join(formatDir, `${key}-${info.width}.webp`), data);
    entry.widths.push(info.width);
  }
  return entry;
}

/**
 * Maakt het omzetten van importfoto's, de index en de middleware die de lichtere JPEG uitserveert.
 * @param {{db: {query: Function}, mediaDir: string, appLog: {info: Function, error: Function}, statfs?: (dir: string) => Promise<{bavail: number, bsize: number}>, pauseMs?: number}} options Database, mediamap, logboek en (voor tests) een eigen statfs en pauze.
 * @returns {{index: ReturnType<typeof createImageIndex>, reload: () => Promise<number>, convertPending: () => Promise<{converted: number, failed: number, removed: number, stoppedForDisk: boolean}>, runAndLog: () => Promise<void>, middleware: Function, startTimer: () => void}} Dienst.
 */
function createImageFormats(options) {
  const { db, mediaDir, appLog } = options;
  const formatDir = path.join(mediaDir, FORMAT_DIR);
  const statfs = options.statfs || ((dir) => fs.statfs(dir));
  const pauseMs = options.pauseMs ?? PAUSE_MS;
  const index = createImageIndex();
  let running = false;

  /**
   * Leest de index opnieuw van schijf.
   * @returns {Promise<number>} Aantal foto's met versies.
   */
  const reload = async () => {
    index.replace(await scanFormats(mediaDir));
    return index.size();
  };

  /**
   * Of er nog genoeg vrije schijfruimte is om door te gaan.
   * @returns {Promise<boolean>} Waar als er minstens `MIN_FREE_BYTES` vrij is.
   */
  const enoughDisk = async () => {
    const stats = await statfs(mediaDir);
    return stats.bavail * stats.bsize >= MIN_FREE_BYTES;
  };

  /**
   * Verwijdert afgeleide bestanden van importfoto's die niet meer bestaan (en achtergebleven `.tmp`-bestanden).
   * @param {Set<string>} keys Namen (zonder extensie) van de bestaande importfoto's.
   * @returns {Promise<number>} Aantal verwijderde bestanden.
   */
  const removeOrphans = async (keys) => {
    const names = await fs.readdir(formatDir).catch(() => /** @type {string[]} */ ([]));
    let removed = 0;
    for (const name of names) {
      const key = /^([0-9a-f]{20})[-.]/.exec(name)?.[1];
      if (key && keys.has(key) && !name.endsWith('.tmp')) continue;
      await fs.rm(path.join(formatDir, name), { force: true });
      removed++;
    }
    return removed;
  };

  /**
   * Zet alle importfoto's zonder WebP-versies om, één tegelijk. Stopt als de schijf bijna vol raakt. Een foto die
   * niet te lezen is, wordt overgeslagen en geteld.
   * @returns {Promise<{converted: number, failed: number, removed: number, stoppedForDisk: boolean}>} Resultaat.
   */
  const convertPending = async () => {
    const result = { converted: 0, failed: 0, removed: 0, stoppedForDisk: false };
    if (running) return result;
    running = true;
    try {
      await fs.mkdir(formatDir, { recursive: true });
      await reload();
      const rows = await db.query(
        `SELECT local_name FROM media
          WHERE source = 'import' AND content_type IN ('image/jpeg', 'image/png', 'image/webp') ORDER BY id`,
      );
      const keys = new Set();
      for (const row of rows) {
        const match = IMPORT_NAME.exec(row.local_name);
        if (!match) continue;
        keys.add(match[1]);
        if (index.get(match[1])?.widths.length) continue;
        if (!(await enoughDisk())) {
          result.stoppedForDisk = true;
          break;
        }
        try {
          const original = await fs.readFile(path.join(mediaDir, row.local_name));
          index.set(match[1], await convertOne(original, match[1], formatDir));
          result.converted++;
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOSPC') {
            result.stoppedForDisk = true;
            break;
          }
          result.failed++;
        }
        if (pauseMs) await pause(pauseMs);
      }
      if (!result.stoppedForDisk) result.removed = await removeOrphans(keys);
    } finally {
      running = false;
    }
    return result;
  };

  /**
   * Eén ronde met meldingen in het logboek (faalt nooit).
   * @returns {Promise<void>}
   */
  const runAndLog = async () => {
    try {
      const result = await convertPending();
      if (result.converted) appLog.info('fotobibliotheek', `${result.converted} importfoto('s) omgezet naar lichtere formaten`);
      if (result.failed) appLog.error('fotobibliotheek', `${result.failed} importfoto('s) niet om te zetten naar lichtere formaten`);
      if (result.stoppedForDisk) appLog.error('fotobibliotheek', 'omzetten naar lichtere formaten gestopt: minder dan 1 GB vrije schijfruimte');
    } catch (error) {
      appLog.error('fotobibliotheek', `omzetten naar lichtere formaten mislukt (${error.code || error.name})`);
    }
  };

  /**
   * Start de achtergrondtaak: de index meteen inlezen, de eerste ronde na een minuut en daarna dagelijks; de index
   * van de fotobibliotheek elk kwartier opnieuw (nieuwe uploads).
   * @returns {void}
   */
  const startTimer = () => {
    reload().catch(() => {});
    setTimeout(runAndLog, FIRST_RUN_MS).unref();
    setInterval(runAndLog, RUN_INTERVAL_MS).unref();
    setInterval(() => { if (!running) reload().catch(() => {}); }, 15 * 60 * 1000).unref();
  };

  /**
   * Middleware onder `/media`: serveert voor een importfoto in JPEG de lichtere JPEG als die er is. Het adres blijft
   * hetzelfde, zodat ook foto's in geïmporteerde teksten sneller laden.
   * @param {import('express').Request} req Verzoek.
   * @param {import('express').Response} res Antwoord.
   * @param {import('express').NextFunction} next Volgende.
   * @returns {void}
   */
  const middleware = (req, res, next) => {
    const match = /^\/([0-9a-f]{20})\.jpg$/.exec(req.path);
    if (!match || (req.method !== 'GET' && req.method !== 'HEAD') || !index.get(match[1])?.jpeg) return next();
    res.sendFile(`${match[1]}.jpg`, { root: formatDir, maxAge: '30d', dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) next();
    });
  };

  return { index, reload, convertPending, runAndLog, middleware, startTimer };
}

module.exports = {
  createImageFormats, createImageIndex, useImageIndex, imageAttributes, sizedImageUrl, scanFormats, convertOne,
  FORMAT_DIR, IMPORT_WIDTHS,
};
