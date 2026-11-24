/**
 * Tests van de teksteditor van het CRM (`public/js/rich-editor.js` en de opschoner `public/js/rich-text-clean.js`),
 * zonder database en zonder browser: de opschoner draait hier op knopen van node-html-parser. Gecontroleerd wordt dat
 * de editor nette HTML met alinea's oplevert, dat gevaarlijke opmaak verdwijnt, dat de uitvoer de opschoning van de
 * server ongewijzigd doorstaat, en dat het CRM de scripts laadt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');
const { html, toString } = require('../src/site/html');
const { renderCrmPage } = require('../src/crm/layout');
const { sanitizeHtml } = require('../tools/import/sanitize');
const { cleanNodes, textToHtml, isSafeUrl } = require('../public/js/rich-text-clean');
const { RICHTEXT_HELP, fieldControl } = require('../src/cms/block-editor');

/**
 * Schoont een stuk HTML op zoals de editor dat doet.
 * @param {string} markup HTML.
 * @returns {string} Opgeschoonde HTML.
 */
function clean(markup) {
  return cleanNodes(parse(markup).childNodes);
}

test('opschoner: losse tekst wordt alinea, div wordt alinea, b/i worden strong/em', () => {
  assert.equal(clean('hallo <b>wereld</b><div>tweede</div><div><br></div>'), '<p>hallo <strong>wereld</strong></p><p>tweede</p>');
  assert.equal(clean('<i>schuin</i> en <u>onder</u>'), '<p><em>schuin</em> en <u>onder</u></p>');
  assert.equal(clean('<div><p>al een alinea</p><p>nog een</p></div>'), '<p>al een alinea</p><p>nog een</p>');
  assert.equal(clean('regel<br>volgende<br>'), '<p>regel<br>volgende</p>');
  assert.equal(clean(''), '');
  assert.equal(clean('   \n  '), '');
});

test('opschoner: opmaak uit een tekstverwerker (span met stijl) wordt vet en cursief', () => {
  assert.equal(clean('<span style="font-weight: 700">vet</span> <span style="font-style:italic">schuin</span> <font>gewoon</font>'),
    '<p><strong>vet</strong> <em>schuin</em> gewoon</p>');
  assert.equal(clean('<p class="MsoNormal" style="color:red">tekst</p>'), '<p>tekst</p>');
});

test('opschoner: koppen, lijsten, citaat, tabel en galerij blijven', () => {
  assert.equal(clean('<h1>Groot</h1><h2>Kop</h2><h3>Tussen</h3><h6>Klein</h6>'), '<h2>Groot</h2><h2>Kop</h2><h3>Tussen</h3><h5>Klein</h5>');
  assert.equal(clean('<ul>\n<li>een</li>\n<li>twee</li></ul><ol><li>drie</li></ol>'), '<ul><li>een</li><li>twee</li></ul><ol><li>drie</li></ol>');
  assert.equal(clean('<ul>\n</ul>'), '', 'lege lijst verdwijnt');
  assert.equal(clean('<blockquote>citaat</blockquote>'), '<blockquote>citaat</blockquote>');
  assert.equal(clean('<table><tbody><tr><th colspan="2">a</th><td rowspan="x">b</td></tr></tbody></table>'),
    '<table><tbody><tr><th colspan="2">a</th><td>b</td></tr></tbody></table>');
  assert.equal(clean('<div class="gallery"><img src="/media/a.webp" alt="Tent"></div>'), '<p><img src="/media/a.webp" alt="Tent"></p>', 'zoals de server: geen eigen div');
  assert.equal(clean('<figure><img src="/media/b.webp" width="800" height="abc"><figcaption>Uitzicht</figcaption></figure>'),
    '<figure><img src="/media/b.webp" width="800" alt=""><figcaption>Uitzicht</figcaption></figure>');
  assert.equal(clean('<p>voor</p><hr><p>na</p>'), '<p>voor</p><hr><p>na</p>');
});

test('opschoner: blokken binnen een alinea splitsen de alinea', () => {
  assert.equal(clean('<p>a<ul><li>x</li></ul>b</p>'), '<p>a</p><ul><li>x</li></ul><p>b</p>');
  assert.equal(clean('<strong><p>x</p></strong>'), '<p>x</p>');
  // Een div sluit de alinea (zoals in de browser): twee alinea's.
  assert.equal(clean('<p>tekst <div>in div</div></p>'), '<p>tekst</p><p>in div</p>');
});

test('opschoner: scripts, stijlen, event-handlers en onveilige links verdwijnen', () => {
  const output = clean('<p onclick="x()">tekst</p><script>alert(1)</script><style>p{}</style><iframe src="https://evil.example"></iframe>'
    + '<img src="javascript:alert(1)" onerror="x"><img src="x"><a href="javascript:alert(1)">slecht</a> <a href="//evil.example">ook</a> '
    + '<a href="/contact/" onclick="x" target="_blank">goed</a><svg><a href="/x">svg</a></svg>');
  assert.equal(output, '<p>tekst</p><p>slecht ook <a href="/contact/">goed</a></p>');
  assert.doesNotMatch(output, /script|onclick|onerror|javascript|iframe|svg/i);
  assert.equal(clean('<a href="https://example.com" title="Uitleg &quot;hier&quot;">x</a>'), '<p><a href="https://example.com" title="Uitleg &quot;hier&quot;">x</a></p>');
  assert.equal(clean('<a href="/x"> </a>'), '', 'lege link verdwijnt');
});

