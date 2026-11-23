/**
 * Indeling van Beheer (`/app/beheer/`): groepen met secties in de zijbalk. Een sectie is een pagina
 * onder `/app/beheer/<id>/`. Een sectie met `fields` is een instellingenformulier voor die instellingen uit
 * `beheer/settings.js`; een sectie met `view` heeft een eigen weergave in `beheer/routes.js`. `words` zijn extra
 * zoekwoorden voor het zoekveld. De groepen zelf staan per bestand in `beheer/instellingen/` (naast hun instellingen).
 */
const { SETTING_GROUPS } = require('./instellingen');

/** De groepen van de zijbalk met hun secties. */
const GROUPS = SETTING_GROUPS.map((group) => group.GROUP);

/** Alle secties in één lijst, met de titel van hun groep. */
const SECTIONS = GROUPS.flatMap((group) => group.sections.map((section) => ({ ...section, group: group.title })));

/**
 * Zoekt een sectie op id.
 * @param {string} id Id uit de URL.
 * @returns {(object|undefined)} De sectie, of niets.
 */
function findSection(id) {
  return SECTIONS.find((section) => section.id === id);
}

/**
 * Maakt tekst geschikt om te zoeken: kleine letters, zonder accenten.
 * @param {string} text Tekst.
 * @returns {string} Genormaliseerde tekst.
 */
function normalizeSearch(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Filtert de groepen op een zoekterm: een sectie past als elk woord van de zoekterm voorkomt in de naam, de groep,
 * de zoekwoorden of de labels van haar instellingen.
 * @param {string} query Zoekterm (leeg = alles).
 * @param {object} fields Beschrijvingen van de instellingen (`SETTING_FIELDS`).
 * @returns {Array<{title: string, sections: object[]}>} Groepen met de passende secties (lege groepen vallen weg).
 */
function filterGroups(query, fields) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return GROUPS;
  return GROUPS.map((group) => ({
    title: group.title,
    sections: group.sections.filter((section) => {
      const labels = (section.fields || []).map((key) => (fields[key] ? `${fields[key].label} ${fields[key].help || ''}` : ''));
      const haystack = normalizeSearch([section.label, group.title, section.words, section.intro, ...labels].join(' '));
      return terms.every((term) => haystack.includes(term));
    }),
  })).filter((group) => group.sections.length);
}

module.exports = { GROUPS, SECTIONS, findSection, filterGroups, normalizeSearch };
