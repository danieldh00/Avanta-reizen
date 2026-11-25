/**
 * Meldingen op het overzicht na een wissel vanaf een bewerkscherm (`?melding=<sleutel>`), gelijk aan de meldingen van
 * het oude scherm. Alleen vaste teksten: een onbekende sleutel toont niets.
 */
export const NOTICES: Record<string, string> = {
  opgeslagen: 'Opgeslagen.',
  'vraag-weg': 'De vraag is verwijderd.',
  'categorie-weg': 'De categorie is verwijderd.',
  hernoemd: 'De categorie heeft een nieuwe naam. Een FAQ-blok op een pagina dat alleen deze categorie toonde, kies je opnieuw.',
};
