/**
 * Verwerking van geüploade foto's voor de fotobibliotheek (CMS-pakket F): het soort bestand bepalen op de inhoud
 * (magic bytes, nooit op naam of opgegeven type), daarna met `sharp` rechtop zetten, verkleinen naar vaste breedtes en
 * opslaan als WebP. `sharp` neemt standaard geen metadata over, dus EXIF (camera, GPS-locatie) en XMP verdwijnen (AVG).
 */
const sharp = require('sharp');

/** Breedtes van de varianten in pixels, oplopend. Een foto wordt nooit vergroot. */
const VARIANT_WIDTHS = [400, 800, 1600, 2400];

/** Maximale grootte van één geüpload bestand in bytes. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Maximaal aantal pixels van een invoerbestand (tegen "decompressiebommen"). */
const MAX_INPUT_PIXELS = 60_000_000;

/** Kleinste zijde in pixels die we accepteren. */
const MIN_SIDE = 200;

/** Kwaliteit van de WebP-bestanden. */
const WEBP_QUALITY = 82;

/**
 * Bepaalt het soort afbeelding aan de eerste bytes van het bestand.
 * @param {Buffer} buffer Inhoud van het bestand.
 * @returns {(string|null)} 'jpeg', 'png' of 'webp', of null als het geen ondersteunde afbeelding is.
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Een foutmelding voor de gebruiker, met een vaste code voor tests en het logboek.
 */
class ImageError extends Error {
  /**
   * @param {string} code Vaste code (bijv. 'soort', 'te-groot').
   * @param {string} message Melding voor op het scherm.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * De breedtes waarin een foto met deze breedte wordt opgeslagen: alle vaste breedtes die kleiner zijn, plus de foto
 * zelf als die smaller is dan de grootste vaste breedte.
 * @param {number} width Breedte van de (rechtgezette) foto.
 * @returns {number[]} Breedtes, oplopend, minstens één.
 */
function variantWidthsFor(width) {
  const widths = VARIANT_WIDTHS.filter((candidate) => candidate < width);
  if (width <= VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]) widths.push(width);
  else widths.push(VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]);
  return [...new Set(widths)];
}

/**
 * Verwerkt een geüploade foto: controleert soort en afmetingen en maakt de WebP-varianten zonder metadata.
 * @param {Buffer} buffer Inhoud van het bestand.
 * @returns {Promise<{width: number, height: number, variants: {width: number, height: number, data: Buffer}[]}>}
 *   Afmetingen van de grootste variant en alle varianten (oplopend).
 * @throws {ImageError} Bij een onbekend soort, een te groot of beschadigd bestand of een te kleine foto.
 */
async function processImage(buffer) {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ImageError('te-groot', `Het bestand is groter dan ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const type = detectImageType(buffer);
  if (!type) throw new ImageError('soort', 'Alleen JPEG-, PNG- en WebP-foto\'s zijn toegestaan.');
  const input = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
  let metadata;
  try {
    metadata = await input().metadata();
  } catch {
    throw new ImageError('beschadigd', 'Het bestand is geen leesbare foto.');
  }
  // De inhoud moet echt het soort zijn dat de eerste bytes beloven.
  if (metadata.format !== type) throw new ImageError('soort', 'Alleen JPEG-, PNG- en WebP-foto\'s zijn toegestaan.');
  if (!metadata.width || !metadata.height) throw new ImageError('beschadigd', 'Het bestand is geen leesbare foto.');
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) throw new ImageError('te-groot', 'De foto heeft te veel pixels (maximaal 60 megapixel).');
  // EXIF-oriëntatie 5 t/m 8: breedte en hoogte wisselen na het rechtzetten.
  const turned = (metadata.orientation || 1) >= 5;
  const width = turned ? metadata.height : metadata.width;
  const height = turned ? metadata.width : metadata.height;
  if (Math.min(width, height) < MIN_SIDE) throw new ImageError('te-klein', `De foto is te klein (minimaal ${MIN_SIDE} pixels aan elke zijde).`);
  const variants = [];
  try {
    for (const target of variantWidthsFor(width)) {
      const { data, info } = await input().rotate().resize({ width: target, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
      variants.push({ width: info.width, height: info.height, data });
    }
  } catch {
    throw new ImageError('beschadigd', 'Het bestand is geen leesbare foto.');
  }
  const largest = variants[variants.length - 1];
  return { width: largest.width, height: largest.height, variants };
}

/**
 * Maakt een kleinere WebP-variant van een (al verwerkte) foto, bijvoorbeeld bij het herstellen van bestanden uit de
 * database. Zonder metadata, net als bij het uploaden.
 * @param {Buffer} buffer WebP van de grootste variant.
 * @param {number} width Gewenste breedte (nooit groter dan het origineel).
 * @returns {Promise<Buffer>} WebP.
 */
function resizeWebp(buffer, width) {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
}

/**
 * Leest de breedte van een (al verwerkte) WebP, bijvoorbeeld om een bestaand bestand in de database te zetten.
 * @param {Buffer} buffer Inhoud van het bestand.
 * @returns {Promise<(number|null)>} Breedte in pixels, of null als het geen leesbare WebP binnen de limieten is.
 */
async function webpWidth(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_UPLOAD_BYTES || detectImageType(buffer) !== 'webp') return null;
  try {
    const metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    return metadata.format === 'webp' && metadata.width ? metadata.width : null;
  } catch {
    return null;
  }
}

/** Grootste importfoto die in de database (back-up) gaat; gelijk aan de grens van de import zelf. */
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
/** Formaten die de import van de oude site binnenhaalt (zie `tools/import-wordpress.js`). */
const IMPORT_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

/**
 * Leest de breedte van een foto uit de import van de oude site (JPEG, PNG, WebP of GIF, ongewijzigd opgeslagen), om
 * hem als kopie in de database te zetten. Alleen lezen, niets omzetten: de kopie is byte voor byte het bestand.
 * @param {Buffer} buffer Inhoud van het bestand.
 * @returns {Promise<(number|null)>} Breedte in pixels, of null als het geen leesbare foto binnen de limieten is.
 */
async function importImageWidth(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMPORT_BYTES) return null;
  try {
    const metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    return IMPORT_FORMATS.has(metadata.format) && metadata.width ? metadata.width : null;
  } catch {
    return null;
  }
}

module.exports = { processImage, resizeWebp, webpWidth, importImageWidth, MAX_IMPORT_BYTES, detectImageType, variantWidthsFor, ImageError, VARIANT_WIDTHS, MAX_UPLOAD_BYTES, MAX_INPUT_PIXELS, MIN_SIDE };
