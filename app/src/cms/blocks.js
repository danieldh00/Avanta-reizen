/**
 * De blokken-motor van het CMS (pakket H): een pagina is een lijst blokken (JSON in `pages.blocks` en het concept in
 * `pages.draft`). Elk bloktype heeft vaste velden en elk blok dezelfde stijlopties uit de huisstijl (achtergrond,
 * breedte, uitlijning, ruimte boven en onder); vrije HTML of CSS bestaat niet. Dit bestand bevat de definities, de
 * controle van ingezonden velden en de HTML voor de site. Alles gaat door `html\`…\`` (escapen); opgemaakte tekst gaat
 * bij het opslaan door `sanitizeHtml` en wordt alleen daarna als raw ingevoegd.
 *
 * Vorm van een blok: `{ id: 'b' + 12 hex, type, data: {…velden}, style: {…stijlopties} }`.
 */
const crypto = require('node:crypto');
const { html, raw } = require('../site/html');
const { sanitizeHtml, isSafeUrl } = require('../../tools/import/sanitize');
const { contentBlocks, faqList, arrangePosts } = require('../site/page-view');
const { renderGallery, tripList } = require('../site/trip-view');
const {
  tripBox, renderSlides, renderFilterBar, renderLastMinutes, renderTripTypes, renderInspiration, renderDestinations, renderBlog, renderAbout,
} = require('../site/home-view');
const { cssImageUrl } = require('../site/layout');
const { icon, categoryIconName } = require('../site/icons');
const { categoryPath } = require('../site/format');
const { YOUTUBE_ORIGIN } = require('../site/homepage');

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
 * @param {object} field Velddefinitie.
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
 * @returns {(object|null)} Blok, of null bij een onbekend type.
 */
function newBlock(type) {
  if (!Object.hasOwn(BLOCK_TYPES, type)) return null;
  const data = {};
  for (const field of BLOCK_TYPES[type].fields) data[field.name] = defaultValue(field);
  return { id: newBlockId(), type, data, style: normalizeStyle({ ...defaultStyle(), ...(BLOCK_TYPES[type].styleDefaults || {}) }) };
}

/**
 * De standaardstijl van een blok.
 * @returns {object} Stijl.
 */
function defaultStyle() {
  return Object.fromEntries(Object.entries(STYLE_OPTIONS).map(([name, option]) => [name, Object.keys(option.choices)[0]]));
}

/**
 * Leest de stijl van een blok: onbekende of ontbrekende keuzes worden de standaard.
 * @param {*} style Opgeslagen of ingezonden stijl.
 * @returns {object} Stijl met alleen geldige keuzes.
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
 * @param {object} style Genormaliseerde stijl.
 * @returns {boolean} Waar bij de standaard.
 */
function isDefaultStyle(style) {
  const standard = defaultStyle();
  return Object.keys(standard).every((name) => style[name] === standard[name]);
}

/**
 * Leest één tekst uit een formulier (een herhaald veld telt als leeg).
 * @param {object} body Ingezonden velden.
 * @param {string} name Naam.
 * @returns {string} Tekst.
 */
function formText(body, name) {
  return typeof body[name] === 'string' ? body[name] : '';
}

/**
 * Controleert één veld (geen `image` of `repeat`).
 * @param {object} field Velddefinitie.
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
 * Controleert de ingezonden velden van een blok. Velden heten `f_<naam>` (bij `repeat`: `f_<naam>_<regel>_<subveld>`),
 * stijlopties `s_<naam>`. Een foto (`image`) wijzigt hier niet: die komt van het fotoscherm en blijft zoals hij was.
 * @param {object} block Het huidige blok.
 * @param {object} body Ingezonden velden.
 * @returns {{block: object, errors: object}} Het nieuwe blok en fouten per veldnaam.
 */
