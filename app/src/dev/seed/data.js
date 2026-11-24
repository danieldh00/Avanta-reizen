/**
 * De vaste inhoud van de testdata (`dev/seed/seed.js`): reistypes, landen, reisleiders, reizen, blog, FAQ, pagina's,
 * gebruikers per rol en de bouwstenen voor verzonnen reizigers.
 *
 * Alles is verzonnen. Herkenbaar als testdata:
 * - slugs en paden beginnen met `test-` (`SEED_SLUG_PREFIX`), zodat verwijderen nooit echte inhoud raakt;
 * - e-mailadressen eindigen op `@example.com` (`SEED_EMAIL_DOMAIN`): een domein dat voor voorbeelden is gereserveerd
 *   (RFC 2606) en geen mail aanneemt, dus een herinnering of bevestiging komt nooit bij een echt persoon aan;
 * - telefoonnummers zijn verzonnen (06-99…), paspoortnummers beginnen met `TST`; het CRM verstuurt geen sms.
 *
 * Datums staan als dagen ten opzichte van vandaag (`departureInDays`), zodat de data bij elke run realistisch blijft:
 * altijd reizen die nog komen, een paar die net geweest zijn, één die vol zit en één die bijna vol zit.
 */

/** Voorvoegsel van elke slug en elk pad van de testdata. */
const SEED_SLUG_PREFIX = 'test-';

/** Domein van elk e-mailadres van de testdata (gereserveerd voor voorbeelden, neemt geen mail aan). */
const SEED_EMAIL_DOMAIN = 'example.com';

/** Reistypes (soort `type`) met het icoon uit `site/icons.js`. */
const TRIP_TYPES = [
  { key: 'kamperen', name: 'Kampeerreizen', icon: 'kamperen', intro: 'Samen onder de sterren: tenten, kampvuur en elke dag een nieuw avontuur.', showOnHome: true },
  { key: 'jongeren', name: 'Jongerenreizen', icon: 'jongeren', intro: 'Voor jongeren van 18 tot 30 jaar die actief op pad willen met leeftijdgenoten.', showOnHome: true },
  { key: 'jeugd', name: 'Jeugdreizen', icon: 'jeugd', intro: 'Avontuurlijke kampen voor tieners van 12 tot 17 jaar, met ervaren leiding.', showOnHome: true },
  { key: 'plus', name: 'Plusreizen', icon: 'plusreis', intro: 'Rustiger tempo, comfortabele hotels en volop tijd voor cultuur en ontmoeting.', showOnHome: true },
  { key: 'verre-reizen', name: 'Verre reizen', icon: 'verre-reizen', intro: 'Ontdek een ander continent met een kleine groep en een vaste reisleider.', showOnHome: true },
  { key: 'wintersport', name: 'Wintersport', icon: 'wintersport', intro: 'Skiën en snowboarden in de Alpen, met dagopeningen en gezellige avonden.', showOnHome: false },
  { key: 'vliegreis', name: 'Vliegreizen', icon: 'vliegreis', intro: 'Rondreizen met vlucht vanaf Schiphol en vervoer ter plaatse geregeld.', showOnHome: false },
];

/** Landen (soort `bestemming`). */
const COUNTRIES = [
  { key: 'frankrijk', name: 'Frankrijk', intro: 'Van de kloven van de Ardèche tot de lavendelvelden van de Provence.' },
  { key: 'noorwegen', name: 'Noorwegen', intro: 'Fjorden, gletsjers en eindeloze zomeravonden.' },
  { key: 'ijsland', name: 'IJsland', intro: 'Vulkanen, geisers en watervallen op het eiland van vuur en ijs.' },
  { key: 'peru', name: 'Peru', intro: 'De Andes, Machu Picchu en de kleurrijke markten van Cusco.' },
  { key: 'italie', name: 'Italië', intro: 'Glooiende heuvels, oude steden en de beste pasta van Europa.' },
  { key: 'schotland', name: 'Schotland', intro: 'Hooglanden, lochs en kastelen in het ruige noorden.' },
  { key: 'oostenrijk', name: 'Oostenrijk', intro: 'Besneeuwde pistes en gezellige berghutten in Tirol.' },
  { key: 'israel', name: 'Israël', intro: 'Wandelen waar de Bijbel zich afspeelde, van Galilea tot Jeruzalem.' },
  { key: 'slovenie', name: 'Slovenië', intro: 'Groene valleien, helder water en de Julische Alpen.' },
  { key: 'namibie', name: 'Namibië', intro: 'Rode duinen, wilde dieren en de sterrenhemel van de woestijn.' },
];

