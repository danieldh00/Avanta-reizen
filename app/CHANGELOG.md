# Changelog

## 0.4.0 — 2026-11-20 — Beheer met instellingen

- Nieuw onderdeel **Beheer** in het CRM (alleen voor de beheerder): een zijbalk met zoekveld, een systeemoverzicht en
- De contactgegevens in de voettekst van de site (telefoon en e-mail) zijn nu aan te passen in Beheer.

- Migratie 5: tabel `settings` (sleutel, waarde, gewijzigd op/door).
- `src/beheer/settings.js`: register `SETTING_FIELDS` (tekst, e-mail, URL, tekstvak, ja/nee, getal, keuze, geheim) met
  controle op de server; volgorde database → omgevingsvariabele → standaard; geheimen versleuteld met de hoofdsleutel en
  gebonden aan de naam van de instelling, in het scherm alleen "ingesteld" met de laatste 4 tekens; terugzetten naar de
  startwaarde; opslaan en auditlog in één transactie.
- `src/beheer/indeling.js` + `routes.js`: `/app/beheer/` met groepen, zoeken (ook zonder JavaScript), systeemoverzicht en
  generieke instellingenformulieren; nieuw recht `systeem` (rol beheerder), menu-item *Beheer*.
- Contactgegevens uit Beheer in de voettekst en de JSON-LD van de homepage (`res.locals.contact`).
- Auditacties `instelling.gewijzigd` en `instelling.teruggezet` (alleen de naam van de instelling, nooit de waarde).

## 0.3.0 — 2026-11-20 — CRM - inloggen, rollen en auditlog

