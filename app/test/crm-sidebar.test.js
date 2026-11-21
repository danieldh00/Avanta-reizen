/**
 * Tests van de zijbalk van het CRM en Beheer (`crm/layout.js`, `public/js/crm.js`), zonder database: welke groepen en
 * links per rol, de markering van de huidige pagina, de tweede zijbalk en het zoeken in Beheer, escaping, en de
 * statische bestanden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { html } = require('../src/site/html');
const { renderCrmPage } = require('../src/crm/layout');
const { GROUPS } = require('../src/beheer/indeling');

/**
 * Tekent een CRM-pagina voor een gebruiker met een rol.
 * @param {string} role De rol.
 * @param {object} [extra] Extra velden voor de pagina (path, beheer).
 * @returns {string} De HTML.
 */
function pageFor(role, extra = {}) {
  return renderCrmPage({ title: 'Test', body: html`<p>inhoud</p>`, user: { name: 'Jan <b>', role }, csrf: 'token-1', path: '/app/', ...extra });
}

test('zijbalk: zonder gebruiker geen zijbalk en geen script', () => {
  const page = renderCrmPage({ title: 'Inloggen', body: html`<p>x</p>` });
  assert.doesNotMatch(page, /crm-nav/);
  assert.doesNotMatch(page, /js\/crm\.js/);
  assert.match(page, /<body class="crm">/);
});