/** Reisleiders (één per reis). `since` is het jaar waarin ze begonnen. */
const GUIDES = [
  { key: 'marieke', name: 'Marieke', surname: 'van Dijk', city: 'Barneveld', since: '2014', quote: 'Niets mooiers dan een groep die onderweg naar elkaar toe groeit.', intro: 'Marieke is lerares aardrijkskunde en trekt al jaren met groepen door Frankrijk en Italië.' },
  { key: 'jan-willem', name: 'Jan-Willem', surname: 'Bakker', city: 'Veenendaal', since: '2011', quote: 'Elke berg is de klim waard, zeker samen.', intro: 'Jan-Willem is bergsportliefhebber en leidt onze reizen naar Noorwegen en IJsland.' },
  { key: 'esther', name: 'Esther', surname: 'Kok', city: 'Zwolle', since: '2018', quote: 'Ik geniet van de verwondering van jongeren als ze iets nieuws zien.', intro: 'Esther werkt in het jeugdwerk en is al zes jaar leiding bij onze jeugdkampen.' },
  { key: 'gerrit', name: 'Gerrit', surname: 'Mulder', city: 'Apeldoorn', since: '2009', quote: 'Rustig aan, dan zie je het meest.', intro: 'Gerrit is gepensioneerd predikant en begeleidt onze plusreizen met veel kennis van geschiedenis.' },
  { key: 'lianne', name: 'Lianne', surname: 'Vos', city: 'Gouda', since: '2016', quote: 'Reizen opent je ogen voor Gods schepping.', intro: 'Lianne is verpleegkundige en spreekt vloeiend Spaans; zij leidt de reizen naar Zuid-Amerika.' },
  { key: 'ruben', name: 'Ruben', surname: 'de Graaf', city: 'Kampen', since: '2020', quote: 'Na een dag op de piste is de avond het mooiste deel.', intro: 'Ruben is skileraar in de winter en begeleidt onze wintersportreizen.' },
  { key: 'hanneke', name: 'Hanneke', surname: 'Smit', city: 'Ede', since: '2013', quote: 'Het land van de Bijbel zelf zien is een cadeau.', intro: 'Hanneke studeerde theologie en leidt al jaren de reizen naar Israël.' },
  { key: 'pieter', name: 'Pieter', surname: 'Visser', city: 'Nunspeet', since: '2017', quote: 'Een goede kampeerplek maakt de hele dag goed.', intro: 'Pieter is fanatiek kampeerder en kent de mooiste plekken in Slovenië en Schotland.' },
];

/**
 * Reizen, elk één vertrek met precies één reisleider. `ages` is de leeftijd van de verzonnen deelnemers,
 * `bookings` het aantal aanmeldingen dat de testdata maakt (niet geannuleerd telt mee voor de bezetting).
 * `published: false` = concept (niet op de site).
 */
