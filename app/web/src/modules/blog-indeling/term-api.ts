/**
 * Getypte toegang tot de API van de categorieën en tags van het blog (`/app/api/blog-indeling/…`,
 * `app/src/cms/post-term-api.js`). De schermen van deze module praten alleen via deze functies met de server.
 */
import { api, type ApiClient } from '../../api/client';

/** Soort: categorie of tag. */
export type TermKind = 'categorie' | 'tag';

/** Een categorie of tag in de lijst. */
export interface TermListItem {
  id: number;
  naam: string;
  /** Slug; het adres op de site is `voorvoegsel + adres + '/'`. */
  adres: string;
  berichten: number;
  volgorde: number;
}

/** Eén soort met haar lijst. */
export interface TermGroup {
  soort: TermKind;
  naam: string;
  meervoud: string;
  voorvoegsel: string;
  items: TermListItem[];
}

/** Grenzen van de server. */
export interface TermLimits {
  naam: number;
  inleiding: number;
  adres: number;
  aantal: number;
}

/** Het overzicht. */
export interface TermOverview {
  soorten: TermGroup[];
  grenzen: TermLimits;
}

/** Eén categorie of tag om te bewerken. */
export interface TermDetails {
  id: number;
  soort: TermKind;
  soortNaam: string;
  voorvoegsel: string;
  naam: string;
  adres: string;
  inleiding: string;
  volgorde: number;
  gewijzigd: string;
}

/** Wat een scherm opstuurt bij wijzigen. */
export interface TermInput {
  naam: string;
  adres?: string;
  inleiding?: string;
  volgorde?: number;
}

/**
 * Maakt de functies voor categorieën en tags op een client (tests geven een eigen client mee).
 * @param client Client van de API.
 * @returns Functies per handeling.
 */
export function createTermApi(client: ApiClient = api) {
  return {
    overview: () => client.get<TermOverview>('/blog-indeling/'),
    term: (id: number) => client.get<TermDetails>(`/blog-indeling/${id}/`),
    create: (input: TermInput & { soort: TermKind }) => client.post<{ id: number }>('/blog-indeling/', input),
    update: (id: number, input: TermInput) => client.put<{ id: number; verplaatst: boolean }>(`/blog-indeling/${id}/`, input),
    remove: (id: number) => client.delete<void>(`/blog-indeling/${id}/`),
  };
}

/** Type van de functies voor categorieën en tags. */
export type TermApi = ReturnType<typeof createTermApi>;

/** De functies voor categorieën en tags van de app. */
export const termApi = createTermApi();

/** Meldingen op het overzicht na een wissel vanaf het bewerkscherm (`?melding=<sleutel>`), gelijk aan het oude scherm. */
export const NOTICES: Record<string, string> = {
  opgeslagen: 'Opgeslagen.',
  weg: 'Verwijderd. Het adres verwijst nu naar het blog.',
  verplaatst: 'Het adres is gewijzigd; het oude adres verwijst automatisch door.',
};
