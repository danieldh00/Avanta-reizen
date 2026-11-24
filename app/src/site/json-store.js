// @ts-check
/**
 * Lezer voor een JSON-bestand in DATA_DIR met vaste inhoud van de site (zoals `homepage.json`): leest het bestand,
 * controleert de inhoud met een eigen functie en onthoudt de uitkomst tot het bestand verandert (tijd en grootte).
 * Een ontbrekend of kapot bestand geeft de standaard van die controlefunctie (`normalize(null)`).
 */
const fs = require('node:fs');

/**
 * Maakt een lezer voor één JSON-bestand.
 * @param {string} file Volledig pad van het bestand.
 * @param {(data: *) => object} normalize Controleert de ingelezen inhoud (krijgt `null` als het bestand ontbreekt).
 * @returns {{load: Function}} `load()` geeft de gecontroleerde inhoud.
 */
function createJsonFileStore(file, normalize) {
  let cache = null;
  return {
    /**
     * De gecontroleerde inhoud; bij een ontbrekend of kapot bestand de standaard.
     * @returns {object} Inhoud.
     */
    load() {
      let stamp;
      try {
        const stats = fs.statSync(file);
        stamp = `${stats.mtimeMs}:${stats.size}`;
      } catch (_) {
        stamp = 'geen';
      }
      if (cache && cache.stamp === stamp) return cache.value;
      let data = null;
      if (stamp !== 'geen') {
        try {
          data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (_) {
          data = null; // Kapot bestand: de standaard geldt tot de volgende import.
        }
      }
      cache = { stamp, value: normalize(data) };
      return cache.value;
    },
  };
}

module.exports = { createJsonFileStore };
