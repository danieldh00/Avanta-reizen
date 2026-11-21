/**
 * Hulp voor de Content-Security-Policy: bronnen toevoegen aan een richtlijn (bijvoorbeeld de YouTube-video op de
 * homepage in `frame-src`), zonder de rest van de policy te veranderen.
 */

/**
 * Voegt bronnen toe aan richtlijnen; een ontbrekende richtlijn komt erbij met `'self'` en de bronnen.
 * @param {string} csp De policy (richtlijnen gescheiden door "; ").
 * @param {Record<string, string[]>} additions Bronnen per richtlijn (alleen vaste https-adressen uit de code).
 * @returns {string} De uitgebreide policy.
 */
function addCspSources(csp, additions) {
  const directives = String(csp || '').split('; ').filter(Boolean);
  for (const [name, sources] of Object.entries(additions)) {
    const index = directives.findIndex((directive) => directive.split(' ')[0] === name);
    if (index === -1) directives.push(`${name} 'self' ${sources.join(' ')}`);
    else directives[index] = `${directives[index]} ${sources.filter((source) => !directives[index].split(' ').includes(source)).join(' ')}`.trim();
  }
  return directives.join('; ');
}

module.exports = { addCspSources };