function validateBlockForm(block, body) {
  const definition = BLOCK_TYPES[block.type];
  const data = {};
  const errors = {};
  for (const field of definition.fields) {
    if (field.kind === 'image') {
      data[field.name] = block.data[field.name] || null;
    } else if (field.kind === 'images') {
      // Foto's komen van het fotoscherm; hier kun je ze alleen weghalen of verplaatsen (vinkje of volgnummer).
      const removed = new Set([].concat(body[`f_${field.name}_weg`] || []).filter((value) => typeof value === 'string'));
      const current = (block.data[field.name] || []).map((image, index) => {
        const position = Number.parseInt(formText(body, `f_${field.name}_${index}_volgorde`), 10);
        return { image, index, position: Number.isFinite(position) ? position : index + 1 };
      });
      data[field.name] = current.filter((item) => !removed.has(String(item.index)))
        .sort((left, right) => left.position - right.position || left.index - right.index)
        .map((item) => item.image);
    } else if (field.kind === 'repeat') {
      const rows = [];
      for (let index = 0; index < field.count; index++) {
        const row = {};
        let filled = false;
        for (const sub of field.fields) {
          const input = formText(body, `f_${field.name}_${index}_${sub.name}`);
          const result = validateField(sub, input);
          row[sub.name] = result.value;
          if (result.error) errors[`f_${field.name}_${index}_${sub.name}`] = result.error;
          if (sub.kind !== 'select' && result.value) filled = true;
        }
        if (filled) rows.push(row);
      }
      data[field.name] = rows;
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
 * Leest een opgeslagen blok terug (uit de database of een versie): onbekende types vallen weg, velden krijgen hun
 * standaard als ze ontbreken. De inhoud is bij het opslaan al gecontroleerd; dit beschermt tegen oude of kapotte JSON.
 * @param {*} stored Opgeslagen blok.
 * @returns {(object|null)} Blok, of null als het niet te gebruiken is.
 */
function normalizeBlock(stored) {
  if (!stored || typeof stored !== 'object' || !Object.hasOwn(BLOCK_TYPES, stored.type)) return null;
  const id = typeof stored.id === 'string' && BLOCK_ID_PATTERN.test(stored.id) ? stored.id : newBlockId();
  const source = stored.data && typeof stored.data === 'object' ? stored.data : {};
  const data = {};
  for (const field of BLOCK_TYPES[stored.type].fields) {
    const value = source[field.name];
    if (field.kind === 'image') data[field.name] = normalizeImage(value);
    else if (field.kind === 'images') data[field.name] = (Array.isArray(value) ? value : []).map(normalizeImage).filter(Boolean).slice(0, field.max);
    else if (field.kind === 'youtube') data[field.name] = typeof value === 'string' && YOUTUBE_ID_PATTERN.test(value) ? value : '';
    else if (field.kind === 'source') data[field.name] = typeof value === 'string' && (!value || SOURCE_PATTERNS[field.source].test(value)) ? value : '';
    else if (field.kind === 'repeat') data[field.name] = Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(0, field.count) : [];
    else if (field.kind === 'select') data[field.name] = typeof value === 'string' && Object.hasOwn(field.choices, value) ? value : defaultValue(field);
    else data[field.name] = typeof value === 'string' ? value : '';
  }
  return { id, type: stored.type, data, style: normalizeStyle(stored.style) };
}

/**
 * Leest een opgeslagen foto van een blok: `{mediaId, url, alt, width, height}` met een adres onder `/media/`.
 * @param {*} value Opgeslagen waarde.
 * @returns {(object|null)} Foto of null.
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
 * @returns {object[]} Bruikbare blokken (hoogstens `MAX_BLOCKS`).
 */
function normalizeBlocks(stored) {
  return (Array.isArray(stored) ? stored : []).map(normalizeBlock).filter(Boolean).slice(0, MAX_BLOCKS);
}

/**
 * De gepubliceerde blokken van een pagina. Een pagina die nog nooit in het CRM is gepubliceerd en (nog) geen blokken
 * heeft, maar wel tekst uit de import (bijv. ingevoegd buiten de import om), toont die tekst als één tekstblok.
 * @param {{blocks?: *, body_html?: string, managed_in_crm?: boolean}} page Rij uit de tabel `pages`.
 * @returns {object[]} Blokken.
 */
function publishedBlocks(page) {
  const blocks = normalizeBlocks(page.blocks);
  if (blocks.length || page.managed_in_crm || !page.body_html) return blocks;
  return [{ id: `b${crypto.createHash('sha256').update(String(page.body_html)).digest('hex').slice(0, 12)}`, type: 'tekst', data: { html: String(page.body_html) }, style: defaultStyle() }];
}

/**
 * De id's van de foto's uit de bibliotheek die in blokken staan (om bij publiceren te vergrendelen).
 * @param {object[]} blocks Blokken.
 * @returns {number[]} Unieke id's.
 */
function mediaIdsOf(blocks) {
  const ids = new Set();
  for (const block of blocks) {
    for (const field of BLOCK_TYPES[block.type].fields) {
      if (field.kind === 'image' && block.data[field.name] && block.data[field.name].mediaId) ids.add(block.data[field.name].mediaId);
      if (field.kind === 'images') for (const image of block.data[field.name]) if (image.mediaId) ids.add(image.mediaId);
    }
  }
  return [...ids];
}

/**
 * Een korte omschrijving van een blok voor de lijst in het CRM.
 * @param {object} block Blok.
 * @returns {string} Tekst (hoogstens 80 tekens).
 */
function blockSummary(block) {
  const { data } = block;
  let text = '';
  if (block.type === 'tekst') text = String(data.html).replace(/<[^>]*>/g, ' ');
  else if (block.type === 'kop') text = data.titel;
  else if (block.type === 'afbeelding') text = data.bijschrift || (data.foto ? data.foto.alt || 'foto gekozen' : 'nog geen foto');
  else if (block.type === 'knoppen') text = data.knoppen.map((row) => row.tekst).join(' · ');
  else if (block.type === 'citaat') text = data.tekst;
  else if (block.type === 'tekst-afbeelding') text = String(data.html).replace(/<[^>]*>/g, ' ');
  else if (block.type === 'galerij') text = `${data.titel || 'Galerij'} (${data.fotos.length} foto's)`;
  else if (block.type === 'kolommen') text = data.kolommen.map((row) => row.titel).filter(Boolean).join(' · ');
  else if (block.type === 'banner') text = data.titel;
  else if (block.type === 'video') text = data.titel || data.youtube;
  else if (block.type === 'faq') text = data.categorie || 'alle categorieën';
  else if (block.type === 'reizen') text = [data.type, data.land].filter(Boolean).join(', ') || 'alle reizen';
  else if (block.type === 'reistypes' || block.type === 'bestemmingen') text = data.keuze === 'alle' ? 'alle met reizen' : 'zoals op de homepage';
  else if (block.type === 'home-slider' || block.type === 'home-inspiratie') text = data.dias.map((row) => row.titel).filter(Boolean).join(' · ') || 'nog geen dia\'s';
  else if (block.type === 'home-zoekbalk') text = 'bestemming, type, vertrek';
  else if (block.type.startsWith('home-')) text = data.titel;
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * HTML van de inhoud van één blok (zonder de omhullende sectie).
 * @param {object} block Genormaliseerd blok.
 * @param {{title: string, data?: object}} context Titel van de pagina (voor video's) en de gegevens uit `loadBlockData`.
 * @returns {{markup: (object|string), hasVideo: boolean}} HTML en of er een video in staat.
 */
function renderBlockContent(block, context) {
  const { data } = block;
  switch (block.type) {
    case 'tekst': {
      // Tekst gaat door dezelfde verdeling als de geïmporteerde pagina's (losse foto's, galerijen, video's).
      const { blocks, hasVideo } = contentBlocks(data.html, context.title);
      return { markup: blocks, hasVideo };
    }
    case 'kop': {
      if (!data.titel) return { markup: '', hasVideo: false };
      const title = data.niveau === 'h3' ? html`<h3 class="cms-heading__title cms-heading__title--small">${data.titel}</h3>` : html`<h2 class="cms-heading__title">${data.titel}</h2>`;
      return { markup: html`<div class="page-content__block cms-heading">${title}${data.subtitel ? html`<p class="cms-heading__subtitle">${data.subtitel}</p>` : ''}</div>`, hasVideo: false };
    }
    case 'afbeelding': {
      if (!data.foto) return { markup: '', hasVideo: false };
      const { foto } = data;
      return {
        markup: html`<figure class="page-content__image cms-image"><img src="${foto.url}" alt="${foto.alt}"${foto.width ? html` width="${foto.width}" height="${foto.height}"` : ''} loading="lazy">${data.bijschrift ? html`<figcaption class="cms-image__caption">${data.bijschrift}</figcaption>` : ''}</figure>`,
        hasVideo: false,
      };
    }
    case 'knoppen': {
      const buttons = data.knoppen.filter((row) => row.tekst && row.link && isSafeLink(row.link));
      if (!buttons.length) return { markup: '', hasVideo: false };
      return {
        markup: html`<div class="page-content__block cms-buttons">${buttons.map((row) => {
          const external = /^https:/i.test(row.link);
          return html`<a class="btn${row.stijl === 'omlijnd' ? ' btn--outline' : ''}" href="${row.link}"${external ? raw(' rel="noopener" target="_blank"') : ''}>${row.tekst}</a>`;
        })}</div>`,
        hasVideo: false,
      };
    }
    case 'citaat': {
      if (!data.tekst) return { markup: '', hasVideo: false };
      return {
        markup: html`<blockquote class="page-content__block cms-quote"><p class="cms-quote__text">${data.tekst}</p>${data.bron ? html`<p class="cms-quote__source">${data.bron}</p>` : ''}</blockquote>`,
        hasVideo: false,
      };
    }
    case 'tekst-afbeelding': {
      if (!data.html && !data.foto) return { markup: '', hasVideo: false };
      return {
        markup: html`<div class="page-content__block cms-media-text cms-media-text--${data.positie === 'links' ? 'links' : 'rechts'}">
          <div class="cms-media-text__text page-content__text">${raw(data.html)}</div>
          ${data.foto ? html`<figure class="cms-media-text__image"><img src="${data.foto.url}" alt="${data.foto.alt}" loading="lazy"></figure>` : ''}
        </div>`,
        hasVideo: false,
      };
    }
    case 'galerij': {
      if (!data.fotos.length) return { markup: '', hasVideo: false };
      return { markup: html`<div class="page-content__gallery">${renderGallery({ title: data.titel, subtitle: data.subtitel, images: data.fotos })}</div>`, hasVideo: false };
    }
    case 'kolommen': {
      const columns = data.kolommen.filter((row) => row.titel || row.tekst);
      if (!columns.length) return { markup: '', hasVideo: false };
      return {
        markup: html`<div class="page-content__block cms-columns cms-columns--${columns.length}">${columns.map((row) => html`<div class="cms-columns__item">
          ${row.titel ? html`<h3 class="cms-columns__title">${row.titel}</h3>` : ''}
          ${row.tekst ? html`<p class="cms-columns__text">${row.tekst}</p>` : ''}
          ${row.link && isSafeLink(row.link) ? html`<a class="cms-columns__link" href="${row.link}">${row.linktekst || 'Lees verder'}</a>` : ''}
        </div>`)}</div>`,
        hasVideo: false,
      };
    }
    case 'banner': {
      if (!data.titel) return { markup: '', hasVideo: false };
      const image = data.foto ? cssImageUrl(data.foto.url) : '';
      return {
        markup: html`<div class="page-content__block cms-banner${image ? '' : ' cms-banner--plain'}"${image ? html` style="background-image: url('${image}')"` : ''}>
          <div class="cms-banner__inner">
            <p class="cms-banner__title">${data.titel}</p>
            ${data.tekst ? html`<p class="cms-banner__text">${data.tekst}</p>` : ''}
            ${data.knoptekst && data.link && isSafeLink(data.link) ? html`<a class="btn" href="${data.link}">${data.knoptekst}</a>` : ''}
          </div>
        </div>`,
        hasVideo: false,
      };
    }
    case 'video': {
      if (!data.youtube) return { markup: '', hasVideo: false };
      const title = data.titel || `Video bij ${context.title}`;
      const poster = data.foto ? cssImageUrl(data.foto.url) : '';
      // Eerst een startvlak; pas na een klik (of een eerder onthouden keuze) zet public/js/site.js de iframe neer.
      return {
        markup: html`<div class="page-content__video-wrapper cms-video" data-video-consent data-video-id="${data.youtube}" data-video-title="${title}" data-video-origin="${YOUTUBE_ORIGIN}">
          <div class="page-content__video cms-video__frame"${poster ? html` style="background-image: url('${poster}')"` : ''}>
            <div class="cms-video__notice">
              <p class="cms-video__title">${title}</p>
              <p class="cms-video__text">Deze video staat op YouTube. Speel je hem af, dan maakt je browser verbinding met YouTube (youtube-nocookie.com) en kan YouTube gegevens over je bezoek verwerken.</p>
              <p class="cms-video__actions"><button class="btn" type="button" data-video-play>Video afspelen</button>
                <a class="cms-video__link" href="${`https://www.youtube.com/watch?v=${data.youtube}`}" rel="noopener" target="_blank">Bekijk op YouTube</a></p>
              <label class="cms-video__remember"><input type="checkbox" data-video-remember> Video's op deze site voortaan direct laden (12 maanden, intrekbaar onder elke video)</label>
            </div>
          </div>
        </div>`,
        hasVideo: true,
      };
    }
    case 'faq': {
      const faqs = (context.data && context.data.faqs) || [];
      const chosen = data.categorie ? faqs.filter((faq) => faq.category.toLowerCase() === data.categorie.toLowerCase()) : faqs;
      if (!chosen.length) return { markup: '', hasVideo: false };
      return { markup: html`<div class="page-content__block cms-embed">${faqList(chosen)}</div>`, hasVideo: false };
    }
    case 'reizen': {
      const trips = (context.data && context.data.trips && context.data.trips.get(block.id)) || [];
      const list = data.weergave === 'lijst' ? tripList(trips, 'Op dit moment zijn er geen reizen die hierbij passen.')
        : (trips.length ? html`<div class="grid grid--3col">${trips.map((trip) => html`<div class="grid__item">${tripBox(trip)}</div>`)}</div>` : html`<div class="alert">Op dit moment zijn er geen reizen die hierbij passen.</div>`);
      return { markup: html`<div class="page-content__block cms-embed cms-trips">${list}</div>`, hasVideo: false };
    }
    case 'reistypes': {
      const types = chooseCategories((context.data && context.data.types) || [], data.keuze);
      if (!types.length) return { markup: '', hasVideo: false };
      return {
        markup: html`<div class="page-content__block cms-embed"><div class="trip-types texture-overlay">${types.map((type) => html`<a class="trip-type" href="${categoryPath(type.slug)}">
          ${icon(categoryIconName(type), { className: 'trip-type__icon' })}
          <span class="trip-type__title">${type.name}</span>
        </a>`)}</div></div>`,
        hasVideo: false,
      };
    }
    case 'bestemmingen': {
      const destinations = chooseCategories((context.data && context.data.destinations) || [], data.keuze);
      if (!destinations.length) return { markup: '', hasVideo: false };
      return {
        markup: html`<div class="page-content__block cms-embed"><div class="destinations" data-scroller>
          <ul class="destinations__track" data-scroller-track>${destinations.map((destination) => {
            const image = cssImageUrl(destination.image_url);
            return html`<li class="destinations__item"><a class="banner banner--fullimage" href="${categoryPath(destination.slug)}"${image ? html` style="background-image: url('${image}')"` : ''}>
              <span class="banner__title">${destination.name}</span>
            </a></li>`;
          })}</ul>
          <div class="destinations__nav">
            <button class="slider-button" type="button" data-scroller-prev>${icon('chevron-left')}<span class="visually-hidden">Vorige bestemmingen</span></button>
            <button class="slider-button" type="button" data-scroller-next>${icon('chevron-right')}<span class="visually-hidden">Volgende bestemmingen</span></button>
          </div>
        </div></div>`,
        hasVideo: false,
      };
    }
    case 'home-slider': {
      const slides = data.dias.filter((row) => row.titel).map((row, index) => ({
        pretitle: row.bovenkop,
        title: row.titel,
        button: row.knoptekst,
        href: row.link && isSafeLink(row.link) ? row.link : '',
        videoId: typeof row.youtube === 'string' && YOUTUBE_ID_PATTERN.test(row.youtube) ? row.youtube : '',
        image: data.fotos[index] ? data.fotos[index].url : '',
        fallbackImage: data.fotos[index] ? '' : takeFallback(context),
      }));
      if (!slides.length) return { markup: '', hasVideo: false };
      return { markup: renderSlides(slides), hasVideo: slides.some((slide) => slide.videoId) };
    }
    case 'home-zoekbalk': {
      const home = (context.data && context.data.home) || {};
      if (!home.finder) return { markup: '', hasVideo: false };
      return { markup: renderFilterBar(home.finder, home.newCount || 0), hasVideo: false };
    }
    case 'home-lastminutes': {
      const home = (context.data && context.data.home) || {};
      return { markup: renderLastMinutes({ title: data.titel, subtitle: data.subtitel, button: data.knoptekst || 'Alle reizen' }, home.lastMinutes || []), hasVideo: false };
    }
    case 'home-reistypes': {
      const types = chooseCategories((context.data && context.data.types) || [], 'homepage');
      return { markup: renderTripTypes({ title: data.titel, subtitle: data.subtitel }, types), hasVideo: false };
    }
    case 'home-inspiratie': {
      const items = data.dias.filter((row) => row.titel).map((row, index) => ({
        title: row.titel,
        text: row.tekst,
        image: data.fotos[index] ? data.fotos[index].url : '',
        fallbackImage: data.fotos[index] ? '' : takeFallback(context),
      }));
      if (!items.length) return { markup: '', hasVideo: false };
      return { markup: renderInspiration(items), hasVideo: false };
    }
    case 'home-bestemmingen': {
      const destinations = chooseCategories((context.data && context.data.destinations) || [], 'homepage');
      return { markup: renderDestinations({ title: data.titel, subtitle: data.subtitel }, destinations), hasVideo: false };
    }
    case 'home-blog': {
      const home = (context.data && context.data.home) || {};
      return { markup: renderBlog({ title: data.titel, subtitle: data.subtitel, button: data.knoptekst || 'Meer blogberichten' }, home.posts || []), hasVideo: false };
    }
    case 'home-over': {
      return {
        markup: renderAbout({
          title: data.titel,
          text: data.tekst,
          linkLabel: data.linktekst,
          href: data.link && isSafeLink(data.link) ? data.link : '',
          image: data.foto ? data.foto.url : '',
          fallbackImage: data.foto ? '' : takeFallback(context),
        }),
        hasVideo: false,
      };
    }
    default:
      return { markup: '', hasVideo: false };
  }
}

/**
 * De volgende reserve-foto (kaartfoto van een reis) voor een dia of blok zonder eigen foto, elke keer een andere.
 * @param {{data?: {home?: {fallbackImages?: string[]}}, fallbackIndex?: number}} context Context van `renderBlocks`.
 * @returns {string} Adres, of leeg.
 */
function takeFallback(context) {
  const pool = (context.data && context.data.home && context.data.home.fallbackImages) || [];
  if (!pool.length) return '';
  const index = context.fallbackIndex || 0;
  context.fallbackIndex = index + 1;
  return pool[index % pool.length];
}

/**
 * Of een link veilig is voor een knop of kolom (eigen site, https, mailto of tel; geen http of javascript:).
 * @param {string} link Adres.
 * @returns {boolean} Waar als het mag.
 */
function isSafeLink(link) {
  return isSafeUrl(link) && !/^http:/i.test(link);
}

/**
 * Kiest reistypes of landen voor een blok: "zoals op de homepage" zijn de categorieën met *tonen op de homepage*
 * (staat er geen aan, dan alle met reizen), "alle" zijn alle categorieën met komende reizen.
 * @param {{show_on_home: boolean, trip_count: number}[]} categories Categorieën uit `content.categories`.
 * @param {string} choice `homepage` of `alle`.
 * @returns {object[]} Gekozen categorieën.
 */
function chooseCategories(categories, choice) {
  const withTrips = categories.filter((category) => category.trip_count > 0);
  if (choice === 'alle') return withTrips;
  const chosen = categories.filter((category) => category.show_on_home);
  return chosen.length ? chosen : withTrips;
}

/**
 * Haalt de gegevens op die de blokken nodig hebben (FAQ, reistypes, landen, reizen per reizenblok), alleen wat er in de
 * blokken voorkomt.
 * @param {object[]} blocks Genormaliseerde blokken.
 * @param {{faqs: Function, categories: Function, upcomingTrips: Function, departureDates?: Function, newTripCount?: Function, posts?: Function, postsBySlugs?: Function}} content
 *   Queries uit `site/content.js`.
 * @param {{featuredSlug?: string}} [options] Het uitgelichte blogbericht (`site-content.json`) voor het blogblok van de homepage.
 * @returns {Promise<{faqs?: object[], types?: object[], destinations?: object[], trips: Map<string, object[]>, home?: object}>} Gegevens.
 */
async function loadBlockData(blocks, content, options = {}) {
  const types = new Set(blocks.map((block) => block.type));
  const needsTypes = types.has('reistypes') || types.has('home-reistypes') || types.has('home-zoekbalk');
  const needsDestinations = types.has('bestemmingen') || types.has('home-bestemmingen') || types.has('home-zoekbalk');
  const tripBlocks = blocks.filter((block) => block.type === 'reizen');
  // Eén query per verschillend filter, hoogstens MAX_TRIP_BLOCKS; een blok daarboven blijft leeg.
  const filters = new Map();
  const keyOfBlock = new Map();
  for (const block of tripBlocks) {
    const filter = {
      type: block.data.type || undefined,
      destination: block.data.land || undefined,
      onlyAvailable: block.data.beschikbaar === 'verbergen',
      limit: Number(block.data.aantal) || 6,
    };
    const key = [filter.type, filter.destination, filter.onlyAvailable, filter.limit].join('|');
    if (!filters.has(key) && filters.size < MAX_TRIP_BLOCKS) filters.set(key, filter);
    keyOfBlock.set(block.id, key);
  }
  const filterKeys = [...filters.keys()];
  const [faqs, typeRows, destinationRows, tripRows] = await Promise.all([
    types.has('faq') ? content.faqs() : undefined,
    needsTypes ? content.categories('type') : undefined,
    needsDestinations ? content.categories('bestemming') : undefined,
    Promise.all(filterKeys.map((key) => content.upcomingTrips(filters.get(key)))),
  ]);
  const rowsByKey = new Map(filterKeys.map((key, index) => [key, tripRows[index]]));
  const trips = new Map(tripBlocks.map((block) => [block.id, rowsByKey.get(keyOfBlock.get(block.id)) || []]));
  const home = await loadHomeData(types, content, options, { types: typeRows, destinations: destinationRows });
  return { faqs, types: typeRows, destinations: destinationRows, trips, ...(home ? { home } : {}) };
}

/**
 * De gegevens van de homepage-secties (H4): keuzes voor de zoekbalk, last-minutes, blogberichten (drie nieuwste en het
 * uitgelichte groot) en kaartfoto's van reizen als reserve voor dia's zonder foto. Alleen wat de blokken nodig hebben.
 * @param {Set<string>} types Bloktypes op de pagina.
 * @param {object} content Queries uit `site/content.js`.
 * @param {{featuredSlug?: string}} options Uitgelicht blogbericht.
 * @param {{types?: object[], destinations?: object[]}} categories Al opgehaalde reistypes en landen.
 * @returns {Promise<(object|null)>} Gegevens, of null zonder homepage-secties.
 */
async function loadHomeData(types, content, options, categories) {
  const needsFallback = types.has('home-slider') || types.has('home-inspiratie') || types.has('home-over');
  if (![...types].some((type) => type.startsWith('home-'))) return null;
  const [dates, newCount, lastMinutes, blog, upcoming] = await Promise.all([
    types.has('home-zoekbalk') ? content.departureDates() : undefined,
    types.has('home-zoekbalk') ? content.newTripCount() : undefined,
    types.has('home-lastminutes') ? content.upcomingTrips({ onlyAvailable: true, limit: 6 }) : undefined,
    types.has('home-blog') ? content.posts({ perPage: 5 }) : undefined,
    needsFallback ? content.upcomingTrips({ limit: 60 }) : undefined,
  ]);
  let posts;
  if (blog) {
    const featuredSlug = options.featuredSlug || '';
    const featured = featuredSlug && !blog.posts.some((post) => post.slug === featuredSlug) ? (await content.postsBySlugs([featuredSlug]))[0] : null;
    const arranged = arrangePosts(featured ? [...blog.posts, featured] : blog.posts, featuredSlug);
    posts = [...arranged.list, ...(arranged.featured ? [arranged.featured] : [])];
  }
  return {
    finder: types.has('home-zoekbalk') ? { destinations: categories.destinations || [], types: categories.types || [], dates: dates || [] } : null,
    newCount: newCount || 0,
    lastMinutes: lastMinutes || [],
    posts: posts || [],
    fallbackImages: [...new Set((upcoming || []).map((trip) => cssImageUrl(trip.card_image_url)).filter(Boolean))],
  };
}

/**
 * CSS-klassen van de omhullende sectie van een blok.
 * @param {object} style Genormaliseerde stijl.
 * @returns {string} Klassen.
 */
function sectionClasses(style) {
  return [
    'cms-section',
    `cms-bg--${style.achtergrond}`,
    `cms-width--${style.breedte}`,
    `cms-align--${style.uitlijning}`,
    `cms-space-top--${style.ruimteBoven}`,
    `cms-space-bottom--${style.ruimteOnder}`,
  ].join(' ');
}

/**
 * HTML van een lijst blokken voor de site, binnen `page-content`. Een blok met de standaardstijl staat er los in (zoals
 * de geïmporteerde pagina's altijd stonden); een blok met een eigen stijl krijgt een omhullende sectie.
 * @param {*} blocks Opgeslagen blokken.
 * @param {{title: string, data?: object, homepage?: boolean}} context Titel van de pagina, de gegevens uit `loadBlockData`
 *   en of het de homepage is (dan omhult `homepage` in plaats van `page-content`, zoals de vaste homepage).
 * @returns {{body: (object|string), hasVideo: boolean}} HTML en of er een video in staat (voor de CSP).
 */
function renderBlocks(blocks, context) {
  let hasVideo = false;
  const parts = [];
  // Eigen kopie: de teller van de reservefoto's (`takeFallback`) loopt per weergave.
  const state = { ...context, fallbackIndex: 0 };
  for (const block of normalizeBlocks(blocks)) {
    const content = renderBlockContent(block, state);
    hasVideo = hasVideo || content.hasVideo;
    const empty = !content.markup || (Array.isArray(content.markup) && !content.markup.length);
    if (empty) continue;
    parts.push(isDefaultStyle(block.style) ? content.markup : html`<div class="${sectionClasses(block.style)}">${content.markup}</div>`);
  }
  if (!parts.length) return { body: '', hasVideo };
  return { body: context.homepage ? html`<div class="homepage">${parts}</div>` : html`<div class="page-content">${parts}</div>`, hasVideo };
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
  renderBlocks,
  loadBlockData,
  youtubeId,
  MAX_GALLERY_IMAGES,
};