test('zijbalk: beheerder ziet de CRM-groepen en één ingang naar Beheer, zonder Beheer-groepen in de hoofdzijbalk', () => {
  const page = pageFor('beheerder');
  for (const href of ['/app/', '/app/aanmeldingen/', '/app/deelnemers/', '/app/fotobibliotheek/', '/app/beheer/']) {
    assert.match(page, new RegExp(`href="${href}"`), href);
  }
  assert.match(page, /<div class="crm-nav-list crm-nav-beheer"><a class="crm-nav-item" href="\/app\/beheer\/" title="Beheer">/);
  for (const group of GROUPS) {
    for (const section of group.sections) assert.doesNotMatch(page, new RegExp(`href="/app/beheer/${section.id}/"`), section.id);
  }
  assert.doesNotMatch(page, /href="\/app\/gebruikers\/"/, 'gebruikers staan in Beheer');
  assert.doesNotMatch(page, /crm-sub|beheer-zoek/, 'geen tweede zijbalk buiten Beheer');
  assert.doesNotMatch(page, /crm--beheer/);
  assert.match(page, /<script src="\/js\/crm\.js\?v=/);
  assert.match(page, /name="_csrf" value="token-1"/);
  assert.match(page, /Jan &lt;b&gt;/, 'naam ge-escaped');
});

test('zijbalk: rollen zien alleen hun eigen modules en geen ingang naar Beheer', () => {
  const editor = pageFor('redacteur');
  assert.match(editor, /href="\/app\/fotobibliotheek\/"/);
  for (const hidden of ['/app/aanmeldingen/', '/app/deelnemers/', '/app/gebruikers/', '/app/beheer/']) assert.doesNotMatch(editor, new RegExp(`href="${hidden}`), hidden);
  assert.doesNotMatch(editor, /crm-nav-beheer/);
  // Reisleider: aanmeldingen en deelnemers dicht (TRIP_SCOPED_ROLES); deelnemerslijsten alleen van eigen vertrekken.
  const guide = pageFor('reisleider');
  assert.doesNotMatch(guide, /href="\/app\/aanmeldingen\/"/);
  assert.doesNotMatch(guide, /href="\/app\/deelnemers\/"/);
  assert.match(guide, /href="\/app\/deelnemerslijsten\/"/, 'deelnemerslijsten van de eigen vertrekken');
  const office = pageFor('kantoor');
  assert.match(office, /href="\/app\/aanmeldingen\/"/);
  assert.doesNotMatch(office, /href="\/app\/beheer\//);
  // Zonder rechten in Beheer ook op een Beheer-pad geen tweede zijbalk (de route zelf geeft dan 403).
  assert.doesNotMatch(pageFor('kantoor', { path: '/app/beheer/mailserver/' }), /crm-sub/);
  // Altijd: overzicht, wachtwoord, tweestapsverificatie en uitloggen.
  for (const page of [editor, guide, office]) {
    for (const href of ['/app/', '/app/wachtwoord/', '/app/tweestaps/']) assert.match(page, new RegExp(`href="${href}"`));
    assert.match(page, /action="\/app\/uitloggen\/"/);
  }
});

test('zijbalk: huidige pagina gemarkeerd en haar groep open', () => {
  const page = pageFor('beheerder', { path: '/app/deelnemers/12/' });
  assert.match(page, /href="\/app\/deelnemers\/" aria-current="page"/);
  assert.doesNotMatch(page, /href="\/app\/" aria-current/, 'Overzicht alleen op /app/ zelf');
  assert.match(page, /class="crm-nav-sec is-open has-active" data-group="reizigers"/);
  assert.match(page, /class="crm-nav-sec" data-group="website"/, 'andere groepen dicht');
  assert.equal((page.match(/aria-current="page"/g) || []).length, 1);
  const home = pageFor('beheerder', { path: '/app/' });
  assert.match(home, /href="\/app\/" aria-current="page"/);
  assert.match(pageFor('beheerder', { path: '/app/tweestaps/' }), /href="\/app\/tweestaps\/" aria-current="page"/);
});

test('beheer: eigen omgeving met tweede zijbalk, weg terug en alle onderdelen per onderwerp', () => {
  const page = pageFor('beheerder', { path: '/app/beheer/mailserver/' });
  assert.match(page, /<body class="crm crm--nav crm--beheer">/);
  assert.match(page, /<main id="inhoud" class="crm-main crm-main--beheer">\s*<div class="crm-beheer">\s*<aside class="crm-sub" id="crm-sub" aria-label="Beheer">/);
  assert.match(page, /<a class="crm-sub-back" href="\/app\/">/, 'weg terug naar het CRM');
  assert.match(page, /href="\/app\/beheer\/" aria-current="true" title="Beheer"/, 'ingang Beheer gemarkeerd in de hoofdzijbalk');
  assert.match(page, /href="\/app\/beheer\/mailserver\/" aria-current="page"/);
  assert.equal((page.match(/aria-current="page"/g) || []).length, 1, 'één huidige pagina');
  assert.match(page, /aria-expanded="true" aria-controls="crm-sub-beheer-2"/, 'groep E-mail open');
  assert.match(page, /class="crm-nav-sec" data-group="beheer-0"/, 'andere groepen dicht');
  assert.match(page, /data-sub-toggle aria-controls="crm-sub-body" aria-expanded="false"><span>Mailserver<\/span>/, 'mobiele knop toont het huidige onderdeel');
  assert.match(page, /<form class="crm-sub-search" method="get" action="\/app\/beheer\/"/);
  for (const group of GROUPS) {
    assert.match(page, new RegExp(`<span class="crm-nav-label">${group.title}</span>`), group.title);
    for (const section of group.sections) assert.match(page, new RegExp(`href="/app/beheer/${section.id}/"`), section.id);
  }
  for (const href of ['/app/gebruikers/', '/app/auditlog/']) assert.match(page, new RegExp(`href="${href}"`), href);
  // De titel staat in de inhoudskolom, naast de tweede zijbalk.
  assert.match(page, /<div class="crm-beheer-main">\s*<h1 class="crm-title">Test<\/h1>/);
  // Gebruikers en auditlog horen bij Beheer.
  const users = pageFor('beheerder', { path: '/app/gebruikers/' });
  assert.match(users, /href="\/app\/gebruikers\/" aria-current="page"/);
  assert.match(users, /class="crm-nav-sec is-open has-active" data-group="gebruikers"/);
  assert.match(pageFor('beheerder', { path: '/app/auditlog/' }), /href="\/app\/auditlog\/" aria-current="page"/);
  // Een onbekende Beheer-pagina: niets gemarkeerd in de tweede zijbalk, wel de ingang.
  const unknown = pageFor('beheerder', { path: '/app/beheer/' });
  assert.doesNotMatch(unknown, /aria-current="page"/);
  assert.match(unknown, /<span>Onderdelen van Beheer<\/span>/);
});

test('beheer: zoeken toont gevonden groepen open, filtert gebruikers mee en escapet de zoekterm', () => {
  const groups = [{ title: 'Organisatie', sections: [GROUPS[1].sections[0]] }];
  const found = pageFor('beheerder', { path: '/app/beheer/', beheer: { groups, query: 'telefoon' } });
  assert.match(found, /<aside class="crm-sub" id="crm-sub" aria-label="Beheer" data-search="1">/);
  assert.match(found, /value="telefoon"/);
  assert.match(found, /class="crm-nav-sec is-open" data-group="beheer-1"/);
  assert.doesNotMatch(found, /href="\/app\/beheer\/mailserver\/"/);
  assert.doesNotMatch(found, /href="\/app\/gebruikers\/"/, 'gebruikers passen niet bij "telefoon"');
  const users = pageFor('beheerder', { path: '/app/beheer/', beheer: { groups: [], query: 'rollen' } });
  assert.match(users, /class="crm-nav-sec is-open" data-group="gebruikers"/);
  assert.match(users, /href="\/app\/gebruikers\/"/);
  assert.doesNotMatch(users, /href="\/app\/auditlog\/"/);
  const none = pageFor('beheerder', { path: '/app/beheer/', beheer: { groups: [], query: '<script>' } });
  assert.match(none, /Niets gevonden voor “&lt;script&gt;”/);
  assert.doesNotMatch(none, /<script>/);
});

test('zijbalk: script en stijl bestaan en passen bij de opmaak', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const script = fs.readFileSync(path.join(publicDir, 'js', 'crm.js'), 'utf8');
  for (const hook of ['data-nav-compact', 'data-nav-toggle', 'data-nav-close', 'data-search', 'data-sub-toggle', 'crm-sub', 'nav-compact', 'nav-open', 'is-open']) assert.ok(script.includes(hook), hook);
  assert.doesNotMatch(script, /innerHTML/, 'geen HTML uit tekst');
  const css = fs.readFileSync(path.join(publicDir, 'css', 'site.css'), 'utf8');
  for (const selector of ['.crm-nav {', '.nav-compact .crm-nav {', '.js .nav-open .crm-nav {', '.crm-nav-item[aria-current]', '.crm-beheer {', '.crm-sub {', '.js .crm-sub:not(.is-open) .crm-sub-body']) assert.ok(css.includes(selector), selector);
  assert.ok(fs.existsSync(path.join(publicDir, 'images', 'logo-light.png')));
});
