/**
 * Tests van het verkleinen van de publieke CSS en JavaScript bij het bouwen van het image (`tools/minify-public.js`),
 * zonder database: welke bestanden meegaan, dat de uitkomst kleiner en nog geldig is, dat verwijzingen en
 * CSS-variabelen behouden blijven, en dat de leesbare bron nooit overschreven kan worden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { listAssets, minifyCode, minifyPublic, formatReport } = require('../tools/minify-public');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Maakt een lege tijdelijke map voor één test.
 * @returns {string} Pad van de map.
 */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-minify-'));
}

/**
 * Geeft de unieke waarden van een reguliere expressie in een tekst, gesorteerd.
 * @param {string} text Tekst.
 * @param {RegExp} pattern Patroon met vlag g en één groep.
 * @returns {string[]} Gevonden waarden.
 */
function uniqueMatches(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1].replace(/["']/g, '')))].sort();
}

test('verkleinen: alle publieke CSS en JavaScript gaan mee, afbeeldingen en lettertypes niet', () => {
  const assets = listAssets(PUBLIC_DIR);
  assert.ok(assets.includes('css/site.css'));
  assert.ok(assets.includes('css/crm.css'));
  assert.ok(assets.includes('js/site.js'));
  assert.ok(assets.includes('js/crm.js'));
  assert.ok(assets.every((file) => /^(css\/[^/]+\.css|js\/[^/]+\.js)$/.test(file)), 'alleen css/*.css en js/*.js');
});

test('verkleinen: de echte bestanden worden kleiner en blijven geldig met dezelfde verwijzingen', async () => {
  const target = tempDir();
  try {
    const results = await minifyPublic(PUBLIC_DIR, target);
    assert.equal(results.length, listAssets(PUBLIC_DIR).length);
    for (const { file, before, after } of results) {
      assert.ok(after < before, `${file} is kleiner`);
      const source = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      const minified = fs.readFileSync(path.join(target, file), 'utf8');
      assert.doesNotMatch(minified, /\/\*/, `${file} zonder commentaar`);
      if (file.endsWith('.js')) {
        assert.doesNotThrow(() => new vm.Script(minified, { filename: file }), `${file} is geldige JavaScript`);
      } else {
        assert.deepEqual(uniqueMatches(minified, /url\(([^)]*)\)/g), uniqueMatches(source, /url\(([^)]*)\)/g), `${file}: zelfde url()-verwijzingen`);
        assert.deepEqual(uniqueMatches(minified, /(--av-[\w-]+)\s*:/g), uniqueMatches(source, /(--av-[\w-]+)\s*:/g), `${file}: zelfde CSS-variabelen`);
      }
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('verkleinen: tekens buiten ASCII blijven leesbaar en de bron blijft ongewijzigd', async () => {
  const source = tempDir();
  const target = tempDir();
  try {
    fs.mkdirSync(path.join(source, 'css'));
    const css = '/* uitleg */\n.knop::after {\n  content: "→ één";\n  color: red;\n}\n';
    fs.writeFileSync(path.join(source, 'css', 'proef.css'), css);
    await minifyPublic(source, target);
    assert.equal(fs.readFileSync(path.join(target, 'css', 'proef.css'), 'utf8').trim(), '.knop:after{content:"→ één";color:red}');
    assert.equal(fs.readFileSync(path.join(source, 'css', 'proef.css'), 'utf8'), css, 'bron ongewijzigd');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('verkleinen: een doelmap in of gelijk aan de bronmap wordt geweigerd', async () => {
  const source = tempDir();
  try {
    await assert.rejects(minifyPublic(source, source), /doelmap/);
    await assert.rejects(minifyPublic(source, path.join(source, 'uit')), /doelmap/);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('verkleinen: een kapot bestand laat het bouwen mislukken', async () => {
  await assert.rejects(minifyCode('function (', 'js', 'js/kapot.js'));
  await assert.rejects(minifyCode('const a = ;', 'js', 'js/kapot.js'));
});

test('verkleinen: het overzicht toont elk bestand en het totaal', () => {
  const report = formatReport([
    { file: 'css/site.css', before: 2048, after: 1024 },
    { file: 'js/site.js', before: 1024, after: 512 },
  ]);
  assert.match(report, /css\/site\.css\s+2\.0 KB ->\s+1\.0 KB \(-50%\)/);
  assert.match(report, /totaal\s+3\.0 KB ->\s+1\.5 KB \(-50%\)/);
});
