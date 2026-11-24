// @ts-check
/**
 * Migratie 33: website: alle landen van de wereld bij Reistypes en landen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 *
 * - Elk land krijgt een ISO 3166-1-code (`iso_code`, uniek; leeg bij bestemmingen die geen land zijn, zoals Schotland
 *   of Wintersport).
 * - Overgebleven categorieën uit de import zonder reizen en zonder foto's verdwijnen: plaatshouders (Bestemming, Type,
 *   NaN, …), namen zonder hoofdletter (nederland) en dubbelingen van een andere categorie (de tweede Saudi Arabië). Een
 *   dubbeling krijgt een 301 naar de categorie die blijft.
 * - Bestaande landen blijven staan met hun naam, slug, reizen en foto's en krijgen alleen de code; ze worden herkend op
 *   slug of naam (zonder accenten en leestekens) en op bekende andere namen (`vs`, `saudi-arabie`, `macedonie`, …).
 * - Alle overige landen komen erbij met hun Nederlandse naam (soort `bestemming`, niet op de homepage).
 *
 * De lijst staat in dit bestand zelf, zodat de migratie altijd hetzelfde doet, ook als code elders verandert.
 */

/**
 * Alle landen en gebieden met een eigen ISO 3166-1-code, plus Kosovo (XK): code, Nederlandse naam en eventueel andere
 * namen waaronder het land al op de site kan staan (als slug).
 * @type {[string, string, string[]?][]}
 */
