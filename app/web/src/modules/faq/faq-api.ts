/**
 * Getypte toegang tot de API van de veelgestelde vragen (`/app/api/faq/…`, `app/src/cms/faq-api.js`). De schermen van
 * deze module praten alleen via deze functies met de server.
 */
import { api, type ApiClient } from '../../api/client';

/** Een vraag in het overzicht. */
export interface FaqListQuestion {
  id: number;
  vraag: string;
  volgorde: number;
}

/** Een categorie met haar vragen in het overzicht. */
export interface FaqCategory {
  id: number;
  naam: string;
  volgorde: number;
  vragen: FaqListQuestion[];
}

/** Grenzen van de server (lengtes en aantallen). */
export interface FaqLimits {
  categorieen: number;
  vragen: number;
  naam: number;
  vraag: number;
  antwoord: number;
}

/** Het overzicht: categorieën, vragen zonder categorie (uit de import) en de grenzen. */
export interface FaqOverview {
  categorieen: FaqCategory[];
  los: FaqListQuestion[];
  grenzen: FaqLimits;
}

/** Eén vraag om te bewerken. `antwoord` is HTML die de server al heeft opgeschoond. */
export interface FaqQuestion {
  id: number;
  vraag: string;
  antwoord: string;
  categorieId: number | null;
  volgorde: number;
  gewijzigd: string;
}

/** Wat een scherm opstuurt voor een vraag. */
export interface FaqQuestionInput {
  vraag: string;
  antwoord: string;
  categorieId: number;
  volgorde?: number;
}

/** Eén categorie om te bewerken. */
export interface FaqCategoryDetails {
  id: number;
  naam: string;
  volgorde: number;
  aantalVragen: number;
}

/** Wat een scherm opstuurt voor een categorie. */
export interface FaqCategoryInput {
  naam: string;
  volgorde?: number;
}

/**
 * Maakt de functies voor de FAQ op een client (tests geven een eigen client mee).
 * @param client Client van de API.
 * @returns Functies per handeling.
 */
export function createFaqApi(client: ApiClient = api) {
  return {
    overview: () => client.get<FaqOverview>('/faq/'),
    question: (id: number) => client.get<FaqQuestion>(`/faq/vragen/${id}/`),
    createQuestion: (input: FaqQuestionInput) => client.post<{ id: number }>('/faq/vragen/', input),
    updateQuestion: (id: number, input: FaqQuestionInput) => client.put<{ id: number }>(`/faq/vragen/${id}/`, input),
    removeQuestion: (id: number) => client.delete<void>(`/faq/vragen/${id}/`),
    category: (id: number) => client.get<FaqCategoryDetails>(`/faq/categorieen/${id}/`),
    createCategory: (input: FaqCategoryInput) => client.post<{ id: number }>('/faq/categorieen/', input),
    updateCategory: (id: number, input: FaqCategoryInput) => client.put<{ id: number; hernoemd: boolean }>(`/faq/categorieen/${id}/`, input),
    removeCategory: (id: number) => client.delete<void>(`/faq/categorieen/${id}/`),
    orderCategories: (ids: number[]) => client.put<{ ok: true }>('/faq/volgorde/', { categorieen: ids }),
    orderQuestions: (categoryId: number, ids: number[]) => client.put<{ ok: true }>(`/faq/categorieen/${categoryId}/volgorde/`, { vragen: ids }),
  };
}

/** Type van de functies voor de FAQ. */
export type FaqApi = ReturnType<typeof createFaqApi>;

/** De functies voor de FAQ van de app. */
export const faqApi = createFaqApi();

// Gedeeld met de andere modules; hier opnieuw uitgevoerd zodat de schermen van de FAQ ze uit één bestand halen.
export { moveId, readOrder } from '../../components/order-tools';