const TRIPS = [
  { key: 'ardeche-zomer', title: 'Kampeerreis Ardèche', code: 'KAR26A', tagline: 'Kanoën, klimmen en kamperen in Zuid-Frankrijk', type: 'kamperen', country: 'frankrijk', guide: 'marieke', departureInDays: 45, days: 12, priceEuros: 749, depositEuros: 150, capacity: 24, bookings: 14, ages: [20, 45], isNew: false },
  { key: 'ardeche-najaar', title: 'Kampeerreis Ardèche', code: 'KAR26B', tagline: 'Kanoën, klimmen en kamperen in Zuid-Frankrijk', type: 'kamperen', country: 'frankrijk', guide: 'pieter', departureInDays: 95, days: 12, priceEuros: 699, depositEuros: 150, capacity: 24, bookings: 5, ages: [20, 45], isNew: false },
  { key: 'noorwegen-fjorden', title: 'Jongerenreis Noorse fjorden', code: 'JNO26', tagline: 'Wandelen langs gletsjers en fjorden', type: 'jongeren', country: 'noorwegen', guide: 'jan-willem', departureInDays: 90, days: 14, priceEuros: 1149, depositEuros: 250, capacity: 20, bookings: 11, ages: [18, 30], isNew: true },
  { key: 'ijsland-rondreis', title: 'Rondreis IJsland', code: 'VIJ26', tagline: 'Vuur en ijs in tien dagen', type: 'vliegreis', country: 'ijsland', guide: 'jan-willem', departureInDays: 150, days: 10, priceEuros: 1895, depositEuros: 400, capacity: 16, bookings: 7, ages: [25, 60], isNew: true },
  { key: 'peru-andes', title: 'Verre reis Peru', code: 'VPE27', tagline: 'Door de Andes naar Machu Picchu', type: 'verre-reizen', country: 'peru', guide: 'lianne', departureInDays: 210, days: 21, priceEuros: 3295, depositEuros: 750, capacity: 14, bookings: 6, ages: [25, 60], isNew: false, guaranteed: true },
  { key: 'toscane-plus', title: 'Plusreis Toscane', code: 'PTO26', tagline: 'Cultuur en rust tussen de cipressen', type: 'plus', country: 'italie', guide: 'gerrit', departureInDays: 30, days: 9, priceEuros: 1095, depositEuros: 250, capacity: 20, bookings: 18, ages: [58, 78], isNew: false, guaranteed: true },
  { key: 'schotland-jeugd', title: 'Jeugdkamp Schotse Hooglanden', code: 'JSC26', tagline: 'Survival, kastelen en doedelzakken', type: 'jeugd', country: 'schotland', guide: 'esther', departureInDays: 75, days: 10, priceEuros: 695, depositEuros: 150, capacity: 30, bookings: 16, ages: [12, 16], isNew: false },
  { key: 'tirol-wintersport', title: 'Wintersport Tirol', code: 'WTI27', tagline: 'Acht dagen sneeuwzeker skiën', type: 'wintersport', country: 'oostenrijk', guide: 'ruben', departureInDays: 40, days: 8, priceEuros: 845, depositEuros: 200, capacity: 12, bookings: 12, ages: [18, 35], isNew: false },
  { key: 'israel-jordanie', title: 'Israël en Jordanië', code: 'VIS27', tagline: 'Van Galilea tot Petra', type: 'vliegreis', country: 'israel', guide: 'hanneke', departureInDays: 180, days: 12, priceEuros: 2195, depositEuros: 500, capacity: 24, bookings: 9, ages: [30, 70], isNew: false },
  { key: 'slovenie-kamperen', title: 'Kampeerreis Slovenië', code: 'KSL26', tagline: 'Julische Alpen en het meer van Bled', type: 'kamperen', country: 'slovenie', guide: 'pieter', departureInDays: -40, days: 11, priceEuros: 725, depositEuros: 150, capacity: 22, bookings: 15, ages: [20, 45], isNew: false },
  { key: 'schotland-hooglanden', title: 'Rondreis Schotland', code: 'RSC26', tagline: 'Lochs, eilanden en whisky-vrije distilleerderijen', type: 'jongeren', country: 'schotland', guide: 'pieter', departureInDays: -100, days: 10, priceEuros: 995, depositEuros: 200, capacity: 18, bookings: 12, ages: [18, 30], isNew: false },
  { key: 'namibie-concept', title: 'Verre reis Namibië', code: 'VNA27', tagline: 'Woestijn, wildparken en sterrenhemels', type: 'verre-reizen', country: 'namibie', guide: 'lianne', departureInDays: 300, days: 18, priceEuros: 3495, depositEuros: 800, capacity: 14, bookings: 0, ages: [25, 60], isNew: true, published: false },
];

/** Gebruikers van het CRM: één per rol. De reisleider is gekoppeld aan de reisleider met `guide`. */
const USERS = [
  { email: 'beheerder', name: 'Bas Beheerder (test)', role: 'beheerder' },
  { email: 'kantoor', name: 'Karin Kantoor (test)', role: 'kantoor' },
  { email: 'reisleider', name: 'Marieke van Dijk (test)', role: 'reisleider', guide: 'marieke' },
  { email: 'boekhouding', name: 'Bert Boekhouding (test)', role: 'boekhouding' },
  { email: 'redacteur', name: 'Rianne Redacteur (test)', role: 'redacteur' },
];

