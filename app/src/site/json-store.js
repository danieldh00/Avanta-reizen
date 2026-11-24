// @ts-check
/**
 * Leest eenmalig een JSON-bestand in DATA_DIR met vaste inhoud van de huidige site (`homepage.json`,
 * `site-content.json`). Die bestanden zijn alleen nog bron voor de overname naar de database (`content-transfer.js`);
 * de site leest ze niet meer.
 */
const fs = require('node:fs');

/**
 * Leest en controleert één JSON-bestand.
 * @param {string} file Volledig pad van het bestand.
 * @param {(data: *) => object} normalize Controleert de ingelezen inhoud.
 * @returns {object|null} De gecontroleerde inhoud, of null als het bestand ontbreekt of kapot is.
 */
function readJsonFile(file, normalize) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null; // Ontbreekt of kapot: er valt niets over te zetten.
  }
  return normalize(data);
}

module.exports = { readJsonFile };
