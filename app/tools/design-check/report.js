/**
 * Design-controle, rapport: zet `results.json` van `check.js` om in een Excel-bestand (.xlsx, met de eigen schrijver uit
 * `src/export/xlsx.js`): één regel per bevinding (samengevoegd over pagina's) met het pad van de uitsnede, en een blad
 * met alle gecontroleerde pagina's.
 *
 * Gebruik:
 *   node tools/design-check/report.js /tmp/design/results.json /tmp/design/designcontrole.xlsx
 */
const fs = require('node:fs');
const { createXlsx } = require('../../src/export/xlsx');

/** Leesbare naam per soort controle (zie `page-checks.js`). */
const CHECK_LABEL = {
  overloop: 'Horizontaal overlopen',
  afgekapt: 'Tekst afgekapt',
  ingekort: 'Tekst ingekort (…)',
  overlap: 'Overlap',
  knophoogte: 'Knoppen/velden niet even hoog of niet op één lijn',
  uitlijning: 'Uitlijning (randen net niet gelijk)',
  rand: 'Tekst tegen schermrand',
  afbeelding: 'Afbeelding laadt niet',
  'kleine-tekst': 'Tekst kleiner dan 12 px',
  klikdoel: 'Klikdoel kleiner dan 24 px',
  toegankelijkheid: 'Toegankelijkheid (axe, WCAG 2.1 AA)',
};

/**
 * Bouwt de bladen van het rapport.
 * @param {object} results Inhoud van `results.json`.
 * @returns {Array<{name: string, rows: Array<Array<(string|number)>>}>} Bladen voor `createXlsx`.
 */
function buildSheets(results) {
  const findings = [['Id', 'Onderdeel', 'Soort scherm', 'Venster', 'Soort fout', 'Ernst', 'Omschrijving', 'Element (selector)', "Aantal pagina's", 'Voorbeeld-URL', 'Screenshot']];
  results.findings.forEach((finding, index) => {
    findings.push([
      `A${String(index + 1).padStart(2, '0')}`, finding.area, finding.types.slice(0, 4).join(', '),
      finding.viewport === 'desktop' ? 'desktop (1440 px)' : 'mobiel (375 px)', CHECK_LABEL[finding.check] || finding.check,
      finding.severity, finding.message, finding.selector, finding.count, finding.example, finding.screenshot || '',
    ]);
  });
  const pages = [['Onderdeel', 'URL', 'Soort scherm', 'HTTP-status', 'Metingen', 'Consolefouten']];
  for (const page of results.pages) pages.push([page.area, page.url, page.type, page.status, page.findings, page.consoleErrors.join('; ')]);
  const logins = [['Onderdeel', 'Inlogformulier werkt in de browser', 'HTTP-status formulier']];
  for (const login of results.logins || []) logins.push([login.area, login.viaForm ? 'ja' : 'NEE', login.formStatus]);
  return [
    { name: 'Bevindingen', rows: findings },
    { name: "Gecontroleerde pagina's", rows: pages },
    { name: 'Inloggen', rows: logins },
  ];
}

/**
 * Leest de uitslag en schrijft het Excel-bestand.
 * @returns {void}
 */
function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Gebruik: node tools/design-check/report.js <results.json> <uitvoer.xlsx>');
  const results = JSON.parse(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, createXlsx(buildSheets(results)));
  console.log(`Rapport: ${output} (${results.findings.length} bevindingen, ${results.pages.length} pagina's)`);
}

if (require.main === module) main();

module.exports = { buildSheets };
