// @ts-check
/**
 * De blokken-motor van het CMS (pakket H): een pagina is een lijst blokken (JSON in `pages.blocks` en het concept in
 * `pages.draft`). Elk bloktype heeft vaste velden en elk blok dezelfde stijlopties uit de huisstijl (achtergrond,
 * breedte, uitlijning, ruimte boven en onder); vrije HTML of CSS bestaat niet. Dit bestand bevat de definities en de
 * controle van ingezonden velden; de HTML voor de site staat in `block-render.js`. Opgemaakte tekst gaat
 * bij het opslaan door `sanitizeHtml` en wordt alleen daarna als raw ingevoegd.
 *
 * Vorm van een blok: `{ id: 'b' + 12 hex, type, data: {…velden}, style: {…stijlopties} }`.
 */
const crypto = require('node:crypto');
const { sanitizeHtml, isSafeUrl } = require('../../tools/import/sanitize');

/** Maximaal aantal blokken op één pagina. */
const MAX_BLOCKS = 60;

/** Maximaal aantal reizenblokken per pagina (elk blok is een query bij elke weergave). */
const MAX_TRIP_BLOCKS = 5;

/** Vorm van een blok-id. */
const BLOCK_ID_PATTERN = /^b[0-9a-f]{12}$/;

/**
 * De stijlopties die elk blok heeft, met hun keuzes (eerste sleutel is de standaard). De keuzes worden CSS-klassen
 * (`cms-bg--…`, `cms-width--…`, …) in `public/css/site.css`.
 */
const STYLE_OPTIONS = {
  achtergrond: { label: 'Achtergrond', choices: { geen: 'Geen (zoals de pagina)', wit: 'Wit vlak', grijs: 'Lichtgrijs vlak', soil: 'Textuur (zoals de reistypes)', terracotta: 'Terracotta' } },
  breedte: { label: 'Breedte', choices: { smal: 'Smal (leesbreedte)', normaal: 'Normaal (1280 px)', vol: 'Volle breedte' } },
  uitlijning: { label: 'Uitlijning', choices: { links: 'Links', midden: 'Gecentreerd' } },
  ruimteBoven: { label: 'Ruimte boven', choices: { geen: 'Geen', klein: 'Klein', normaal: 'Normaal', groot: 'Groot' } },
  ruimteOnder: { label: 'Ruimte onder', choices: { normaal: 'Normaal', geen: 'Geen', klein: 'Klein', groot: 'Groot' } },
};

/** Maximaal aantal dia's in de slider en de inspiratie op de homepage. */
const MAX_HOME_SLIDES = 8;

/** Maximaal aantal foto's in een galerijblok. */
const MAX_GALLERY_IMAGES = 40;

/**
 * Weergave van een galerijblok: binnen de tekstkolom, of als strook op volle breedte buiten de tekst (zoals de galerij
 * onder een reis en onder berichten en pagina's van de huidige site).
 */
const GALLERY_DISPLAYS = { tekst: 'In de tekstkolom', strook: 'Strook op volle breedte (zoals onder een reis)' };

/** Vorm van een YouTube-id. */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** De keuzes voor de stijl van een knop. */
const BUTTON_STYLES = { vol: 'Terracotta', omlijnd: 'Omlijnd' };

/**
 * De bloktypes. Per type: naam en uitleg voor het scherm en de velden. Soorten velden: `text` (één regel), `textarea`
 * (platte tekst met regels), `richtext` (opgemaakte tekst, HTML met alleen veilige opmaak), `link` (adres op de eigen
 * site, https, mailto of tel), `select` (vaste keuzes), `image` (foto uit de fotobibliotheek, gekozen op een eigen
 * scherm) en `repeat` (een vast aantal regels met dezelfde subvelden, lege regels vallen weg).
 */