test('opschoner: tekens worden ge-escapet en een losse harde spatie wordt een gewone spatie', () => {
  assert.equal(clean('a &lt;b&gt; &amp; c'), '<p>a &lt;b&gt; &amp; c</p>');
  assert.equal(clean('met&nbsp;<strong>vet</strong>&nbsp;woord'), '<p>met <strong>vet</strong> woord</p>');
  assert.equal(clean('twee&nbsp;&nbsp;spaties'), '<p>twee&nbsp;&nbsp;spaties</p>');
});

test('opschoner: platte tekst plakken geeft alinea\'s en regels', () => {
  assert.equal(textToHtml('regel 1\nregel 2\r\n\r\n<b>alinea</b>\n\n\n'), '<p>regel 1<br>regel 2</p><p>&lt;b&gt;alinea&lt;/b&gt;</p>');
  assert.equal(textToHtml(''), '');
  assert.equal(textToHtml(undefined), '');
});

test('opschoner: linkadressen zoals de server', () => {
  for (const good of ['/contact/', '#boven', '?a=1', 'https://example.com', 'mailto:info@example.com', 'tel:+31101234567']) assert.ok(isSafeUrl(good), good);
  for (const bad of ['', 'javascript:alert(1)', '//evil.example', 'data:text/html,x', 'contact']) assert.ok(!isSafeUrl(bad), bad);
});

test('opschoner: de uitvoer komt ongewijzigd door de opschoning van de server', () => {
  const samples = [
    'hallo <b>wereld</b><div>tweede</div>',
    '<h2>Kop</h2><p>Tekst met <a href="/contact/">link</a> en <em>nadruk</em>.</p><ul><li>een</li><li>twee</li></ul>',
    '<blockquote>citaat</blockquote><ol><li><strong>vet</strong> punt</li></ol><p>regel<br>volgende</p>',
    '<table><tbody><tr><td>a</td></tr></tbody></table><p><img src="/media/a.webp" alt="Tent"></p>',
  ];
  for (const sample of samples) {
    const output = clean(sample);
    // De server voegt aan afbeeldingen alleen `loading="lazy"` toe.
    assert.equal(sanitizeHtml(output).replace(/ loading="lazy"/g, ''), output, sample);
  }
});

test('opschoner: bestaande opgeslagen tekst blijft gelijk na openen en opslaan in de editor', () => {
  const stored = sanitizeHtml('<p>Kanoën &amp; klimmen.</p>\n<h3>Programma</h3>\n<ul>\n<li>Dag 1</li>\n<li>Dag 2</li>\n</ul>\n<p><a href="https://example.com/" target="_blank">extern</a></p>');
  assert.equal(sanitizeHtml(clean(stored)), sanitizeHtml(stored).replace(/>\n</g, '><').replace(/ target="_blank" rel="noopener"/, ''));
});

test('CRM: de scripts van de editor worden geladen, na crm.js en uitgesteld', () => {
  const page = renderCrmPage({ title: 'Test', body: html`<p>x</p>`, user: { name: 'Jan', role: 'beheerder' }, csrf: 't', path: '/app/' });
  const crm = page.indexOf('/js/crm.js');
  const cleaner = page.indexOf('/js/rich-text-clean.js');
  const editor = page.indexOf('/js/rich-editor.js');
  assert.ok(crm > -1 && cleaner > crm && editor > cleaner, 'volgorde crm → opschoner → editor');
  assert.match(page, /rich-text-clean\.js\?v=[^"]+" defer>/);
  assert.match(page, /rich-editor\.js\?v=[^"]+" defer>/);
  const login = renderCrmPage({ title: 'Inloggen', body: html`<p>x</p>` });
  assert.doesNotMatch(login, /rich-editor/, 'niet zonder gebruiker');
});

test('editor: script en opmaak passen bij elkaar en zetten nooit ongeschoonde HTML in de pagina', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const script = fs.readFileSync(path.join(publicDir, 'js', 'rich-editor.js'), 'utf8');
  for (const hook of ['textarea.cms-richtext', 'AvantaRichText', 'DOMParser', 'defaultParagraphSeparator', "'paste'", "'submit'", 'aria-pressed', 'contentEditable', 'maxLength', 'rich-editor__count', 'rich-editor__warning']) assert.ok(script.includes(hook), hook);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/, 'geen HTML rechtstreeks in de pagina');
  assert.doesNotMatch(fs.readFileSync(path.join(publicDir, 'js', 'crm.js'), 'utf8'), /setupRichText/, 'de oude knoppen zijn weg');
  const css = fs.readFileSync(path.join(publicDir, 'css', 'crm.css'), 'utf8');
  for (const selector of ['.rich-editor {', '.rich-editor__toolbar {', '.rich-editor__content {', '.rich-editor__content:focus-visible', '[aria-pressed="true"]', '.rich-editor__count.is-over']) assert.ok(css.includes(selector), selector);
});

test('blokveld met opgemaakte tekst: tekstvak voor de editor met uitleg', () => {
  const control = toString(fieldControl({ name: 'html', kind: 'richtext', max: 100 }, 'f_html', 'blok-1-f_html', '<p>a</p>'));
  assert.match(control, /<textarea id="blok-1-f_html" name="f_html" rows="14" class="cms-richtext">&lt;p&gt;a&lt;\/p&gt;<\/textarea>/);
  assert.match(RICHTEXT_HELP, /Enter begint een nieuwe alinea/);
});
