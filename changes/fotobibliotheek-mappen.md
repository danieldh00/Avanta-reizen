---
titel: Fotobibliotheek: mappen per land, gebruikt in en verwijderen
---

## Nieuws
- De fotobibliotheek toont de landen als mappen met het aantal foto's, en een map *Zonder land*.
- Bij elke foto zie je waar hij gebruikt wordt. Een geüploade foto die nergens gebruikt wordt kun je verwijderen.

## Changelog
- `media/library.js`: `folders()` (aantal per land en zonder land), `usage()` (reizen, berichten, pagina's,
  reisleiders, reiscategorieën en de vaste-inhoudbestanden), `remove()` (alleen uploads die nergens gebruikt worden,
  rij onder slot in een transactie, daarna de eigen `bib-*`-bestanden), `cleanupOrphans()` + dagelijkse timer.
- Route `POST /app/fotobibliotheek/:id/verwijderen/` (recht `media`, CSRF, 409 bij gebruik of importfoto, audit
  `media.verwijderd`).