- Het CRM heeft een eigen beveiligde omgeving op `/app/`: inloggen, gebruikers met een rol (beheerder, kantoor,

- Migratie 4: tabellen `users` (uniek e-mailadres, rol, scrypt-hash), `sessions`
  (alleen SHA-256 van het token, inactiviteit 8 uur, maximaal 7 dagen) en `audit_log` (zonder persoonsgegevens,
  ingekort IP-adres).
- `app/src/crm/`: rechten als sleutels en rollen als bundels (`rights.js`), `requireRight` en CSRF-controle per route
  (`auth.js`), scrypt-wachtwoorden met rehash (`passwords.js`), inloggen/uitloggen/installatie/eigen wachtwoord
  (`routes.js`), gebruikersbeheer en auditlog (`users.js`).
- `/app/` krijgt `Cache-Control: no-store` en `noindex`; algemene limiet per IP, plus limieten op inloggen, installatie
  en wachtwoord wijzigen. Hoogstens 5 mislukte pogingen per kwartier per account en IP-reeks, pogingen vanuit 30 verschillende IP-reeksen
  binnen een uur zetten het account tot het einde van dat uur dicht (één reeks telt hoogstens eens per uur). Auditlog: bewaartermijn 2 jaar, dagelijks opgeruimd.
- `form-guard.js`: herkomstcontrole los beschikbaar als `isCrossSite`.

## 0.2.2 — 2026-11-20 — Contactformulier op /contact/ en SEO-restpunten

- Bezoekers kunnen via de contactpagina een bericht sturen; het bericht wordt bewaard voor het CRM.
- Vanaf een reis (`/contact/?reis=<slug>`) staat het onderwerp al ingevuld en wordt de reis bij het bericht bewaard.

- Migratie 3: tabel `contact_messages` (naam, e-mail, telefoon, onderwerp, bericht, `trip_slug`, status `nieuw`,
  `consent_at`) met index op `(status, created_at)`.
- Nieuw `app/src/contact/` (`fields.js` met validatie, `routes.js` met formulier en verwerking); `site/routes.js` toont
  het formulier onder de geïmporteerde inhoud van `/contact/`. Fouten geven 422 met Nederlandse meldingen, succes een
  303 naar `/contact/?verzonden=1`. Geen mailverzending.
- Nieuw `app/src/security/form-guard.js`: herkomstcontrole (403), limiet per bezoeker (429), honeypot en ondertekend
  tijdstempel per formulier, voor `/contact/` en `/aanmelden/`. Alleen een ingevulde honeypot wordt nog stil
  genegeerd; een ongeldig, verlopen of te snel token geeft 422 met de ingevulde waarden, een melding en een nieuw
  token, zodat een bezoeker het formulier opnieuw kan versturen.
- Contact- en aanmeldformulier verwijderen stuurtekens (zoals NUL) uit de invoer; die gaven eerder een 500 bij het opslaan.
- Het akkoord-vakje telt alleen bij precies de waarde `ja`; een andere waarde geeft de foutmelding (contact en aanmelden).
- `robots.txt` noemt bij indexeren de absolute sitemap-URL (`${SITE_URL}/sitemap.xml`).
- Canonical op de aanmeldpagina (`/aanmelden/?id=…`) en de 404-pagina; beide blijven noindex.
- CSS: `.container.section` houdt de zijmarge (16 px op mobiel); selectievakjes en keuzerondjes in `.form` niet meer
  op volle breedte.
- `SITE_URL` in `.env.example` en `docker-compose.yml`.

## 0.2.1 — 2026-11-20 — SEO-klaar voor de go-live (canonical, Open Graph, JSON-LD en sitemap)

- Elke pagina vertelt zoekmachines en social media nu het juiste adres, de titel, beschrijving en afbeelding.
- Nieuwe sitemap op `/sitemap.xml` met alle reizen (ook vertrokken), categorieën, reisleiders, blog en pagina's.

- Nieuw `app/src/site/seo.js`: canonical-URL, Open Graph- en Twitter-tags, JSON-LD (`TravelAgency` op de homepage,
  `Trip` met `offers` op reispagina's, `BlogPosting` op blogberichten, `BreadcrumbList` op reis-, categorie- en
  blogpagina's) en de opbouw van de sitemap. JSON-LD gaat via `JSON.stringify` met `<`, `>` en `&` als unicode-escape.
- Basisadres uit de omgevingsvariabele `SITE_URL` (standaard `https://www.avantareizen.nl`); de canonical gebruikt
  het echte pad van de pagina, niet het menupad.
- Route `/sitemap.xml` (10 minuten in het geheugen, `lastmod` voor blogberichten); query `sitemapEntries` in
  `content.js`. `robots.txt` verwijst er alleen naar bij `SITE_INDEXABLE=true`, met een absolute URL op `SITE_URL`.
- Tests in `app/test/seo.test.js` (eigen databaseschema, zodat ze naast `server.test.js` draaien).

## 0.2.0 — 2026-11-20 — Nieuwe website: reizen, reisleiders, blog, FAQ en aanmelden

- De website van Avanta Reizen is nagebouwd: reisaanbod met zoeker, reispagina's, reisleiders, weblog, veelgestelde vragen en alle informatiepagina's.
- Aanmelden voor een reis gaat via een eigen formulier; bijzondere gegevens worden versleuteld bewaard.

- App-skelet: Node 22 + Express, server-gerenderde HTML, PostgreSQL 17 met migraties, Dockerfile en docker-compose.
- Huisstijl (Playfair Display, Open Sans, lokaal), menu, paginakop, kaarten; responsive op 1440 en 375 px.
- Routes gelijk aan de huidige site, met 301 voor oude adressen; noindex tot go-live; CSP en beveiligingskoppen.
- Importscript `tools/import-wordpress.js`: reizen, reisleiders, categorieën, blog, pagina's, FAQ en afbeeldingen uit de huidige site; HTML opgeschoond met een allowlist.
- Aanmeldformulier `/aanmelden/` → tabel `bookings` met versleutelde gevoelige velden (AES-256-GCM), limiet, herkomstcontrole, honeypot en ondertekend tijdstempel.
- CI: app-tests tegen PostgreSQL, npm audit en een smoketest van het image.

## 0.1.0

Startpunt van de repository: werkwijze, reviews en releaseautomatisering.