/** Blogcategorieën en -tags. */
const POST_TERMS = [
  { kind: 'categorie', key: 'reisverslagen', name: 'Reisverslagen', intro: 'Verhalen van deelnemers en reisleiders.' },
  { kind: 'categorie', key: 'nieuws', name: 'Nieuws', intro: 'Nieuws over Avanta en het reisaanbod.' },
  { kind: 'tag', key: 'kamperen', name: 'kamperen' },
  { kind: 'tag', key: 'jongeren', name: 'jongeren' },
  { kind: 'tag', key: 'tips', name: 'tips' },
];

/**
 * Blogberichten. `daysAgo` negatief = ingepland in de toekomst; `published: false` = concept.
 * De tekst is eenvoudige, vaste HTML (alleen p, h2, ul, li, strong).
 */
const POSTS = [
  {
    key: 'terugblik-slovenie', title: 'Terugblik: elf dagen Slovenië', daysAgo: 25, featured: true, terms: ['reisverslagen', 'kamperen'],
    intro: 'Een groep van vijftien reizigers trok deze zomer door de Julische Alpen.',
    html: '<p>Na een lange busrit kwamen we aan bij de camping aan het meer van Bohinj. De eerste avond zongen we bij het kampvuur en maakten we kennis met elkaar.</p><h2>Hoogtepunten</h2><ul><li>Zonsopkomst op de Vogel</li><li>Raften op de Soča</li><li>De kerkdienst in de openlucht op zondag</li></ul><p>Bedankt allemaal voor deze geweldige reis!</p>',
  },
  {
    key: 'nieuwe-reizen-2027', title: 'Nieuw in 2027: Namibië en IJsland', daysAgo: 10, featured: false, terms: ['nieuws'],
    intro: 'Volgend jaar gaan we voor het eerst naar het zuiden van Afrika.',
    html: '<p>We zijn blij twee nieuwe reizen aan te kondigen. In <strong>Namibië</strong> kamperen we tussen de duinen van Sossusvlei, in <strong>IJsland</strong> maken we een rondreis langs de ringweg.</p><p>Aanmelden kan binnenkort via de website.</p>',
  },
  {
    key: 'paktips-kampeerreis', title: 'Tien tips voor het inpakken van je kampeerreis', daysAgo: 60, featured: false, terms: ['reisverslagen', 'kamperen', 'tips'],
    intro: 'Wat neem je wel en niet mee als je twee weken gaat kamperen?',
    html: '<p>Een goede voorbereiding scheelt veel gedoe onderweg.</p><ul><li>Een slaapzak die past bij de temperatuur</li><li>Een zaklamp met reservebatterijen</li><li>Je eigen Bijbel of dagboekje</li><li>Regenkleding, ook in de zomer</li></ul>',
  },
  {
    key: 'jongerenweekend', title: 'Kom naar het jongerenweekend in maart', daysAgo: -14, featured: false, terms: ['nieuws', 'jongeren'],
    intro: 'Een weekend vol ontmoeting, voor iedereen tussen 18 en 30.',
    html: '<p>Dit bericht is ingepland en verschijnt pas over twee weken op de site.</p>',
  },
  {
    key: 'concept-bericht', title: 'Ervaringen van een eerste reisleider', daysAgo: 0, featured: false, terms: ['reisverslagen'], published: false,
    intro: 'Concept, nog niet gepubliceerd.',
    html: '<p>Dit bericht is nog een concept.</p>',
  },
];

/**
 * Veelgestelde vragen per categorie. De namen eindigen op "(test)", zodat verwijderen nooit een echte categorie raakt
 * (een categorie heeft geen slug).
 */
