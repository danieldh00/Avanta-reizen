/**
 * Tests van de gedeelde bouwstenen van het CRM (`crm/ui.js`), zonder database: adressen met filters, statuslabel,
 * acties, filterknoppen, zoekregel, tabel en bladeren, telkens met escaping.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, toString } = require('../src/site/html');
const ui = require('../src/crm/ui');
const { renderCrmPage } = require('../src/crm/layout');

test('ui: adres met filters laat lege waarden weg', () => {
  assert.equal(ui.listUrl('/app/x/', {}), '/app/x/');
  assert.equal(ui.listUrl('/app/x/', { q: '', reis: null, status: undefined }), '/app/x/');
  assert.equal(ui.listUrl('/app/x/', { q: 'a b&c', reis: 3, pagina: 0 }), '/app/x/?q=a+b%26c&reis=3&pagina=0');
  assert.equal(ui.queryString({ status: 'nieuw' }), 'status=nieuw');
});

test('ui: statuslabel escapet de tekst en accepteert alleen een veilige soort', () => {
  assert.equal(toString(ui.renderStatus('betaald', 'Betaald')), '<span class="crm-status crm-status--betaald">Betaald</span>');
  assert.equal(toString(ui.renderStatus('x" onclick="y', '<b>')), '<span class="crm-status crm-status--onbekend">&lt;b&gt;</span>');
});

test('ui: acties naast de titel, zonder acties niets', () => {
  assert.equal(ui.renderActions([]), '');
  assert.equal(ui.renderActions([null, false]), '');
  const actions = toString(ui.renderActions([{ label: 'Nieuw <x>', href: '/app/x/nieuw/', primary: true }, null, { label: 'Excel (.xlsx)', href: '/app/x/lijst.xlsx?a=1&b=2' }]));
  assert.match(actions, /<a class="btn btn--small" href="\/app\/x\/nieuw\/">Nieuw &lt;x&gt;<\/a>/);
  assert.match(actions, /<a class="btn btn--small btn--outline" href="\/app\/x\/lijst\.xlsx\?a=1&amp;b=2">Excel \(\.xlsx\)<\/a>/);
  const page = renderCrmPage({ title: 'Lijst', body: html`<p>x</p>`, user: { name: 'Jan', role: 'beheerder' }, csrf: 't', path: '/app/', actions: ui.renderActions([{ label: 'Nieuw', href: '/app/x/nieuw/' }]) });
  assert.match(page, /<div class="crm-pagehead"><h1 class="crm-title">Lijst<\/h1><div class="crm-actions">/);
});

test('ui: filterknoppen markeren de actieve keuze en houden de andere filters vast', () => {
  const tabs = toString(ui.renderFilterTabs({
    base: '/app/x/', name: 'status', current: 'nieuw', params: { q: 'jan <b>', reis: 4 }, label: 'Status',
    options: [{ value: '', label: 'Alle', count: 12 }, { value: 'nieuw', label: 'Nieuw', count: 0 }, { value: 'oud', label: 'Oud' }],
  }));
  assert.match(tabs, /<nav class="crm-tabs" aria-label="Status">/);
  assert.match(tabs, /<a href="\/app\/x\/\?q=jan\+%3Cb%3E&amp;reis=4">Alle <span class="crm-tabs-count">12<\/span><\/a>/);
  assert.match(tabs, /<a href="\/app\/x\/\?q=jan\+%3Cb%3E&amp;reis=4&amp;status=nieuw" aria-current="true">Nieuw <span class="crm-tabs-count">0<\/span><\/a>/);
  assert.match(tabs, /status=oud">Oud<\/a>/);
  assert.equal((tabs.match(/aria-current/g) || []).length, 1);
});

test('ui: zoekregel met verborgen filters en extra velden', () => {
  const search = toString(ui.renderSearch({ action: '/app/x/', label: 'Zoek op naam', value: '"><script>', hidden: { status: 'nieuw', leeg: '' }, extra: html`<select name="reis"></select>` }));
  assert.match(search, /<form class="crm-search" method="get" action="\/app\/x\/" role="search">/);
  assert.match(search, /<input type="hidden" name="status" value="nieuw">/);
  assert.doesNotMatch(search, /name="leeg"/);
  assert.match(search, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(search, /<select name="reis"><\/select>/);
  assert.match(search, /<label for="veld-q">Zoek op naam<\/label>/);
});

test('ui: tabel met kolomkoppen, getallen rechts en een melding als er niets is', () => {
  const columns = [{ label: 'Naam', cell: (row) => row.name }, { label: 'Aantal', numeric: true, cell: (row) => row.count }];
  assert.equal(toString(ui.renderTable({ columns, rows: [], empty: 'Niets <gevonden>.' })), '<p class="crm-empty">Niets &lt;gevonden&gt;.</p>');
  const table = toString(ui.renderTable({ columns, rows: [{ name: '<i>Jan</i>', count: 3 }], empty: 'x', caption: 'Mensen' }));
  assert.match(table, /<caption class="visually-hidden">Mensen<\/caption>/);
  assert.match(table, /<th scope="col">Naam<\/th><th scope="col" class="crm-num">Aantal<\/th>/);
  assert.match(table, /<td>&lt;i&gt;Jan&lt;\/i&gt;<\/td><td class="crm-num">3<\/td>/);
});

test('ui: bladeren alleen bij meer dan één pagina, met behoud van filters', () => {
  assert.equal(ui.renderPager({ base: '/app/x/', page: 1, hasNext: false }), '');
  const first = toString(ui.renderPager({ base: '/app/x/', params: { q: 'a' }, page: 1, hasNext: true }));
  assert.match(first, /<span class="crm-pager-off">Vorige<\/span>/);
  assert.match(first, /<a class="btn btn--small btn--outline" href="\/app\/x\/\?q=a&amp;pagina=2" rel="next">Volgende<\/a>/);
  const second = toString(ui.renderPager({ base: '/app/x/', params: { q: 'a' }, page: 2, hasNext: false }));
  assert.match(second, /href="\/app\/x\/\?q=a" rel="prev">Vorige<\/a>/, 'pagina 1 zonder parameter');
  assert.match(second, /Pagina 2/);
  assert.match(second, /<span class="crm-pager-off">Volgende<\/span>/);
});

test('ui: tabbladen linken naar hun paneel en weigeren een onveilige sleutel', () => {
  const nav = toString(ui.renderTabNav([{ key: 'algemeen', label: 'Algemeen' }, null, { key: 'fotos', label: 'Foto\'s <3', count: 4 }]));
  assert.match(nav, /<nav class="crm-tabs crm-tabs--edit" aria-label="Onderdelen">/);
  assert.match(nav, /<a href="#tab-algemeen" data-tab="algemeen">Algemeen<\/a>/);
  assert.match(nav, /<a href="#tab-fotos" data-tab="fotos">Foto&#39;s &lt;3 <span class="crm-tabs-count">4<\/span><\/a>/);
  assert.equal((nav.match(/<li>/g) || []).length, 2, 'een lege waarde valt weg');
  const panel = toString(ui.renderTabPanel('fotos', html`<p>inhoud</p>`));
  assert.equal(panel, '<div class="crm-tabpanel" id="tab-fotos" data-tab-panel="fotos"><p>inhoud</p></div>');
  assert.throws(() => ui.renderTabPanel('x" onload="y', html``), /Ongeldige sleutel/);
  assert.throws(() => ui.renderTabNav([{ key: 'Hoofd Letters', label: 'x' }]), /Ongeldige sleutel/);
});

test('ui: opslaanbalk met knop en toelichting', () => {
  const bar = toString(ui.renderSaveBar({ label: 'Opslaan', note: 'Laatst gewijzigd door <Jan>' }));
  assert.match(bar, /<div class="crm-savebar">/);
  assert.match(bar, /<span class="crm-savebar-note">Laatst gewijzigd door &lt;Jan&gt;<\/span>/);
  assert.match(bar, /<button class="btn" type="submit">Opslaan<\/button>/);
  assert.match(toString(ui.renderSaveBar({ label: 'Maken' })), /<span class="crm-savebar-note"><\/span>/);
});
