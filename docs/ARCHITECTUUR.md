# Architectuur: modules en parallel werken

Hoe de code van Avanta Reizen is ingedeeld, welke bestanden gedeeld zijn en hoe meerdere threads tegelijk kunnen
bouwen zonder merge-conflicten. De opzet volgt die van AquaTech: een map per domein, per onderwerp een bestand met de
logica en een bestand met de routes, en zo min mogelijk bestanden waar elke wijziging langs moet.

Dit bestand beschrijft de stand op `main`. Wie de indeling verandert, werkt dit bestand bij in dezelfde PR.

## 1. Modules (één map = één domein)

Alle code van de app staat in `app/src/`. Een map is een module met één onderwerp; de tests van een module staan in
`app/test/` met dezelfde naam vooraan (`cms-*.test.js`, `trips.test.js`, `payments.test.js`).

| Module | Map | Onderwerp |
|---|---|---|
| Site | `site/`, `contact/` | publieke website: routes, queries, weergave, SEO, doorverwijzingen |
| Boeken | `booking/` | aanmeldformulier |
| Reizigersaccount | `account/` | `/account/`: registreren, inloggen, Mijn reizen |
| CRM | `crm/` | `/app/`: inloggen, gebruikers, rechten, 2FA, personen, aanmeldingen, betalingen, AVG |
| Reisaanbod | `trips/` | reizen, reistypes en landen, reisleiders |
| Website-inhoud | `cms/` | pagina's in blokken, menu's, blog, FAQ |
| Foto's | `media/` | fotobibliotheek |
| Beheer | `beheer/` | `/app/beheer/`: instellingen en systeemschermen |
| Platform | `system/`, `backup/`, `mail/`, `security/`, `export/`, `database/` | logboek, bewaking, updates, back-ups, mail, kluis en limieten, Excel, database |

Binnen een module:

- **`<onderwerp>.js`** bevat de logica en de queries (fabriek `create<Onderwerp>(…)` of losse functies), zonder
  Express.
- **`<onderwerp>-routes.js`** bevat de routes en de schermen van dat onderwerp (`create<Onderwerp>Routes(context)`
  geeft een router terug). Wat de routes nodig hebben (database, sessies, instellingen) krijgen ze als argument mee,
  nooit via een globale variabele.
- Een nieuw onderwerp is een nieuw paar bestanden in de map van zijn module, geen uitbreiding van een bestaand
  bestand. Een bestand dat boven ongeveer 500 regels komt, splits je op onderwerp.

## 2. Gedeelde kernbestanden

Dit zijn de bestanden waar wijzigingen uit verschillende modules samenkomen. Een thread die er een raakt, meldt dat
aan de coördinator vóór hij begint; twee threads werken nooit tegelijk in hetzelfde kernbestand.

| Bestand | Waarom gedeeld | Stand |
|---|---|---|
| `database/migrations/` | elke migratie | **opgesplitst**: één bestand per migratie, zie §3 |
| `crm/routes.js` | koppelt de routes van alle modules aan `/app/` | wordt opgesplitst (stap 2) |
| `beheer/settings.js`, `beheer/indeling.js` | elke nieuwe instelling | wordt opgesplitst (stap 3) |
| `server.js` | maakt alle diensten aan en start de timers | wordt opgesplitst (stap 4) |
| `crm/layout.js` | menu van het CRM | wordt opgesplitst (stap 2) |
| `public/css/site.css`, `public/css/crm.css` | alle opmaak | blijft gedeeld tot het minificeren (plan PR 6.6) |
| `README.md`, `CLAUDE.md` | documentatie van elke feature | wordt per map verdeeld (stap 5) |

## 3. Migraties

- Eén bestand per migratie: `app/src/database/migrations/NNN-korte-naam.js` met `module.exports = { id, name, sql }`.
  `NNN` is het nummer met voorloopnullen en gelijk aan `id`.
- `database/migrations.js` is alleen de lader: hij leest de map op volgorde en weigert te starten bij een gat, een
  dubbel nummer, een afwijkend `id` of een verkeerde bestandsnaam (`test/migrations.test.js`). Een nieuwe migratie
  raakt dit bestand dus niet.
- Migraties blijven positioneel. Neem het eerstvolgende vrije nummer op `main`. Is er intussen een andere migratie
  gemerged, hernoem dan na de rebase je eigen bestand naar het volgende nummer en pas `id` aan; dat is een hernoeming
  van je eigen bestand, geen conflict in een gedeeld bestand.
- Een migratie die op `main` staat verandert nooit meer. Er loopt hoogstens één migratie-PR tegelijk, omdat twee
  migraties elkaars tabellen kunnen raken.

## 4. Regels voor parallel werken

1. Hoogstens drie codethreads tegelijk, elk in een eigen module uit §1. De opdracht aan een thread noemt de map(pen)
   die hij mag raken.
2. Raakt een taak een kernbestand uit §2 of een tweede module, dan stemt de thread dat af via de coördinator en
   houdt hij die wijziging zo klein mogelijk (een regel in een lijst, geen herschikking).
3. Bestanden verplaatsen, hernoemen of herschikken gebeurt in een eigen PR zonder andere wijzigingen, en alleen als
   geen andere thread in die map werkt.
4. Rebase op `main` vóór het openen van de PR en nog eens vlak voor de merge.
5. Elke PR voegt alleen eigen bestanden toe waar dat kan: een eigen fragment in `changes/`, een eigen
   migratiebestand, een eigen testbestand. Versienummer en `app/CHANGELOG.md` raakt niemand aan.
