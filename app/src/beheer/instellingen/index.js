/**
 * De groepen van Beheer op volgorde van de zijbalk. Elke groep staat in een eigen bestand met haar instellingen
 * (`FIELDS`) en haar secties (`GROUP`). Een nieuwe instelling of sectie komt in het bestand van haar groep; dit
 * bestand verandert alleen bij een nieuwe groep.
 */
const SETTING_GROUPS = [
  require('./systeem'),
  require('./organisatie'),
  require('./e-mail'),
  require('./crm'),
  require('./toegang-en-beveiliging'),
  require('./back-ups-en-herstel'),
  require('./vindbaarheid'),
];

/**
 * Voegt de instellingen van alle groepen samen tot één lijst en weigert een naam die twee keer voorkomt (dan zou de
 * ene groep stilletjes de instelling van de andere overschrijven).
 * @param {object[]} fieldSets De `FIELDS` van elke groep.
 * @returns {object} Alle instellingen, naam → beschrijving.
 */
function mergeFields(fieldSets) {
  const merged = {};
  for (const fields of fieldSets) {
    for (const [key, definition] of Object.entries(fields)) {
      if (Object.hasOwn(merged, key)) throw new Error(`instelling ${key} staat in twee groepen`);
      merged[key] = definition;
    }
  }
  return merged;
}

module.exports = { SETTING_GROUPS, mergeFields };
