/**
 * Velden van het aanmeldformulier (gelijk aan het huidige formulier) en de controle van de invoer.
 * Velden met `sensitive: true` worden versleuteld opgeslagen (bijzondere persoonsgegevens en paspoortgegevens).
 * Een veld met `consentFor` is het losse toestemmingsvinkje (AVG art. 9.2a) voor dat bijzondere veld: niet verplicht,
 * maar wie het bijzondere veld invult, moet het aanvinken.
 */

/** Versie van de toestemmingsteksten; komt bij elke toestemming in `consents.text_version`. Verhogen bij een nieuwe tekst. */
const CONSENT_TEXT_VERSION = '2026-11-21';

const YES_NO = [{ value: 'ja', label: 'ja' }, { value: 'nee', label: 'nee' }];

/** Alle velden, per groep, in de volgorde van het formulier. */
const FIELD_GROUPS = [
  {
    title: 'Persoonlijke gegevens',
    fields: [
      { name: 'gender', label: 'Geslacht', type: 'radio', required: true, options: [{ value: 'man', label: 'Man' }, { value: 'vrouw', label: 'Vrouw' }] },
      { name: 'first_names', label: 'Voornamen (voluit!) volgens paspoort', required: true, max: 120, help: 'Voornamen zoals in je paspoort. Kosten die voortvloeien uit verkeerde opgave zijn voor eigen rekening.' },
      { name: 'call_name', label: 'Roepnaam', required: true, max: 60 },
      { name: 'last_name', label: 'Achternaam', required: true, max: 120, help: 'Achternaam volgens paspoort. Getrouwde dames voeren hier hun meisjesnaam in (evt. gevolgd door e/v: echtgenoot van...).' },
      { name: 'birth_date', label: 'Geboortedatum', type: 'date', required: true, sensitive: true },
      { name: 'mobile', label: 'Mobiel telefoonnummer', type: 'tel', required: true, max: 30 },
      { name: 'phone', label: 'Telefoonnummer', type: 'tel', max: 30 },
      { name: 'email', label: 'E-mailadres', type: 'email', required: true, max: 200 },
      { name: 'email_confirm', label: 'Bevestig e-mailadres', type: 'email', required: true, max: 200, store: false },
      { name: 'street', label: 'Straat + huisnummer', required: true, max: 160, full: true },
      { name: 'postal_code', label: 'Postcode', required: true, max: 12 },
      { name: 'city', label: 'Woonplaats', required: true, max: 100 },
      { name: 'occupation', label: 'Beroep', required: true, max: 120 },
      { name: 'church', label: 'Kerkgenootschap', max: 120, sensitive: true, help: 'Niet verplicht. Vul je het in, geef dan hieronder ook toestemming.' },
      { name: 'consent_religion', label: 'Ik geef uitdrukkelijk toestemming om mijn kerkgenootschap vast te leggen voor deze reis. Intrekken kan altijd.', type: 'checkbox', consentFor: 'church', store: false },
      { name: 'emergency_phone', label: 'Noodnummer tijdens de reis', type: 'tel', max: 30, sensitive: true, help: 'Telefoonnummer van familielid/vriend/kennis dat we in een acuut noodgeval tijdens je reis kunnen bellen.' },
    ],
  },
  {
    title: 'Paspoort of ID-kaart',
    intro: 'Het is mogelijk om de reis te boeken en later het documentnummer en de vervaldatum van je paspoort of ID-kaart per mail na te zenden.',
    fields: [
      { name: 'nationality', label: 'Nationaliteit', required: true, max: 60, sensitive: true },
      { name: 'document_type', label: 'Paspoort of ID-kaart', type: 'radio', required: true, sensitive: true, options: [{ value: 'paspoort', label: 'Paspoort' }, { value: 'id-kaart', label: 'ID-kaart' }, { value: 'aanvragen', label: 'Moet ik nog aanvragen' }], help: 'Buiten Europa is sowieso een paspoort vereist.' },
      { name: 'document_number', label: 'Documentnummer', max: 20, sensitive: true, help: 'Het documentnummer staat rechtsboven in je paspoort. Hier dus niet je persoonsnummer of BSN invullen.' },
      { name: 'document_valid_until', label: 'Geldig tot', type: 'date', sensitive: true, help: 'Bij veel niet-westerse landen moet je paspoort minimaal geldig zijn tot 6 maanden na afloop van je reis.' },
    ],
  },
  {
    title: 'Overige zaken',
    fields: [
      { name: 'travel_with', label: 'Ik reis samen met', max: 200, full: true },
      { name: 'particulars', label: 'Bijzonderheden (die van invloed kunnen zijn op de reis)', type: 'textarea', max: 2000, sensitive: true, full: true, help: 'Denk bijvoorbeeld aan medicijngebruik, fysieke/psychische klachten e.d. Niet verplicht; vul je het in, geef dan hieronder ook toestemming.' },
      { name: 'consent_health', label: 'Ik geef uitdrukkelijk toestemming om deze bijzonderheden over mijn gezondheid vast te leggen en te delen met de reisleiding van deze reis. Intrekken kan altijd.', type: 'checkbox', consentFor: 'particulars', store: false, full: true },
      { name: 'earlier_trip', label: 'Ben eerder op reis geweest met Avanta', type: 'radio', required: true, options: YES_NO },
      { name: 'credit_card', label: 'In het bezit van creditcard (niet zijnde debetcard) op eigen naam', type: 'radio', required: true, options: YES_NO },
      { name: 'driver_interest', label: 'Heb evt. interesse om te chauffeuren tijdens de reis (en min. 1 jaar rijbewijs)', type: 'radio', required: true, options: YES_NO },
      { name: 'driver_before', label: 'Ben eerder chauffeur geweest tijdens een Avantareis', type: 'radio', required: true, options: YES_NO },
      { name: 'driver_when', label: 'Zo ja, wanneer?', max: 200 },
    ],
  },
  {
    title: 'Betaling',
    intro: 'Na je aanmelding ontvang je een bevestiging met de betaalgegevens. Je kunt de aanbetaling binnen 24 uur overmaken naar onze rekening (NL94 RABO 0385 3731 55).',
    fields: [
      { name: 'payment_choice', label: 'Kies je gewenste betaling', type: 'radio', required: true, options: [{ value: 'aanbetaling', label: 'Aanbetaling' }, { value: 'totaal', label: 'Totaalbedrag (geen boekingskosten)' }], help: 'Kies je ervoor om het totaalbedrag in één keer te voldoen, dan worden de €15,- boekingskosten niet in rekening gebracht.' },
      { name: 'consent', label: 'Ik ga akkoord met de algemene voorwaarden en met de opslag en verwerking van mijn gegevens, zoals vermeld in onze privacy- en cookieverklaring.', type: 'checkbox', required: true, store: false },
    ],
  },
];