const COUNTRIES = [
  ['AF', 'Afghanistan'],
  ['AX', 'Åland'],
  ['AL', 'Albanië'],
  ['DZ', 'Algerije'],
  ['AS', 'Amerikaans-Samoa'],
  ['VI', 'Amerikaanse Maagdeneilanden'],
  ['AD', 'Andorra'],
  ['AO', 'Angola'],
  ['AI', 'Anguilla'],
  ['AQ', 'Antarctica'],
  ['AG', 'Antigua en Barbuda'],
  ['AR', 'Argentinië'],
  ['AM', 'Armenië'],
  ['AW', 'Aruba'],
  ['AU', 'Australië'],
  ['AZ', 'Azerbeidzjan'],
  ['BS', 'Bahama\'s'],
  ['BH', 'Bahrein'],
  ['BD', 'Bangladesh'],
  ['BB', 'Barbados'],
  ['BE', 'België'],
  ['BZ', 'Belize'],
  ['BJ', 'Benin'],
  ['BM', 'Bermuda'],
  ['BT', 'Bhutan'],
  ['BO', 'Bolivia'],
  ['BQ', 'Bonaire, Sint Eustatius en Saba', ['bonaire', 'caribisch-nederland']],
  ['BA', 'Bosnië en Herzegovina', ['bosnie', 'bosnie-herzegovina']],
  ['BW', 'Botswana'],
  ['BV', 'Bouveteiland'],
  ['BR', 'Brazilië'],
  ['VG', 'Britse Maagdeneilanden'],
  ['IO', 'Brits Indische Oceaanterritorium'],
  ['BN', 'Brunei'],
  ['BG', 'Bulgarije'],
  ['BF', 'Burkina Faso'],
  ['BI', 'Burundi'],
  ['KH', 'Cambodja'],
  ['CA', 'Canada'],
  ['CF', 'Centraal-Afrikaanse Republiek'],
  ['CL', 'Chili'],
  ['CN', 'China'],
  ['CX', 'Christmaseiland'],
  ['CC', 'Cocoseilanden'],
  ['CO', 'Colombia'],
  ['KM', 'Comoren'],
  ['CG', 'Congo-Brazzaville', ['congo', 'republiek-congo']],
  ['CD', 'Congo-Kinshasa', ['democratische-republiek-congo', 'dr-congo']],
  ['CK', 'Cookeilanden'],
  ['CR', 'Costa Rica'],
  ['CU', 'Cuba'],
  ['CW', 'Curaçao'],
  ['CY', 'Cyprus'],
  ['DK', 'Denemarken'],
  ['DJ', 'Djibouti'],
  ['DM', 'Dominica'],
  ['DO', 'Dominicaanse Republiek'],
  ['DE', 'Duitsland'],
  ['EC', 'Ecuador'],
  ['EG', 'Egypte'],
  ['SV', 'El Salvador'],
  ['GQ', 'Equatoriaal-Guinea'],
  ['ER', 'Eritrea'],
  ['EE', 'Estland'],
  ['SZ', 'Eswatini', ['swaziland']],
  ['ET', 'Ethiopië'],
  ['FO', 'Faeröer', ['faroer', 'faeroer-eilanden']],
  ['FK', 'Falklandeilanden'],
  ['FJ', 'Fiji'],
  ['PH', 'Filipijnen'],
  ['FI', 'Finland'],
  ['FR', 'Frankrijk'],
  ['GF', 'Frans-Guyana'],
  ['PF', 'Frans-Polynesië'],
  ['TF', 'Franse Zuidelijke Gebieden'],
  ['GA', 'Gabon'],
  ['GM', 'Gambia'],
  ['GE', 'Georgië'],
  ['GH', 'Ghana'],
  ['GI', 'Gibraltar'],
  ['GD', 'Grenada'],
  ['GR', 'Griekenland'],
  ['GL', 'Groenland'],
  ['GP', 'Guadeloupe'],
  ['GU', 'Guam'],
  ['GT', 'Guatemala'],
  ['GG', 'Guernsey'],
  ['GN', 'Guinee'],
  ['GW', 'Guinee-Bissau'],
  ['GY', 'Guyana'],
  ['HT', 'Haïti'],
  ['HM', 'Heard en McDonaldeilanden'],
  ['HN', 'Honduras'],
  ['HU', 'Hongarije'],
  ['HK', 'Hongkong'],
  ['IE', 'Ierland'],
  ['IS', 'IJsland'],
  ['IN', 'India'],
  ['ID', 'Indonesië'],
  ['IQ', 'Irak'],
  ['IR', 'Iran'],
  ['IM', 'Isle of Man'],
  ['IL', 'Israël'],
  ['IT', 'Italië'],
  ['CI', 'Ivoorkust'],
  ['JM', 'Jamaica'],
  ['JP', 'Japan'],
  ['YE', 'Jemen'],
  ['JE', 'Jersey'],
  ['JO', 'Jordanië'],
  ['KY', 'Kaaimaneilanden'],
  ['CV', 'Kaapverdië'],
  ['CM', 'Kameroen'],
  ['KZ', 'Kazachstan'],
  ['KE', 'Kenia'],
  ['KG', 'Kirgizië', ['kirgizstan', 'kirgizistan']],
  ['KI', 'Kiribati'],
  ['UM', 'Kleine afgelegen eilanden van de Verenigde Staten'],
  ['KW', 'Koeweit'],
  ['XK', 'Kosovo'],
  ['HR', 'Kroatië'],
  ['LA', 'Laos'],
  ['LS', 'Lesotho'],
  ['LV', 'Letland'],
  ['LB', 'Libanon'],
  ['LR', 'Liberia'],
  ['LY', 'Libië'],
  ['LI', 'Liechtenstein'],
  ['LT', 'Litouwen'],
  ['LU', 'Luxemburg'],
  ['MO', 'Macau'],
  ['MG', 'Madagaskar'],
  ['MW', 'Malawi'],
  ['MV', 'Malediven'],
  ['MY', 'Maleisië'],
  ['ML', 'Mali'],
  ['MT', 'Malta'],
  ['MA', 'Marokko'],
  ['MH', 'Marshalleilanden'],
  ['MQ', 'Martinique'],
  ['MR', 'Mauritanië'],
  ['MU', 'Mauritius'],
  ['YT', 'Mayotte'],
  ['MX', 'Mexico'],
  ['FM', 'Micronesia'],
  ['MD', 'Moldavië', ['moldova']],
  ['MC', 'Monaco'],
  ['MN', 'Mongolië'],
  ['ME', 'Montenegro'],
  ['MS', 'Montserrat'],
  ['MZ', 'Mozambique'],
  ['MM', 'Myanmar', ['birma']],
  ['NA', 'Namibië'],
  ['NR', 'Nauru'],
  ['NL', 'Nederland'],
  ['NP', 'Nepal'],
  ['NI', 'Nicaragua'],
  ['NC', 'Nieuw-Caledonië'],
  ['NZ', 'Nieuw-Zeeland'],
  ['NE', 'Niger'],
  ['NG', 'Nigeria'],
  ['NU', 'Niue'],
  ['KP', 'Noord-Korea'],
  ['MK', 'Noord-Macedonië', ['macedonie']],
  ['MP', 'Noordelijke Marianen'],
  ['NO', 'Noorwegen'],
  ['NF', 'Norfolk'],
  ['UG', 'Oeganda'],
  ['UA', 'Oekraïne'],
  ['UZ', 'Oezbekistan'],
  ['OM', 'Oman'],
  ['AT', 'Oostenrijk'],
  ['TL', 'Oost-Timor', ['timor-leste']],
  ['PK', 'Pakistan'],
  ['PW', 'Palau'],
  ['PS', 'Palestina'],
  ['PA', 'Panama'],
  ['PG', 'Papoea-Nieuw-Guinea'],
  ['PY', 'Paraguay'],
  ['PE', 'Peru'],
  ['PN', 'Pitcairneilanden'],
  ['PL', 'Polen'],
  ['PT', 'Portugal'],
  ['PR', 'Puerto Rico'],
  ['QA', 'Qatar'],
  ['RE', 'Réunion'],
  ['RO', 'Roemenië'],
  ['RU', 'Rusland'],
  ['RW', 'Rwanda'],
  ['BL', 'Saint-Barthélemy'],
  ['KN', 'Saint Kitts en Nevis'],
  ['LC', 'Saint Lucia'],
  ['PM', 'Saint-Pierre en Miquelon'],
  ['VC', 'Saint Vincent en de Grenadines'],
  ['SB', 'Salomonseilanden'],
  ['WS', 'Samoa'],
  ['SM', 'San Marino'],
  ['SA', 'Saoedi-Arabië', ['saudi-arabie']],
  ['ST', 'Sao Tomé en Principe'],
  ['SN', 'Senegal'],
  ['RS', 'Servië'],
  ['SC', 'Seychellen'],
  ['SL', 'Sierra Leone'],
  ['SG', 'Singapore'],
  ['SH', 'Sint-Helena, Ascension en Tristan da Cunha', ['sint-helena']],
  ['MF', 'Sint-Maarten (Frans deel)'],
  ['SX', 'Sint Maarten'],
  ['SI', 'Slovenië'],
  ['SK', 'Slowakije'],
  ['SD', 'Soedan'],
  ['SO', 'Somalië'],
  ['ES', 'Spanje'],
  ['SJ', 'Spitsbergen en Jan Mayen', ['spitsbergen', 'svalbard']],
  ['LK', 'Sri Lanka'],
  ['SR', 'Suriname'],
  ['SY', 'Syrië'],
  ['TJ', 'Tadzjikistan'],
  ['TW', 'Taiwan'],
  ['TZ', 'Tanzania'],
  ['TH', 'Thailand'],
  ['TG', 'Togo'],
  ['TK', 'Tokelau'],
  ['TO', 'Tonga'],
  ['TT', 'Trinidad en Tobago'],
  ['TD', 'Tsjaad'],
  ['CZ', 'Tsjechië'],
  ['TN', 'Tunesië'],
  ['TR', 'Turkije'],
  ['TM', 'Turkmenistan'],
  ['TC', 'Turks- en Caicoseilanden'],
  ['TV', 'Tuvalu'],
  ['UY', 'Uruguay'],
  ['VU', 'Vanuatu'],
  ['VA', 'Vaticaanstad'],
  ['VE', 'Venezuela'],
  ['AE', 'Verenigde Arabische Emiraten'],
  ['US', 'Verenigde Staten', ['vs', 'usa', 'u-s-a', 'amerika', 'verenigde-staten-van-amerika']],
  ['GB', 'Verenigd Koninkrijk', ['engeland', 'groot-brittannie']],
  ['VN', 'Vietnam'],
  ['WF', 'Wallis en Futuna'],
  ['EH', 'Westelijke Sahara'],
  ['BY', 'Wit-Rusland', ['belarus']],
  ['ZM', 'Zambia'],
  ['ZW', 'Zimbabwe'],
  ['ZA', 'Zuid-Afrika'],
  ['GS', 'Zuid-Georgia en de Zuidelijke Sandwicheilanden'],
  ['KR', 'Zuid-Korea'],
  ['SS', 'Zuid-Soedan'],
  ['SE', 'Zweden'],
  ['CH', 'Zwitserland'],
];

