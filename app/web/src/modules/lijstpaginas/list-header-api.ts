/**
 * Getypte toegang tot de API van de koppen van de lijstpagina's (`/app/api/lijstpaginas/…`,
 * `app/src/cms/list-header-api.js`). De schermen van deze module praten alleen via deze functies met de server.
 */
import { api, type ApiClient } from '../../api/client';
import type { PickerPage } from '../../components/photo-picker.vue';

/** Een kop van een lijstpagina. */
export type ListHeader = {
  /** Vaste sleutel (`reis`, `reisleider`, `blog`, `faq`, `aanmelden`). */
  sleutel: string;
  naam: string;
  /** Adres op de site, of null. */
  pad: string | null;
  pretitel: string;
  titel: string;
  inleiding: string;
  /** Adres van de foto (`/media/…`), of null. */
  foto: string | null;
  /** Waar de inhoud vandaan komt (`standaard`, `bestand`, `crm`) en de naam daarvan. */
  bron: string;
  bronNaam: string;
};

/** Grenzen van de server. */
export interface ListHeaderLimits {
  pretitel: number;
  titel: number;
  inleiding: number;
}

/** Het overzicht. */
export interface ListHeaderOverview {
  koppen: ListHeader[];
  grenzen: ListHeaderLimits;
}

/** Wat het bewerkscherm opstuurt. */
export interface ListHeaderInput {
  pretitel: string;
  titel: string;
  inleiding: string;
}

/**
 * Maakt de functies voor de lijstpagina's op een client (tests geven een eigen client mee).
 * @param client Client van de API.
 * @returns Functies per handeling.
 */
export function createListHeaderApi(client: ApiClient = api) {
  return {
    overview: () => client.get<ListHeaderOverview>('/lijstpaginas/'),
    header: (key: string) => client.get<ListHeader>(`/lijstpaginas/${key}/`),
    update: (key: string, input: ListHeaderInput) => client.put<ListHeader>(`/lijstpaginas/${key}/`, input),
    setPhoto: (key: string, photoId: number | null) => client.put<ListHeader>(`/lijstpaginas/${key}/foto/`, { fotoId: photoId }),
    photos: (key: string, query: { text: string; page: number }) => {
      const params = new URLSearchParams({ pagina: String(query.page) });
      if (query.text) params.set('zoek', query.text);
      // Een punt als %2E: `checkPath` weigert `..` in een pad, ook als dat alleen in de zoektekst staat.
      return client.get<PickerPage>(`/lijstpaginas/${key}/fotos/?${params.toString().replace(/\./g, '%2E')}`);
    },
  };
}

/** Type van de functies voor de lijstpagina's. */
export type ListHeaderApi = ReturnType<typeof createListHeaderApi>;

/** De functies voor de lijstpagina's van de app. */
export const listHeaderApi = createListHeaderApi();

/** Meldingen na een wissel (`?melding=<sleutel>`), gelijk aan het oude scherm. */
export const NOTICES: Record<string, string> = { opgeslagen: 'Opgeslagen.', foto: 'De foto is opgeslagen.' };
