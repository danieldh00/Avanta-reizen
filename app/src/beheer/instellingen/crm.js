/**
 * Beheer > CRM: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep CRM. */
const FIELDS = {
  paymentDepositDays: {
    type: 'int', label: 'Aanbetaling binnen (dagen na aanmelden)',
    help: 'Vervaldatum van de aanbetaling (aanbetaling van de reis + boekingskosten + SGR-garantie), en van het hele bedrag bij wie het totaalbedrag kiest. Geldt ook voor bestaande aanmeldingen.',
    default: 7, min: 0, max: 60,
  },
  paymentBalanceDaysBefore: {
    type: 'int', label: 'Restant uiterlijk (dagen vóór vertrek)',
    help: 'Vervaldatum van het restant. Wie zich later aanmeldt, betaalt het restant op de vervaldatum van de aanbetaling. Advies: 42 dagen (6 weken).',
    default: 42, min: 0, max: 365,
  },
  paymentReminderAuto: {
    type: 'bool', label: 'Automatisch herinneren bij een te late betaling',
    help: 'Elke dag krijgt een reiziger van wie de aanbetaling of het restant te laat is een herinnering per mail (alleen bij aanmeldingen die kantoor heeft bevestigd; de mail gaat naar het opgegeven adres), met het openstaande bedrag en de betaalinstructie uit de bevestiging. Werkt alleen met een ingestelde mailserver. Herinneren met de hand kan altijd op de betaalpagina.',
    default: false,
  },
  paymentReminderEveryDays: {
    type: 'int', label: 'Volgende automatische herinnering na (dagen)',
    help: 'Zo lang wacht de app na een herinnering voor dezelfde termijn voordat hij de volgende stuurt.', default: 7, min: 1, max: 60,
  },
  paymentReminderMax: {
    type: 'int', label: 'Hoogstens zoveel automatische herinneringen per termijn',
    help: 'Daarna stopt de app voor die termijn; kantoor neemt dan zelf contact op.', default: 3, min: 1, max: 10,
  },
  mollieEnabled: {
    type: 'bool', label: 'Online betalen via Mollie',
    help: 'Reizigers kunnen het openstaande bedrag dan met iDEAL (of een andere methode in je Mollie-account) betalen via een persoonlijke link in de betaalherinnering. Een geslaagde betaling komt vanzelf bij de betalingen van de aanmelding. Werkt pas met een geldige sleutel hieronder en een openbaar basisadres van de site (https).',
    default: false,
  },
  mollieApiKey: {
    type: 'secret', label: 'Mollie API-sleutel',
    help: 'Uit het Mollie-dashboard (Ontwikkelaars > API-sleutels): begin met een testsleutel (test_…) en zet pas na een proefbetaling de live-sleutel (live_…) erin. Staat versleuteld opgeslagen en gaat nooit naar de browser.',
    default: '', max: 70, pattern: /^(test|live)_[A-Za-z0-9]{20,64}$/, patternMessage: 'Een Mollie-sleutel begint met test_ of live_ gevolgd door letters en cijfers.',
  },
};

/** De groep CRM in de zijbalk van Beheer, met haar secties. */
const GROUP = {
  title: 'CRM',
  sections: [
    {
      id: 'betalingen',
      label: 'Betalingen',
      intro: 'Termijnen voor de betalingen bij een aanmelding. Het CRM rekent daarmee de vervaldatums van de aanbetaling en het restant uit, toont welke aanmeldingen te laat zijn en stuurt desgewenst automatisch een herinnering. De betaalinstructie in de herinnering is dezelfde als in de bevestiging (E-mail > Bevestiging aan de reiziger).',
      fields: ['paymentDepositDays', 'paymentBalanceDaysBefore', 'paymentReminderAuto', 'paymentReminderEveryDays', 'paymentReminderMax'],
      words: 'betaling betalingen aanbetaling restant restbetaling termijn vervaldatum openstaand saldo herinnering',
    },
    {
      id: 'online-betalen',
      label: 'Online betalen',
      intro: 'Optioneel: laat reizigers het openstaande bedrag online betalen via Mollie (iDEAL). Zonder Mollie werkt alles gewoon met overmaken en registreert kantoor de betalingen met de hand. De betaallink staat in de betaalherinnering en op de betaalpagina in het CRM; Mollie meldt een geslaagde betaling terug aan de site, die hem dan zelf registreert. Fouten van de koppeling staan in het logboek (bron mollie).',
      fields: ['mollieEnabled', 'mollieApiKey'],
      words: 'mollie ideal online betalen betaallink betaalprovider api sleutel webhook',
    },
  ],
};

module.exports = { FIELDS, GROUP };
