/**
 * Getypte toegang tot de API van de reistypes en landen (`/app/api/reistypes-en-landen/…`,
 * `app/src/trips/category-api.js`). De schermen van deze module praten alleen via deze functies met de server.
 */
import { api, type ApiClient } from '../../api/client';
import type { PickerPage } from '../../components/photo-picker.vue';

/** Soort categorie. */
export type CategoryKind = 'type' | 'bestemming' | 'overig';

/** Eén vorm van een icoon (gelijk aan `ICONS` in `app/src/site/icons.js`). */
export interface IconShape {
  d?: string;
  circle?: number[];
  rect?: number[];
  fill?: boolean;
}

/** Een soort met haar naam. */
export interface CategoryKindInfo {
  soort: CategoryKind;
  naam: string;
  meervoud: string;
}

/** Een reistype of land in de lijst. */
export type CategoryListItem = {
  id: number;
  naam: string;
  adres: string;
  soort: CategoryKind;
  /** Naam van het icoon (alleen bij een reistype). */
  icoon: string | null;
  /** ISO-landcode (alleen bij een land uit de lijst van de wereld). */
  code: string | null;
  volgorde: number;
  homepage: boolean;
  reizen: number;
  komend: number;
  fotos: number;
};

/** Grenzen van de server. */
export interface CategoryLimits {
  naam: number;
  inleiding: number;
  tekst: number;
}

/** Het overzicht. */
export interface CategoryOverview {
  soorten: CategoryKindInfo[];
  items: CategoryListItem[];
  iconen: Record<string, IconShape[]>;
  grenzen: CategoryLimits;
}

/** Eén reistype of land om te bewerken. `tekst` is HTML die de server al heeft opgeschoond. */
export interface CategoryDetails {
  id: number;
  naam: string;
  adres: string;
  /** Adres op de site (`/reis-categorie/<slug>/`). */
  pad: string;
  soort: CategoryKind;
  /** Gekozen icoon; leeg = automatisch op de slug. */
  icoon: string;
  code: string | null;
  inleiding: string;
  tekst: string;
  volgorde: number;
  homepage: boolean;
  /** Adres van de foto (`/media/…`), of null. */
  foto: string | null;
  reizen: number;
  fotos: number;
  gewijzigd: string;
  /** Andere categorieën van dezelfde soort (om mee samen te voegen). */
  samenvoegenMet: { id: number; naam: string; adres: string }[];
}

/** Wat een scherm opstuurt. */
export interface CategoryInput {
  naam: string;
  adres?: string;
  soort: string;
  icoon?: string;
  inleiding?: string;
  tekst?: string;
  volgorde?: number;
  homepage?: boolean;
}

/**
 * Maakt de functies voor reistypes en landen op een client (tests geven een eigen client mee).
 * @param client Client van de API.
 * @returns Functies per handeling.
 */
export function createCategoryApi(client: ApiClient = api) {
  return {
    overview: () => client.get<CategoryOverview>('/reistypes-en-landen/'),
    category: (id: number) => client.get<CategoryDetails>(`/reistypes-en-landen/${id}/`),
    create: (input: CategoryInput) => client.post<{ id: number }>('/reistypes-en-landen/', input),
    update: (id: number, input: CategoryInput) => client.put<{ id: number; verplaatst: boolean }>(`/reistypes-en-landen/${id}/`, input),
    remove: (id: number) => client.delete<void>(`/reistypes-en-landen/${id}/`),
    setPhoto: (id: number, photoId: number | null) => client.put<{ foto: string | null }>(`/reistypes-en-landen/${id}/foto/`, { fotoId: photoId }),
    photos: (id: number, query: { text: string; page: number; all: boolean }) => {
      const params = new URLSearchParams({ pagina: String(query.page) });
      if (query.text) params.set('zoek', query.text);
      if (query.all) params.set('alle', '1');
      // Een punt als %2E: `checkPath` weigert `..` in een pad, ook als dat alleen in de zoektekst staat.
      return client.get<PickerPage>(`/reistypes-en-landen/${id}/fotos/?${params.toString().replace(/\./g, '%2E')}`);
    },
    merge: (id: number, targetId: number) => client.post<{ doelId: number }>(`/reistypes-en-landen/${id}/samenvoegen/`, { doelId: targetId }),
  };
}

/** Type van de functies voor reistypes en landen. */
export type CategoryApi = ReturnType<typeof createCategoryApi>;

/** De functies voor reistypes en landen van de app. */
export const categoryApi = createCategoryApi();

/** Meldingen na een wissel (`?melding=<sleutel>`), gelijk aan de meldingen van het oude scherm. */
export const NOTICES: Record<string, string> = {
  opgeslagen: 'Opgeslagen.',
  verplaatst: 'Opgeslagen. Het oude adres verwijst automatisch door naar het nieuwe.',
  samengevoegd: 'Samengevoegd. Het oude adres verwijst automatisch door naar deze categorie.',
  weg: 'Verwijderd.',
};
