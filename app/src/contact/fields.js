/**
 * Velden en validatie van het contactformulier op `/contact/`. Gelijk aan het formulier van de huidige site (naam,
 * telefoonnummer, e-mailadres, bericht en akkoord met de privacyverklaring), aangevuld met een optioneel onderwerp.
 */

/** De velden in de volgorde van het formulier. */
const CONTACT_FIELDS = [
  { name: 'name', label: 'Naam', required: true, max: 120, autocomplete: 'name', full: true },
  { name: 'phone', label: 'Telefoonnummer', type: 'tel', max: 30, autocomplete: 'tel' },
  { name: 'email', label: 'E-mailadres', type: 'email', required: true, max: 200, autocomplete: 'email' },
  { name: 'subject', label: 'Onderwerp', max: 150, full: true },
  { name: 'message', label: 'Bericht', type: 'textarea', required: true, max: 5000 },
  { name: 'consent', label: 'Ik ga akkoord met de opslag en verwerking van mijn gegevens door deze website, zoals vermeld in onze', type: 'checkbox', required: true },
];

/** Stuurtekens behalve tab en regeleinden; PostgreSQL weigert NUL in tekstkolommen (anders een 500). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Controleert en normaliseert de invoer van het contactformulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: Record<string, string>, errors: Record<string, string>}} Opgeschoonde waarden en fouten per veld.
 */
function validateContact(body) {
  const values = {};
  const errors = {};
  for (const field of CONTACT_FIELDS) {
    const rawValue = body[field.name];
    let value = typeof rawValue === 'string' ? rawValue.replace(CONTROL_CHARACTERS, '').replace(/\r\n/g, '\n').trim() : '';
    if (field.type !== 'textarea') value = value.replace(/\s+/g, ' ');
    // Een selectievakje telt alleen als akkoord met precies de waarde die het formulier verstuurt (bewijs voor consent_at).
    if (field.type === 'checkbox' && value !== 'ja') value = '';
    values[field.name] = value;
    if (field.required && !value) {
      errors[field.name] = field.type === 'checkbox' ? 'Ga akkoord met de privacyverklaring om je bericht te versturen.' : 'Dit veld is verplicht.';
      continue;
    }
    if (!value) continue;
    if (field.max && value.length > field.max) errors[field.name] = `Maximaal ${field.max} tekens.`;
    else if (field.type === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(value)) errors[field.name] = 'Vul een geldig e-mailadres in.';
    else if (field.type === 'tel' && !/^[+()\d\s-]{6,30}$/.test(value)) errors[field.name] = 'Vul een geldig telefoonnummer in.';
  }
  return { values, errors };
}

module.exports = { CONTACT_FIELDS, validateContact };