/** Namen van plaatshouders die de import als categorie kon overnemen (gelijk aan `tools/import-wordpress.js`). */
const PLACEHOLDER_NAMES = ['bestemming', 'type', 'nan', 'null', 'undefined', 'geen', 'overig'];

/**
 * Slug uit een naam: zonder apostrof (Bahama's wordt bahamas), kleine letters zonder accenten, alleen letters, cijfers
 * en streepjes (verder zoals `trips/slugs.js` op het moment van deze migratie).
 * @param {string} name Naam.
 * @returns {string} Slug.
 */
function slugOf(name) {
  return name.replace(/'/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Een tekst als SQL-letterlijke waarde (alleen voor de vaste lijst hierboven; nooit voor invoer).
 * @param {string} text Tekst.
 * @returns {string} SQL.
 */
function literal(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/** Dezelfde sleutel als `slugOf`, in SQL (zonder extensie: accenten via `translate`). */
const KEY_SQL = (column) => `trim(both '-' from regexp_replace(lower(translate(${column},
  'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñÝýÿ',
  'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')), '[^a-z0-9]+', '-', 'g'))`;

/** De landen als rijen voor een tijdelijke tabel: code, naam, slug en alle sleutels waarop een bestaand land past. */
const COUNTRY_ROWS = COUNTRIES.map(([code, name, aliases = []]) => {
  const keys = [slugOf(name), ...aliases];
  return `(${literal(code)}, ${literal(name)}, ${literal(slugOf(name))}, ARRAY[${keys.map(literal).join(', ')}]::text[])`;
}).join(',\n        ');

module.exports = {
  id: 33,
  name: 'website: alle landen van de wereld',
  sql: `
      ALTER TABLE trip_categories ADD COLUMN iso_code TEXT CHECK (iso_code IS NULL OR iso_code ~ '^[A-Z]{2}$');
      CREATE UNIQUE INDEX trip_categories_iso_code_idx ON trip_categories (iso_code) WHERE iso_code IS NOT NULL;

      CREATE TEMPORARY TABLE migratie_landen (code TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, keys TEXT[] NOT NULL) ON COMMIT DROP;
      INSERT INTO migratie_landen (code, name, slug, keys) VALUES
        ${COUNTRY_ROWS};

      -- 1. Overgebleven categorieën uit de import zonder reizen en zonder foto's opruimen. Een dubbeling van een andere
      --    categorie krijgt eerst een 301 naar die categorie (de oudste die blijft).
      CREATE TEMPORARY TABLE migratie_restjes ON COMMIT DROP AS
        SELECT c.id, c.slug,
               (SELECT o.slug FROM trip_categories o
                 WHERE o.id <> c.id AND ${KEY_SQL('o.name')} = ${KEY_SQL('c.name')}
                   AND CASE WHEN c.kind = 'overig' THEN (o.kind <> 'overig' OR o.id < c.id) ELSE (o.kind = c.kind AND o.id < c.id) END
                 ORDER BY (o.kind = 'overig'), o.id LIMIT 1) AS keep_slug
          FROM trip_categories c
         WHERE c.kind IN ('overig', 'bestemming')
           AND NOT EXISTS (SELECT 1 FROM trip_category_links l WHERE l.category_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM media_countries m WHERE m.category_id = c.id);
      DELETE FROM migratie_restjes r
       USING trip_categories c
       WHERE c.id = r.id AND r.keep_slug IS NULL
         AND NOT (c.kind = 'overig' AND (lower(trim(c.name)) = ANY (ARRAY[${PLACEHOLDER_NAMES.map(literal).join(', ')}]) OR c.name = lower(c.name)));
      INSERT INTO redirects (from_path, to_url, note)
        SELECT '/reis-categorie/' || r.slug || '/', '/reis-categorie/' || r.keep_slug || '/', 'Automatisch: dubbele categorie opgeruimd'
          FROM migratie_restjes r WHERE r.keep_slug IS NOT NULL
        ON CONFLICT (from_path) DO NOTHING;
      DELETE FROM trip_categories WHERE id IN (SELECT id FROM migratie_restjes);

      -- 2. Bestaande landen herkennen op slug of naam; per land de beste kandidaat (een land vóór een overige categorie,
      --    dan de oudste). Een overige categorie die een land blijkt, wordt een land; een naam zonder hoofdletter krijgt
      --    de Nederlandse naam.
      UPDATE trip_categories c
         SET iso_code = m.code, kind = 'bestemming', updated_at = now(),
             name = CASE WHEN c.name = lower(c.name) THEN m.name ELSE c.name END
        FROM (SELECT DISTINCT ON (l.code) l.code, l.name, c2.id
                FROM migratie_landen l
                JOIN trip_categories c2 ON c2.kind IN ('bestemming', 'overig') AND c2.iso_code IS NULL
                 AND (c2.slug = ANY (l.keys) OR ${KEY_SQL('c2.name')} = ANY (l.keys))
               ORDER BY l.code, (c2.kind = 'bestemming') DESC, c2.id) m
       WHERE c.id = m.id
         AND NOT EXISTS (SELECT 1 FROM trip_categories t WHERE t.iso_code = m.code);

      -- 3. De overige landen toevoegen. Is de slug al bezet (bijvoorbeeld door een reistype), dan met de code erachter.
      INSERT INTO trip_categories (slug, name, kind, iso_code)
        SELECT CASE WHEN EXISTS (SELECT 1 FROM trip_categories t WHERE t.slug = l.slug) THEN l.slug || '-' || lower(l.code) ELSE l.slug END,
               l.name, 'bestemming', l.code
          FROM migratie_landen l
         WHERE NOT EXISTS (SELECT 1 FROM trip_categories t WHERE t.iso_code = l.code);
    `,
};