const FIELDS = FIELD_GROUPS.flatMap((group) => group.fields);

/** Stuurtekens behalve tab en regeleinden; PostgreSQL weigert NUL in tekstkolommen (anders een 500). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Controleert of een datum (jjjj-mm-dd) bestaat.
 * @param {string} value De datum.
 * @returns {boolean} Waar als het een geldige datum is.
 */
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Controleert en normaliseert een deel van de velden (ook gebruikt door het CRM bij het wijzigen van een persoon).
 * @param {object[]} fields Velden uit FIELDS.
 * @param {object} body Ingezonden velden.
 * @param {{today: string}} context Datum van vandaag (jjjj-mm-dd).
 * @returns {{values: Record<string, string>, errors: Record<string, string>}} Opgeschoonde waarden en fouten per veld.
 */
function validateFields(fields, body, context) {
  const values = {};
  const errors = {};
  for (const field of fields) {
    const raw = body[field.name];
    let value = typeof raw === 'string' ? raw.replace(CONTROL_CHARACTERS, '').replace(/\r\n/g, '\n').trim() : '';
    if (field.type !== 'textarea') value = value.replace(/\s+/g, ' ');
    // Een selectievakje telt alleen als akkoord met precies de waarde die het formulier verstuurt (bewijs voor consent_at).
    if (field.type === 'checkbox' && value !== 'ja') value = '';
    values[field.name] = value;
    if (field.required && !value) {
      errors[field.name] = field.type === 'checkbox' ? 'Ga akkoord om je aan te melden.' : 'Dit veld is verplicht.';
      continue;
    }
    if (field.consentFor && !value && values[field.consentFor]) {
      errors[field.name] = 'Geef toestemming, of laat het veld hierboven leeg.';
      continue;
    }
    if (!value) continue;
    if (field.max && value.length > field.max) errors[field.name] = `Maximaal ${field.max} tekens.`;
    else if (field.options && !field.options.some((option) => option.value === value)) errors[field.name] = 'Kies een van de opties.';
    else if (field.type === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(value)) errors[field.name] = 'Vul een geldig e-mailadres in.';
    else if (field.type === 'tel' && !/^[+()\d\s-]{6,30}$/.test(value)) errors[field.name] = 'Vul een geldig telefoonnummer in.';
    else if (field.type === 'date' && !isValidDate(value)) errors[field.name] = 'Vul een geldige datum in.';
  }
  if (!errors.birth_date && values.birth_date && (values.birth_date >= context.today || values.birth_date < '1900-01-01')) {
    errors.birth_date = 'Vul een geldige geboortedatum in.';
  }
  if (!errors.postal_code && values.postal_code && !/^[A-Za-z0-9 -]{4,10}$/.test(values.postal_code)) {
    errors.postal_code = 'Vul een geldige postcode in.';
  }
  return { values, errors };
}

/**
 * Controleert en normaliseert de invoer van het hele aanmeldformulier.
 * @param {object} body Ingezonden velden.
 * @param {{today: string}} context Datum van vandaag (jjjj-mm-dd).
 * @returns {{values: Record<string, string>, errors: Record<string, string>}} Opgeschoonde waarden en fouten per veld.
 */
function validateBooking(body, context) {
  const { values, errors } = validateFields(FIELDS, body, context);
  if (!errors.email && !errors.email_confirm && values.email.toLowerCase() !== values.email_confirm.toLowerCase()) {
    errors.email_confirm = 'De e-mailadressen zijn niet gelijk.';
  }
  return { values, errors };
}

module.exports = { FIELD_GROUPS, FIELDS, validateBooking, validateFields, isValidDate, CONSENT_TEXT_VERSION };
