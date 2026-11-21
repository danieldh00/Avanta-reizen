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
const { contentBlocks } = require('../site/page-view');

/** Maximaal aantal blokken op één pagina. */
const MAX_BLOCKS = 60;

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
};

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
  if (field.kind === 'repeat') return [];
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
  return { id: newBlockId(), type, data, style: defaultStyle() };
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
  if (block.type === 'knoppen') {
    data.knoppen.forEach((row, index) => {
      if (!row.tekst) errors[`f_knoppen_${index}_tekst`] = 'Vul de tekst van de knop in.';
      if (!row.link) errors[`f_knoppen_${index}_link`] = 'Vul het adres van de knop in.';
    });
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
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * HTML van de inhoud van één blok (zonder de omhullende sectie).
 * @param {object} block Genormaliseerd blok.
 * @param {{title: string}} context Titel van de pagina (voor video's in een tekstblok).
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
      const buttons = data.knoppen.filter((row) => row.tekst && row.link && isSafeUrl(row.link) && !/^http:/i.test(row.link));
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
    default:
      return { markup: '', hasVideo: false };
  }
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
 * @param {{title: string}} context Titel van de pagina.
 * @returns {{body: (object|string), hasVideo: boolean}} HTML en of er een video in staat (voor de CSP).
 */
function renderBlocks(blocks, context) {
  let hasVideo = false;
  const parts = [];
  for (const block of normalizeBlocks(blocks)) {
    const content = renderBlockContent(block, context);
    hasVideo = hasVideo || content.hasVideo;
    const empty = !content.markup || (Array.isArray(content.markup) && !content.markup.length);
    if (empty) continue;
    parts.push(isDefaultStyle(block.style) ? content.markup : html`<div class="${sectionClasses(block.style)}">${content.markup}</div>`);
  }
  return { body: parts.length ? html`<div class="page-content">${parts}</div>` : '', hasVideo };
}

module.exports = {
  BLOCK_TYPES,
  STYLE_OPTIONS,
  BUTTON_STYLES,
  MAX_BLOCKS,
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
};
