/**
 * Toegankelijkheidscontrole met axe-core (P7.3, bevinding A20), als onderdeel van de design-controle (`check.js --axe`).
 * Per pagina en vensterbreedte draait axe met de regels voor WCAG 2.1 niveau A en AA. Elke overtreding wordt een
 * bevinding met soort `toegankelijkheid`: ernst "hoog" bij impact *critical* of *serious* (laat de CI-job falen),
 * "laag" bij *moderate* of *minor* (alleen in het rapport). Regels in `PENDING_RULES` wachten op een oplossing van de
 * wachtlijst en krijgen "midden".
 *
 * axe-core is geen dependency van de app: CI installeert het naast Playwright (`npm install --no-save`). Het script wordt
 * via `page.evaluate` in de pagina gezet, zodat de strenge CSP van de app niet versoepeld hoeft te worden.
 */
const fs = require('node:fs');

/** WCAG-niveaus waarop axe controleert. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/** Impact van axe naar ernst in het rapport. */
const IMPACT_SEVERITY = { critical: 'hoog', serious: 'hoog', moderate: 'laag', minor: 'laag' };
/**
 * Regels die nu nog niet laten falen, met de reden. Hun bevindingen krijgen ernst "midden": ze staan in het rapport maar
 * blokkeren geen PR. Haal een regel hier weg zodra het punt op de wachtlijst is opgelost, zodat het niet terugkomt.
 */
const PENDING_RULES = {
  // Kleurcontrast van de huisstijl op de publieke site (bovenschriften, links, FAQ-koppen) en de ontwikkelbalk: wacht
  // op de huisstijlkeuze (wachtlijst W06/W26).
  'color-contrast': 'W26',
  // Links in lopende tekst (meldingen in het CRM) zijn alleen aan hun kleur te herkennen; onderstrepen in crm.css
  // (wachtlijst W26).
  'link-in-text-block': 'W26',
};
/** Maximaal aantal elementen per overtreding in de uitslag (de rest staat als aantal in de melding). */
const MAX_NODES = 3;

/** De broncode van axe-core, één keer gelezen. */
let axeSource = null;

/**
 * Leest axe-core uit node_modules.
 * @returns {string} De broncode van `axe.min.js`.
 * @throws {Error} Met installatie-aanwijzing als axe-core ontbreekt.
 */
function loadAxeSource() {
  if (axeSource) return axeSource;
  let file;
  try {
    file = require.resolve('axe-core/axe.min.js');
  } catch (error) {
    throw new Error('axe-core ontbreekt: npm install --no-save axe-core (alleen voor de design-controle).', { cause: error });
  }
  axeSource = fs.readFileSync(file, 'utf8');
  return axeSource;
}

/**
 * Zet de uitslag van axe om naar bevindingen in het formaat van de design-controle.
 * @param {Array<{id: string, impact?: string, help: string, nodes: Array<{target: unknown[]}>}>} violations Overtredingen van axe.
 * @returns {Array<{check: string, rule: string, severity: string, selector: string, message: string, rect: null}>} Bevindingen.
 */
function violationsToFindings(violations) {
  const findings = [];
  for (const violation of violations) {
    const pending = PENDING_RULES[violation.id];
    const impactSeverity = IMPACT_SEVERITY[violation.impact] || 'laag';
    const severity = pending && impactSeverity === 'hoog' ? 'midden' : impactSeverity;
    const nodes = violation.nodes.slice(0, MAX_NODES);
    const extra = violation.nodes.length > MAX_NODES ? ` (+${violation.nodes.length - MAX_NODES} elementen)` : '';
    for (const node of nodes) {
      findings.push({
        check: 'toegankelijkheid',
        rule: violation.id,
        severity,
        selector: String(node.target[0] || ''),
        message: `${violation.id} (${violation.impact || 'onbekend'}${pending ? `, wachtlijst ${pending}` : ''}): ${violation.help}${extra}`,
        rect: null,
      });
    }
  }
  return findings;
}

/**
 * Draait axe in een geladen pagina.
 * @param {{evaluate: Function}} page Playwright-pagina.
 * @returns {Promise<object[]>} Bevindingen (leeg als er niets is; bij een fout één bevinding `fout`).
 */
async function runAccessibilityChecks(page) {
  try {
    await page.evaluate(loadAxeSource());
    const violations = await page.evaluate(
      (tags) => /** @type {any} */ (window).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
        .then((/** @type {any} */ result) => result.violations.map((/** @type {any} */ item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.map((/** @type {any} */ node) => ({ target: node.target })) }))),
      AXE_TAGS,
    );
    return violationsToFindings(violations);
  } catch (error) {
    return [{ check: 'fout', severity: 'midden', selector: '', message: `axe: ${String(error.message).slice(0, 200)}`, rect: null }];
  }
}

module.exports = { runAccessibilityChecks, violationsToFindings, AXE_TAGS, IMPACT_SEVERITY, PENDING_RULES };