const BLOCK_TYPES = {
  tekst: {
    label: 'Tekst',
    help: 'Lopende tekst met koppen, lijsten, links en vet/cursief.',
    fields: [{ name: 'html', label: 'Tekst', kind: 'richtext', max: 100_000 }],
  },
  kop: {
    label: 'Kop met subtitel',
    help: 'Een sectietitel in Playfair met een subtitel in hoofdletters eronder.',
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 200, required: true },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 200 },
      { name: 'niveau', label: 'Soort kop', kind: 'select', choices: { h2: 'Grote kop (sectie)', h3: 'Kleine kop' } },
    ],
  },
  afbeelding: {
    label: 'Afbeelding',
    help: 'Eén foto uit de fotobibliotheek, met een bijschrift.',
    fields: [
      { name: 'foto', label: 'Foto', kind: 'image' },
      { name: 'bijschrift', label: 'Bijschrift', kind: 'text', max: 300 },
    ],
  },
  knoppen: {
    label: 'Knoppen',
    help: 'Eén tot drie knoppen naast elkaar.',
    fields: [{
      name: 'knoppen',
      label: 'Knop',
      kind: 'repeat',
      count: 3,
      fields: [
        { name: 'tekst', label: 'Tekst', kind: 'text', max: 60 },
        { name: 'link', label: 'Adres', kind: 'link', max: 500 },
        { name: 'stijl', label: 'Stijl', kind: 'select', choices: BUTTON_STYLES },
      ],
    }],
  },
  citaat: {
    label: 'Citaat',
    help: 'Een uitspraak in grote letters, met wie het zei.',
    fields: [
      { name: 'tekst', label: 'Citaat', kind: 'textarea', max: 1000, required: true },
      { name: 'bron', label: 'Wie (bron)', kind: 'text', max: 120 },
    ],
  },
  'tekst-afbeelding': {
    label: 'Tekst met foto',
    help: 'Tekst naast een foto uit de fotobibliotheek (op mobiel onder elkaar).',
    styleDefaults: { breedte: 'normaal' },
    fields: [
      { name: 'html', label: 'Tekst', kind: 'richtext', max: 50_000 },
      { name: 'foto', label: 'Foto', kind: 'image' },
      { name: 'positie', label: 'Foto staat', kind: 'select', choices: { rechts: 'Rechts van de tekst', links: 'Links van de tekst' } },
    ],
  },
  galerij: {
    label: 'Fotogalerij',
    help: 'Een strook foto\'s die je opzij schuift, met titel en subtitel (zoals bij een reis).',
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 200 },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 200 },
      { name: 'fotos', label: 'Foto\'s', kind: 'images', max: MAX_GALLERY_IMAGES },
      { name: 'weergave', label: 'Weergave', kind: 'select', choices: GALLERY_DISPLAYS },
    ],
  },
  kolommen: {
    label: 'Kolommen',
    help: 'Twee of drie korte teksten naast elkaar, elk met een titel en eventueel een link (bijv. onze manier van reizen).',
    styleDefaults: { breedte: 'normaal' },
    fields: [{
      name: 'kolommen',
      label: 'Kolom',
      kind: 'repeat',
      count: 3,
      fields: [
        { name: 'titel', label: 'Titel', kind: 'text', max: 120 },
        { name: 'tekst', label: 'Tekst', kind: 'textarea', max: 1000 },
        { name: 'link', label: 'Adres van de link', kind: 'link', max: 500 },
        { name: 'linktekst', label: 'Tekst van de link', kind: 'text', max: 60 },
      ],
    }],
  },
  banner: {
    label: 'Banner',
    help: 'Een grote foto over de volle breedte met titel, tekst en een knop erop.',
    styleDefaults: { breedte: 'vol' },
    fields: [
      { name: 'foto', label: 'Foto', kind: 'image' },
      { name: 'titel', label: 'Titel', kind: 'text', max: 200, required: true },
      { name: 'tekst', label: 'Tekst', kind: 'textarea', max: 500 },
      { name: 'knoptekst', label: 'Tekst van de knop', kind: 'text', max: 60 },
      { name: 'link', label: 'Adres van de knop', kind: 'link', max: 500 },
    ],
  },
  video: {
    label: 'Video (YouTube)',
    help: 'Een YouTube-video. Bezoekers kiezen eerst zelf of ze hem laden (cookiekeuze); pas dan maakt de browser verbinding met YouTube.',
    fields: [
      { name: 'youtube', label: 'YouTube-adres of -id', kind: 'youtube', max: 300, required: true },
      { name: 'titel', label: 'Titel (voor schermlezers en op het startvlak)', kind: 'text', max: 200 },
      { name: 'foto', label: 'Startbeeld (optioneel)', kind: 'image' },
    ],
  },
  faq: {
    label: 'Veelgestelde vragen',
    help: 'De vragen uit de FAQ, van één categorie of alle, om uit te klappen.',
    styleDefaults: { breedte: 'normaal' },
    fields: [{ name: 'categorie', label: 'Categorie', kind: 'source', source: 'faq', empty: 'Alle categorieën' }],
  },
  reizen: {
    label: 'Reizen',
    help: 'De komende reizen, gefilterd op reistype en/of land, als tegels of als lijst.',
    styleDefaults: { breedte: 'normaal' },
    fields: [
      { name: 'type', label: 'Reistype', kind: 'source', source: 'types', empty: 'Alle reistypes' },
      { name: 'land', label: 'Land', kind: 'source', source: 'countries', empty: 'Alle landen' },
      { name: 'aantal', label: 'Hoeveel reizen', kind: 'select', choices: { 6: '6', 3: '3', 9: '9', 12: '12', 24: '24', 60: 'Alle (max. 60)' } },
      { name: 'weergave', label: 'Weergave', kind: 'select', choices: { tegels: 'Tegels (zoals last-minutes)', lijst: 'Lijst met prijs (zoals het reisoverzicht)' } },
      { name: 'beschikbaar', label: 'Volgeboekte reizen', kind: 'select', choices: { tonen: 'Ook tonen', verbergen: 'Niet tonen' } },
    ],
  },
  reistypes: {
    label: 'Reistypes',
    help: 'De reistypes als tegels met icoon.',
    styleDefaults: { breedte: 'normaal', achtergrond: 'soil', ruimteBoven: 'normaal' },
    fields: [{ name: 'keuze', label: 'Welke', kind: 'select', choices: { homepage: 'Zoals op de homepage', alle: 'Alle reistypes met reizen' } }],
  },
  bestemmingen: {
    label: 'Bestemmingen',
    help: 'De landen als fotobanners in een schuifrij.',
    styleDefaults: { breedte: 'vol' },
    fields: [{ name: 'keuze', label: 'Welke', kind: 'select', choices: { homepage: 'Zoals op de homepage', alle: 'Alle landen met reizen' } }],
  },
  // Secties van de homepage (CMS-pakket H4): dezelfde opmaak als de vaste homepage (`site/home-view.js`), alleen op
  // de homepage te gebruiken (`homeOnly`). Ze hebben hun eigen achtergrond en breedte; de stijlopties blijven standaard.
  'home-slider': {
    label: 'Slider bovenaan (homepage)',
    help: 'Grote foto\'s (of een stille YouTube-video) met bovenkop, titel en knop. Dia 1 krijgt foto 1, dia 2 foto 2, enz.; zonder foto een foto van een reis.',
    homeOnly: true,
    fields: [
      {
        name: 'dias',
        label: 'Dia',
        kind: 'repeat',
        count: MAX_HOME_SLIDES,
        fields: [
          { name: 'bovenkop', label: 'Bovenkop', kind: 'text', max: 120 },
          { name: 'titel', label: 'Titel', kind: 'text', max: 120 },
          { name: 'knoptekst', label: 'Tekst van de knop', kind: 'text', max: 60 },
          { name: 'link', label: 'Adres van de knop', kind: 'link', max: 300 },
          { name: 'youtube', label: 'YouTube-video als achtergrond (optioneel)', kind: 'youtube', max: 300 },
        ],
      },
      { name: 'fotos', label: 'Foto\'s (in de volgorde van de dia\'s)', kind: 'images', max: MAX_HOME_SLIDES },
    ],
  },
  'home-zoekbalk': {
    label: 'Zoekbalk "Vind jouw reis" (homepage)',
    help: 'De balk met bestemming, type reis, vertrek en nieuwe reizen. Geen velden: de keuzes komen uit de reizen.',
    homeOnly: true,
    fields: [],
  },
  'home-lastminutes': {
    label: 'Last-minutes (homepage)',
    help: 'De eerstvolgende reizen met plek, in tegels.',
    homeOnly: true,
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 120, required: true },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 160 },
      { name: 'knoptekst', label: 'Tekst van de knop naar alle reizen', kind: 'text', max: 60 },
    ],
  },
  'home-reistypes': {
    label: 'Reistypes (homepage)',
    help: 'De reistypes met *tonen op de homepage* (Reistypes en landen); staat er geen aan, dan alle met reizen.',
    homeOnly: true,
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 120, required: true },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 160 },
    ],
  },
  'home-inspiratie': {
    label: 'Inspiratie-slider (homepage)',
    help: 'Grote foto met een tekstvak, met pijlen. Dia 1 krijgt foto 1, enz.',
    homeOnly: true,
    fields: [
      {
        name: 'dias',
        label: 'Dia',
        kind: 'repeat',
        count: MAX_HOME_SLIDES,
        fields: [
          { name: 'titel', label: 'Titel', kind: 'text', max: 120 },
          { name: 'tekst', label: 'Tekst', kind: 'textarea', max: 600 },
        ],
      },
      { name: 'fotos', label: 'Foto\'s (in de volgorde van de dia\'s)', kind: 'images', max: MAX_HOME_SLIDES },
    ],
  },
  'home-bestemmingen': {
    label: 'Bestemmingen (homepage)',
    help: 'De landen met *tonen op de homepage* als fotobanners; staat er geen aan, dan alle met reizen.',
    homeOnly: true,
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 120, required: true },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 160 },
    ],
  },
  'home-blog': {
    label: 'Blog (homepage)',
    help: 'De drie nieuwste berichten en het uitgelichte bericht groot.',
    homeOnly: true,
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 120, required: true },
      { name: 'subtitel', label: 'Subtitel', kind: 'text', max: 160 },
      { name: 'knoptekst', label: 'Tekst van de knop naar het weblog', kind: 'text', max: 60 },
    ],
  },
  'home-over': {
    label: 'Over Avanta met stempel (homepage)',
    help: 'Foto met stempel en een tekst met link ("Voor Avanta Reizen is geen bestemming te ver"). De titel is de hoofdkop (h1) van de homepage.',
    homeOnly: true,
    fields: [
      { name: 'titel', label: 'Titel', kind: 'text', max: 160, required: true },
      { name: 'tekst', label: 'Tekst', kind: 'textarea', max: 1200 },
      { name: 'linktekst', label: 'Tekst van de link', kind: 'text', max: 60 },
      { name: 'link', label: 'Adres van de link', kind: 'link', max: 300 },
      { name: 'foto', label: 'Foto', kind: 'image' },
    ],
  },
};

