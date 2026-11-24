# Releasenotes per wijziging

Een PR verhoogt het versienummer niet en past `app/CHANGELOG.md` niet aan.
Voeg in plaats daarvan één bestand toe: `changes/<korte-naam>.md`. Na het mergen geeft `release.yml`
de wijziging het volgende versienummer (patch + 1; na x.y.9 komt x.(y+1).0), zet de notes in
`app/CHANGELOG.md`, verwijdert het bestand en commit dat naar `main`.

```
---
titel: Korte titel van de wijziging
bump: minor        (optioneel; alleen patch of minor, standaard patch)
---

## Nieuws
- Wat een gebruiker merkt, in gewone taal (optioneel).

## Changelog
Technische beschrijving (markdown), komt onder "## <versie>" in app/CHANGELOG.md.
```

- `## Nieuws` mag leeg zijn of ontbreken (een wijziging zonder zichtbaar effect); `## Changelog` is verplicht.
- Alleen docs/CI zonder effect op de app: geef de PR het label `geen-releasenotes`, dan is geen bestand nodig.
- Een fout in bestaande tekst van `app/CHANGELOG.md` verbeteren kan alleen met het label `changelog-correctie`: evenveel
  regels, dezelfde versies en datums; nieuwe notes blijven via `changes/` lopen.
- Een major-versie verhoogt alleen de beheerder met de hand.
- Controle lokaal: `node tools/release-notes.js --check`.
