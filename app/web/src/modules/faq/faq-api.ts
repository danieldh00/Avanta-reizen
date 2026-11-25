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

/**
 * Verschuift één element in een lijst een plaats omhoog of omlaag.
 * @param ids De id's in de huidige volgorde.
 * @param id Het id dat verschuift.
 * @param step -1 omhoog, 1 omlaag.
 * @returns De nieuwe volgorde, of null als het element al bovenaan of onderaan staat (of niet in de lijst).
 */
export function moveId(ids: number[], id: number, step: -1 | 1): number[] | null {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const moved = [...ids];
  moved[from] = ids[to]!;
  moved[to] = id;
  return moved;
}

/**
 * Leest een volgorde uit een veld: leeg is geen volgorde (de server neemt dan 0), anders het getal zoals ingevuld.
 * Een ongeldig getal gaat ongewijzigd mee, zodat de server de melding geeft. Vue zet de waarde van een getalveld
 * (`type="number"`) zelf al om naar een getal; daarom mag het ook een getal zijn.
 * @param value Ingevulde waarde.
 * @returns Getal, of undefined als het veld leeg is.
 */
export function readOrder(value: string | number): number | undefined {
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : Number(trimmed);
}
