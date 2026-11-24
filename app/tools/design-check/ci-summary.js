/**
 * Design-controle in CI: zet `results.json` van `check.js` om in een korte samenvatting in Markdown voor de
 * job-samenvatting van GitHub Actions (aantallen per ernst en de bevindingen, ernstigste eerst). Het volledige rapport
 * (.xlsx met uitsneden) staat in het artefact van de job.
 *
 * Gebruik:
 *   node tools/design-check/ci-summary.js /tmp/design/results.json >> "$GITHUB_STEP_SUMMARY"
 */
const fs = require('node:fs');

/** Zoveel bevindingen komen maximaal in de samenvatting; de rest staat in het rapport. */
const MAX_ROWS = 30;

/** Volgorde van de ernst, ernstigste eerst. */
const SEVERITY_ORDER = ['hoog', 'midden', 'laag'];

/**
 * Maakt tekst veilig voor een cel in een Markdown-tabel (geen `|` of regeleinden, niet te lang).
 * @param {unknown} value Waarde.
 * @returns {string} Tekst voor in de cel.
 */
function cell(value) {
  return String(value ?? '').replace(/[|\r\n]+/g, ' ').replace(/[<>]/g, '').slice(0, 160);
}

/**
 * Bouwt de samenvatting.
 * @param {{pages: object[], findings: object[]}} results Inhoud van `results.json`.
 * @returns {string} Markdown.
 */
function summaryMarkdown(results) {
  const findings = [...(results.findings || [])]
    .sort((first, second) => SEVERITY_ORDER.indexOf(first.severity) - SEVERITY_ORDER.indexOf(second.severity));
  const counts = SEVERITY_ORDER.map((severity) => `${findings.filter((finding) => finding.severity === severity).length} ${severity}`);
  const lines = [
    '## Design-controle (gewijzigde schermen, 1440 en 375 px)',
    '',
    `${(results.pages || []).length} pagina's gecontroleerd; bevindingen: ${counts.join(', ')}. Alleen ernst *hoog* laat de controle falen.`,
    '',
  ];
  if (!findings.length) return `${lines.join('\n')}Geen bevindingen.\n`;
  lines.push('| Ernst | Controle | Venster | Voorbeeld | Melding |', '|---|---|---|---|---|');
  for (const finding of findings.slice(0, MAX_ROWS)) {
    lines.push(`| ${cell(finding.severity)} | ${cell(finding.check)} | ${cell(finding.viewport)} | ${cell(finding.example)} | ${cell(finding.message)} |`);
  }
  if (findings.length > MAX_ROWS) lines.push('', `En nog ${findings.length - MAX_ROWS} bevindingen; zie het rapport in het artefact *design-controle*.`);
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Gebruik: node tools/design-check/ci-summary.js <results.json>');
    process.exitCode = 2;
  } else if (!fs.existsSync(file)) {
    process.stdout.write('## Design-controle\n\nGeen uitslag: de controle is niet tot het einde gekomen (zie het log van de job).\n');
  } else {
    process.stdout.write(summaryMarkdown(JSON.parse(fs.readFileSync(file, 'utf8'))));
  }
}

module.exports = { summaryMarkdown, cell, MAX_ROWS };