const FAQ_CATEGORIES = [
  {
    name: 'Boeken en betalen (test)',
    questions: [
      { key: 'aanbetaling', question: 'Hoeveel moet ik aanbetalen?', answer: '<p>Bij elke reis staat de aanbetaling vermeld. Daarbij komen de boekingskosten en de bijdrage aan het SGR-garantiefonds. De aanbetaling betaal je binnen 7 dagen na je aanmelding.</p>' },
      { key: 'restbetaling', question: 'Wanneer betaal ik het restant?', answer: '<p>Het restant betaal je uiterlijk 6 weken voor vertrek. Je ontvangt daarvoor een herinnering per e-mail.</p>' },
      { key: 'annuleren', question: 'Wat als ik moet annuleren?', answer: '<p>Annuleren kan altijd schriftelijk. Afhankelijk van het moment brengen we annuleringskosten in rekening volgens de reisvoorwaarden. Een annuleringsverzekering raden we sterk aan.</p>' },
    ],
  },
  {
    name: 'Onderweg (test)',
    questions: [
      { key: 'zondag', question: 'Wat doen we op zondag?', answer: '<p>Op zondag houden we een rustdag. We bezoeken waar mogelijk een kerkdienst of houden zelf een korte dienst met de groep.</p>' },
      { key: 'alleen-reizen', question: 'Kan ik ook alleen mee?', answer: '<p>Zeker! De meeste deelnemers reizen alleen. Je deelt een tent of kamer met iemand van hetzelfde geslacht.</p>' },
    ],
  },
  {
    name: 'Bagage en documenten (test)',
    questions: [
      { key: 'paspoort', question: 'Heb ik een paspoort nodig?', answer: '<p>Binnen Europa volstaat een geldige ID-kaart. Buiten Europa is een paspoort verplicht, vaak minimaal zes maanden geldig na terugkomst.</p>' },
      { key: 'bagage', question: 'Hoeveel bagage mag ik meenemen?', answer: '<p>Bij busreizen één reistas van maximaal 20 kilo en handbagage. Bij vliegreizen gelden de regels van de luchtvaartmaatschappij.</p>' },
    ],
  },
];

/** Pagina's in blokken (pad = `/test-<key>/`). */
const PAGES = [
  {
    key: 'over-avanta', title: 'Over Avanta (test)', pretitle: 'Wie we zijn', intro: 'Christelijke, avontuurlijke groepsreizen sinds 1985.',
    blocks: [
      { type: 'kop', data: { titel: 'Onze missie', subtitel: 'Samen op reis', niveau: 'h2' } },
      { type: 'tekst', data: { html: '<p>Avanta organiseert groepsreizen voor jong en oud, met aandacht voor elkaar, voor de schepping en voor het geloof. Onze reisleiders zijn vrijwilligers met veel ervaring.</p>' } },
    ],
  },
  {
    key: 'praktische-informatie', title: 'Praktische informatie (test)', pretitle: 'Voor vertrek', intro: 'Alles wat je moet weten voordat je vertrekt.',
    blocks: [
      { type: 'tekst', data: { html: '<p>Ongeveer drie weken voor vertrek ontvang je de reisinformatie met de vertrektijd, de opstapplaats en een paklijst.</p>' } },
      { type: 'faq', data: { categorie: '' } },
    ],
  },
];

/** Voornamen per geslacht en achternamen (veelvoorkomend in Nederland, willekeurig gecombineerd). */
const FIRST_NAMES = {
  man: ['Jan', 'Pieter', 'Hendrik', 'Johannes', 'Gerrit', 'Willem', 'Daan', 'Thijs', 'Ruben', 'Jesse', 'Sander', 'Bram', 'Wouter', 'Arjan', 'Kees', 'Teun', 'Joost', 'Matthijs', 'Elias', 'Gijs'],
  vrouw: ['Maria', 'Anna', 'Johanna', 'Geertje', 'Lisa', 'Sanne', 'Esther', 'Rebecca', 'Hannah', 'Judith', 'Marieke', 'Femke', 'Lotte', 'Anouk', 'Willemijn', 'Rianne', 'Margreet', 'Debora', 'Eline', 'Ruth'],
};

/** Achternamen. */
const LAST_NAMES = ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Kok', 'van der Linden', 'Schouten', 'van Dam', 'Post', 'Kuiper', 'Verhoef', 'van Beek', 'Blom', 'Hoekstra'];

/** Woonplaatsen met de eerste cijfers van een passende postcode. */
const PLACES = [
  { city: 'Barneveld', postcode: 3771 }, { city: 'Ede', postcode: 6711 }, { city: 'Veenendaal', postcode: 3901 },
  { city: 'Apeldoorn', postcode: 7311 }, { city: 'Zwolle', postcode: 8011 }, { city: 'Kampen', postcode: 8261 },
  { city: 'Gouda', postcode: 2801 }, { city: 'Amersfoort', postcode: 3811 }, { city: 'Nunspeet', postcode: 8071 },
  { city: 'Urk', postcode: 8321 }, { city: 'Rijssen', postcode: 7461 }, { city: 'Utrecht', postcode: 3511 },
  { city: 'Groningen', postcode: 9711 }, { city: 'Leiden', postcode: 2311 }, { city: 'Harderwijk', postcode: 3841 },
];

