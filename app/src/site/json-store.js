// @ts-check
/**
 * Leest eenmalig een JSON-bestand in DATA_DIR met vaste inhoud van de huidige site (`homepage.json`,
 * `site-content.json`). Die bestanden zijn alleen nog bron voor de overname naar de database (`content-transfer.js`);
 * de site leest ze niet meer.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Leest en controleert één JSON-bestand.
 * @param {string} file Volledig pad van het bestand.
 * @param {(data: *) => object} normalize Controleert de ingelezen inhoud.
 * @returns {object|null} De gecontroleerde inhoud, of null als het bestand ontbreekt of kapot is (dat laatste met een
 *   melding in het log, zonder inhoud).
 */
function readJsonFile(file, normalize) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`vaste inhoud: ${path.basename(file)} niet leesbaar (${error.code || error.name})`);
    return null; // Ontbreekt: er valt niets over te zetten.
  }
  try {
    return normalize(JSON.parse(text));
  } catch (_) {
    console.error(`vaste inhoud: ${path.basename(file)} is geen geldige JSON en wordt niet overgezet`);
    return null;
  }
}

module.exports = { readJsonFile };
