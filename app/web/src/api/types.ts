/**
 * Gedeelde typen van de JSON-API onder `/app/api/` (`app/src/api/`). De vorm van de antwoorden per module staat bij
 * die module in `src/modules/<module>/`.
 */

/** Vaste foutcodes van de server (`app/src/api/errors.js`). */
export type ApiErrorCode =
  | 'niet-ingelogd'
  | 'geweigerd'
  | 'geen-toegang'
  | 'niet-gevonden'
  | 'ongeldig'
  | 'te-groot'
  | 'verkeerd-formaat'
  | 'te-veel'
  | 'onderhoud'
  | 'fout';

/** Body van een foutantwoord. */
export interface ApiErrorBody {
  fout: {
    code: ApiErrorCode;
    melding: string;
    /** Melding per veld bij `ongeldig`. */
    velden?: Record<string, string>;
    /** Foutcode uit het logboek bij `fout`. */
    foutcode?: string;
    /** Pad om (opnieuw) in te loggen bij `niet-ingelogd`. */
    naar?: string;
  };
}

/** Antwoord van `GET /app/api/sessie/`. */
export interface SessionInfo {
  gebruiker: { naam: string; rol: string; rolNaam: string };
  rechten: string[];
}