/** Straatnamen. */
const STREETS = ['Kerkstraat', 'Dorpsstraat', 'Molenweg', 'Julianalaan', 'Beatrixstraat', 'Wilhelminaweg', 'Schoolstraat', 'Lindelaan', 'Eikenlaan', 'Prins Bernhardlaan', 'Stationsweg', 'Hoofdstraat', 'Kastanjelaan', 'Burgemeester de Withstraat'];

/** Beroepen (een scholier/student voor de jongste leeftijden). */
const OCCUPATIONS = ['verpleegkundige', 'leraar basisonderwijs', 'timmerman', 'administratief medewerker', 'ICT-beheerder', 'boekhouder', 'fysiotherapeut', 'monteur', 'kapper', 'accountmanager', 'verkoper', 'agrariër', 'zorgmedewerker', 'architect'];

/** Kerkgenootschappen (vrijwillig veld; alleen met toestemming vastgelegd). */
const CHURCHES = ['Protestantse Kerk in Nederland', 'Hersteld Hervormde Kerk', 'Christelijke Gereformeerde Kerk', 'Gereformeerde Kerken Nederland', 'Nederlands Gereformeerde Kerk', 'Evangelische gemeente', 'Baptistengemeente'];

/** Bijzonderheden over de gezondheid (vrijwillig veld; alleen met toestemming vastgelegd). */
const PARTICULARS = ['Glutenallergie, graag rekening houden met de maaltijden.', 'Astma; heeft altijd een puffer bij zich.', 'Diabetes type 1, gebruikt insuline.', 'Vegetariër.', 'Hoogtevrees, liever geen klimactiviteiten.', 'Notenallergie (pinda en hazelnoot).'];

/** Redenen bij een geannuleerde aanmelding. */
const CANCEL_REASONS = ['Ziek geworden, kan niet mee.', 'Werkgever geeft geen vrij in deze periode.', 'Reist liever met een vriendin mee op een later vertrek.', 'Financiële redenen.'];

/** Notities bij een statuswijziging (van kantoor). */
const STATUS_NOTES = {
  bevestigd: ['Bevestiging per mail verstuurd.', 'Gegevens gecontroleerd, alles compleet.', ''],
  aanbetaald: ['Aanbetaling ontvangen.', ''],
  betaald: ['Volledig betaald.', ''],
};

/**
 * Berichten via het contactformulier (CRM > Berichten): naam, onderwerp, tekst, de sleutel van een testreis of null,
 * hoeveel dagen geleden en of kantoor het al heeft afgehandeld (met notitie).
 */
const MESSAGES = [
  { name: 'Ilse de Vries', subject: 'Vraag over de bagage', message: 'Hallo,\n\nMag ik op de reis een grote rugzak meenemen, of alleen een koffer?\n\nGroet, Ilse', trip: 0, daysAgo: 1, handled: false },
  { name: 'Ruben Smit', subject: '', message: 'Is er nog plek voor twee personen? We willen graag samen mee.', trip: 1, daysAgo: 2, handled: false },
  { name: 'Hanneke Bos', subject: 'Brochure', message: 'Kunnen jullie mij de brochure van volgend jaar mailen?', trip: null, daysAgo: 6, handled: true, note: 'Brochure gemaild.' },
];

module.exports = {
  SEED_SLUG_PREFIX,
  MESSAGES,
  SEED_EMAIL_DOMAIN,
  TRIP_TYPES,
  COUNTRIES,
  GUIDES,
  TRIPS,
  USERS,
  POST_TERMS,
  POSTS,
  FAQ_CATEGORIES,
  PAGES,
  FIRST_NAMES,
  LAST_NAMES,
  PLACES,
  STREETS,
  OCCUPATIONS,
  CHURCHES,
  PARTICULARS,
  CANCEL_REASONS,
  STATUS_NOTES,
};