/** Bronnen van keuzelijsten die uit de database komen (`source`): wat de waarde moet zijn. */
const SOURCE_PATTERNS = { types: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, countries: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, faq: /^[^<>]{1,120}$/ };

/**
 * Haalt het YouTube-id uit een adres of id (watch, youtu.be, embed, shorts, nocookie).
 * @param {string} input Invoer.
 * @returns {string} Id, of leeg als het geen YouTube-video is.
 */
function youtubeId(input) {
  const text = String(input || '').trim();
  if (YOUTUBE_ID_PATTERN.test(text)) return text;
  let url;
  try {
    url = new URL(text);
  } catch (_) {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let candidate = '';
  if (host === 'youtu.be') candidate = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const match = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname);
    candidate = match ? match[1] : (url.pathname === '/watch' ? url.searchParams.get('v') || '' : '');
  }
  return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : '';
}

/**
 * Maakt een nieuw, uniek blok-id.
 * @returns {string} Id.
 */
function newBlockId() {
  return `b${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * De standaardwaarde van een veld.
 * @param {any} field Velddefinitie.
 * @returns {*} Waarde.
 */
function defaultValue(field) {
  if (field.kind === 'select') return Object.keys(field.choices)[0];
  if (field.kind === 'image') return null;
  if (field.kind === 'repeat' || field.kind === 'images') return [];
  return '';
}

/**
 * Een nieuw, leeg blok van een type.
 * @param {string} type Bloktype.
 * @returns {(any|null)} Blok, of null bij een onbekend type.
 */
function newBlock(type) {
  if (!Object.hasOwn(BLOCK_TYPES, type)) return null;
  const data = {};
  for (const field of BLOCK_TYPES[type].fields) data[field.name] = defaultValue(field);
  return { id: newBlockId(), type, data, style: normalizeStyle({ ...defaultStyle(), ...(BLOCK_TYPES[type].styleDefaults || {}) }) };
}

/**
 * De standaardstijl van een blok.
 * @returns {any} Stijl.
 */
function defaultStyle() {
  return Object.fromEntries(Object.entries(STYLE_OPTIONS).map(([name, option]) => [name, Object.keys(option.choices)[0]]));
}

/**
 * Leest de stijl van een blok: onbekende of ontbrekende keuzes worden de standaard.
 * @param {*} style Opgeslagen of ingezonden stijl.
 * @returns {any} Stijl met alleen geldige keuzes.
 */
function normalizeStyle(style) {
  const source = style && typeof style === 'object' ? style : {};
  const result = defaultStyle();
  for (const [name, option] of Object.entries(STYLE_OPTIONS)) {
    if (typeof source[name] === 'string' && Object.hasOwn(option.choices, source[name])) result[name] = source[name];
  }
  return result;
}

/**
 * Of een stijl helemaal de standaard is (dan geen omhullende sectie, zodat bestaande pagina's precies zo blijven).
 * @param {any} style Genormaliseerde stijl.
 * @returns {boolean} Waar bij de standaard.
 */
function isDefaultStyle(style) {
  const standard = defaultStyle();
  return Object.keys(standard).every((name) => style[name] === standard[name]);
}

/**
 * Leest één tekst uit een formulier (een herhaald veld telt als leeg).
 * @param {any} body Ingezonden velden.
 * @param {string} name Naam.
 * @returns {string} Tekst.
 */
function formText(body, name) {
  return typeof body[name] === 'string' ? body[name] : '';
}

/**
 * Controleert één veld (geen `image` of `repeat`).
 * @param {any} field Velddefinitie.
 * @param {string} input Ingezonden tekst.
 * @returns {{value: *, error?: string}} Waarde en eventueel een fout.
 */
function validateField(field, input) {
  if (field.kind === 'select') {
    return Object.hasOwn(field.choices, input) ? { value: input } : { value: defaultValue(field) };
  }
  if (field.kind === 'youtube') {
    if (!field.required && !input.trim()) return { value: '' };
    const id = youtubeId(input);
    if (!id) return { value: '', error: input.trim() ? 'Dit is geen YouTube-adres. Plak het adres van de video (youtube.com/watch?v=… of youtu.be/…).' : 'Vul dit veld in.' };
    return { value: id };
  }
  if (field.kind === 'source') {
    const value = input.trim();
    return !value || SOURCE_PATTERNS[field.source].test(value) ? { value } : { value: '', error: 'Kies een waarde uit de lijst.' };
  }
  if (field.kind === 'richtext') {
    if (input.length > field.max) return { value: '', error: 'De tekst is te lang.' };
    const value = sanitizeHtml(input);
    return field.required && !value ? { value, error: 'Vul dit veld in.' } : { value };
  }
  return validatePlainField(field, input);
}

/**
 * Controleert een veld met gewone tekst (tekst, tekstvak of link): zonder stuurtekens, witruimte samengevoegd (behalve
 * in een tekstvak), hoogstens `max` tekens en een link alleen naar deze site, https, mailto of tel.
 * @param {any} field Velddefinitie.
 * @param {string} input Ingezonden tekst.
 * @returns {{value: string, error?: string}} Waarde en eventueel een fout.
 */
function validatePlainField(field, input) {
  // eslint-disable-next-line no-control-regex
  const withoutControls = input.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  const value = field.kind === 'textarea' ? withoutControls.trim() : withoutControls.replace(/\s+/g, ' ').trim();
  if (value.length > field.max) return { value: value.slice(0, field.max), error: `Maximaal ${field.max} tekens.` };
  if (field.required && !value) return { value, error: 'Vul dit veld in.' };
  if (field.kind === 'link' && value && (!isSafeUrl(value) || /^http:/i.test(value))) {
    return { value, error: 'Gebruik een adres op deze site (begint met /), https://, mailto: of tel:.' };
  }
  return { value };
}

/**
 * Leest een fotoreeks (`images`) uit het formulier. Foto's komen van het fotoscherm; hier kun je ze alleen weghalen
 * (vinkje `f_<naam>_weg`) of verplaatsen (volgnummer `f_<naam>_<index>_volgorde`).
 * @param {any} field Velddefinitie.
 * @param {any[]} images Huidige foto's van het blok.
 * @param {any} body Ingezonden velden.
 * @returns {any[]} De overgebleven foto's in de nieuwe volgorde.
 */
function imagesFromForm(field, images, body) {
  const removed = new Set([].concat(body[`f_${field.name}_weg`] || []).filter((value) => typeof value === 'string'));
  const current = images.map((image, index) => {
    const position = Number.parseInt(formText(body, `f_${field.name}_${index}_volgorde`), 10);
    return { image, index, position: Number.isFinite(position) ? position : index + 1 };
  });
  return current.filter((item) => !removed.has(String(item.index)))
    .sort((left, right) => left.position - right.position || left.index - right.index)
    .map((item) => item.image);
}

/**
 * Leest de regels van een herhaalveld (`repeat`) uit het formulier (`f_<naam>_<regel>_<subveld>`). Een regel telt
 * alleen mee als minstens één subveld dat geen keuzelijst is een waarde heeft.
 * @param {any} field Velddefinitie met `count` en `fields`.
 * @param {any} body Ingezonden velden.
 * @param {any} errors Fouten per veldnaam; deze functie vult ze aan.
 * @returns {any[]} De ingevulde regels.
 */
function repeatRowsFromForm(field, body, errors) {
  const rows = [];
  for (let index = 0; index < field.count; index++) {
    const row = {};
    let filled = false;
    for (const sub of field.fields) {
      const name = `f_${field.name}_${index}_${sub.name}`;
      const result = validateField(sub, formText(body, name));
      row[sub.name] = result.value;
      if (result.error) errors[name] = result.error;
      if (sub.kind !== 'select' && result.value) filled = true;
    }
    if (filled) rows.push(row);
  }
  return rows;
}

/**
 * Controleert de ingezonden velden van een blok. Velden heten `f_<naam>` (bij `repeat`: `f_<naam>_<regel>_<subveld>`),
 * stijlopties `s_<naam>`. Een foto (`image`) wijzigt hier niet: die komt van het fotoscherm en blijft zoals hij was.
 * @param {any} block Het huidige blok.
 * @param {any} body Ingezonden velden.
 * @returns {{block: any, errors: any}} Het nieuwe blok en fouten per veldnaam.
 */
function validateBlockForm(block, body) {
  const definition = BLOCK_TYPES[block.type];
  const data = {};
  const errors = {};
  for (const field of definition.fields) {
    if (field.kind === 'image') {
      data[field.name] = block.data[field.name] || null;
    } else if (field.kind === 'images') {
      data[field.name] = imagesFromForm(field, block.data[field.name] || [], body);
    } else if (field.kind === 'repeat') {
      data[field.name] = repeatRowsFromForm(field, body, errors);
    } else {
      const result = validateField(field, formText(body, `f_${field.name}`));
      data[field.name] = result.value;
      if (result.error) errors[`f_${field.name}`] = result.error;
    }
  }
  if (block.type === 'banner' && Boolean(data.knoptekst) !== Boolean(data.link)) {
    errors[data.knoptekst ? 'f_link' : 'f_knoptekst'] = 'Vul zowel de tekst als het adres van de knop in, of geen van beide.';
  }
  if (block.type === 'kolommen') {
    data.kolommen.forEach((row, index) => {
      if (!row.titel && !row.tekst) errors[`f_kolommen_${index}_titel`] = 'Geef de kolom een titel of tekst.';
      if (row.linktekst && !row.link) errors[`f_kolommen_${index}_link`] = 'Vul het adres van de link in.';
    });
  }
  if (block.type === 'knoppen') {
    data.knoppen.forEach((row, index) => {
      if (!row.tekst) errors[`f_knoppen_${index}_tekst`] = 'Vul de tekst van de knop in.';
      if (!row.link) errors[`f_knoppen_${index}_link`] = 'Vul het adres van de knop in.';
    });
  }
  if (block.type === 'home-slider' || block.type === 'home-inspiratie') {
    data.dias.forEach((row, index) => {
      if (!row.titel) errors[`f_dias_${index}_titel`] = 'Geef de dia een titel.';
      if (block.type === 'home-slider' && Boolean(row.knoptekst) !== Boolean(row.link)) {
        errors[`f_dias_${index}_${row.knoptekst ? 'link' : 'knoptekst'}`] = 'Vul zowel de tekst als het adres van de knop in, of geen van beide.';
      }
    });
  }
  if (block.type === 'home-over' && Boolean(data.linktekst) !== Boolean(data.link)) {
    errors[data.linktekst ? 'f_link' : 'f_linktekst'] = 'Vul zowel de tekst als het adres van de link in, of geen van beide.';
  }
  const style = {};
  for (const name of Object.keys(STYLE_OPTIONS)) style[name] = formText(body, `s_${name}`);
  return { block: { id: block.id, type: block.type, data, style: normalizeStyle(style) }, errors };
}

/**
 * Hoe een opgeslagen veld per soort wordt teruggelezen; een soort zonder regel is gewone tekst.
 * @type {Record<string, (field: any, value: *) => *>}
 */
const STORED_FIELD_READERS = {
  image: (_field, value) => normalizeImage(value),
  images: (field, value) => (Array.isArray(value) ? value : []).map(normalizeImage).filter(Boolean).slice(0, field.max),
  youtube: (_field, value) => (typeof value === 'string' && YOUTUBE_ID_PATTERN.test(value) ? value : ''),
  source: (field, value) => (typeof value === 'string' && (!value || SOURCE_PATTERNS[field.source].test(value)) ? value : ''),
  repeat: (field, value) => (Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(0, field.count) : []),
  select: (field, value) => (typeof value === 'string' && Object.hasOwn(field.choices, value) ? value : defaultValue(field)),
};

/**
 * Leest een opgeslagen blok terug (uit de database of een versie): onbekende types vallen weg, velden krijgen hun
 * standaard als ze ontbreken. De inhoud is bij het opslaan al gecontroleerd; dit beschermt tegen oude of kapotte JSON.
 * @param {*} stored Opgeslagen blok.
 * @returns {(any|null)} Blok, of null als het niet te gebruiken is.
 */
function normalizeBlock(stored) {
  if (!stored || typeof stored !== 'object' || !Object.hasOwn(BLOCK_TYPES, stored.type)) return null;
  const id = typeof stored.id === 'string' && BLOCK_ID_PATTERN.test(stored.id) ? stored.id : newBlockId();
  const source = stored.data && typeof stored.data === 'object' ? stored.data : {};
  const data = {};
  for (const field of BLOCK_TYPES[stored.type].fields) {
    const normalize = Object.hasOwn(STORED_FIELD_READERS, field.kind) ? STORED_FIELD_READERS[field.kind] : null;
    const value = source[field.name];
    data[field.name] = normalize ? normalize(field, value) : (typeof value === 'string' ? value : '');
  }
  return { id, type: stored.type, data, style: normalizeStyle(stored.style) };
}

/**
 * Leest een opgeslagen foto van een blok: `{mediaId, url, alt, width, height}` met een adres onder `/media/`.
 * @param {*} value Opgeslagen waarde.
 * @returns {(any|null)} Foto of null.
 */
function normalizeImage(value) {
  if (!value || typeof value !== 'object') return null;
  const url = typeof value.url === 'string' && /^\/media\/[A-Za-z0-9._-]+$/.test(value.url) ? value.url : '';
  if (!url) return null;
  const size = (number) => (Number.isInteger(number) && number > 0 && number < 100_000 ? number : null);
  return {
    mediaId: Number.isInteger(value.mediaId) ? value.mediaId : null,
    url,
    alt: typeof value.alt === 'string' ? value.alt.slice(0, 300) : '',
    width: size(value.width),
    height: size(value.height),
  };
}

/**
 * Leest een lijst opgeslagen blokken.
 * @param {*} stored JSON uit de database.
 * @returns {any[]} Bruikbare blokken (hoogstens `MAX_BLOCKS`).
 */
function normalizeBlocks(stored) {
  return (Array.isArray(stored) ? stored : []).map(normalizeBlock).filter(Boolean).slice(0, MAX_BLOCKS);
}

/**
 * De gepubliceerde blokken van een pagina. Een pagina die nog nooit in het CRM is gepubliceerd en (nog) geen blokken
 * heeft, maar wel tekst uit de import (bijv. ingevoegd buiten de import om), toont die tekst als één tekstblok.
 * @param {{blocks?: *, body_html?: string, managed_in_crm?: boolean}} page Rij uit de tabel `pages`.
 * @returns {any[]} Blokken.
 */
function publishedBlocks(page) {
  const blocks = normalizeBlocks(page.blocks);
  if (blocks.length || page.managed_in_crm || !page.body_html) return blocks;
  return [{ id: `b${crypto.createHash('sha256').update(String(page.body_html)).digest('hex').slice(0, 12)}`, type: 'tekst', data: { html: String(page.body_html) }, style: defaultStyle() }];
}

/**
 * De id's van de foto's uit de bibliotheek die in blokken staan (om bij publiceren te vergrendelen).
 * @param {any[]} blocks Blokken.
 * @returns {number[]} Unieke id's.
 */
function mediaIdsOf(blocks) {
  const ids = new Set();
  for (const block of blocks) {
    for (const field of BLOCK_TYPES[block.type].fields) {
      const value = block.data[field.name];
      const images = field.kind === 'image' ? [value] : field.kind === 'images' ? value : [];
      for (const image of images) if (image && image.mediaId) ids.add(image.mediaId);
    }
  }
  return [...ids];
}

/**
 * De omschrijving per bloktype in de lijst van het CRM, uit de gegevens van het blok. Een homepage-sectie zonder eigen
 * regel toont haar titel.
 * @type {Record<string, (data: any) => string>}
 */
const BLOCK_SUMMARIES = {
  tekst: (data) => String(data.html).replace(/<[^>]*>/g, ' '),
  kop: (data) => data.titel,
  afbeelding: (data) => data.bijschrift || (data.foto ? data.foto.alt || 'foto gekozen' : 'nog geen foto'),
  knoppen: (data) => data.knoppen.map((row) => row.tekst).join(' · '),
  citaat: (data) => data.tekst,
  'tekst-afbeelding': (data) => String(data.html).replace(/<[^>]*>/g, ' '),
  galerij: (data) => `${data.titel || 'Galerij'} (${data.fotos.length} foto's)`,
  kolommen: (data) => data.kolommen.map((row) => row.titel).filter(Boolean).join(' · '),
  banner: (data) => data.titel,
  video: (data) => data.titel || data.youtube,
  faq: (data) => data.categorie || 'alle categorieën',
  reizen: (data) => [data.type, data.land].filter(Boolean).join(', ') || 'alle reizen',
  reistypes: (data) => (data.keuze === 'alle' ? 'alle met reizen' : 'zoals op de homepage'),
  bestemmingen: (data) => (data.keuze === 'alle' ? 'alle met reizen' : 'zoals op de homepage'),
  'home-slider': (data) => data.dias.map((row) => row.titel).filter(Boolean).join(' · ') || 'nog geen dia\'s',
  'home-inspiratie': (data) => data.dias.map((row) => row.titel).filter(Boolean).join(' · ') || 'nog geen dia\'s',
  'home-zoekbalk': () => 'bestemming, type, vertrek',
};

/**
 * Een korte omschrijving van een blok voor de lijst in het CRM.
 * @param {any} block Blok.
 * @returns {string} Tekst (hoogstens 80 tekens).
 */
function blockSummary(block) {
  const describe = Object.hasOwn(BLOCK_SUMMARIES, block.type) ? BLOCK_SUMMARIES[block.type] : null;
  let text = describe ? describe(block.data) : '';
  if (!describe && block.type.startsWith('home-')) text = block.data.titel;
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

module.exports = {
  BLOCK_TYPES,
  STYLE_OPTIONS,
  BUTTON_STYLES,
  MAX_BLOCKS,
  MAX_TRIP_BLOCKS,
  MAX_HOME_SLIDES,
  BLOCK_ID_PATTERN,
  newBlock,
  newBlockId,
  defaultStyle,
  normalizeStyle,
  isDefaultStyle,
  validateBlockForm,
  normalizeBlock,
  normalizeBlocks,
  publishedBlocks,
  normalizeImage,
  mediaIdsOf,
  blockSummary,
  YOUTUBE_ID_PATTERN,
  youtubeId,
  MAX_GALLERY_IMAGES,
  GALLERY_DISPLAYS,
};
