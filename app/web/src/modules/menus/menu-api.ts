/**
 * Getypte toegang tot de API van de menu's (`/app/api/menus/…`, `app/src/cms/menu-api.js`). De schermen van deze
 * module praten alleen via deze functies met de server.
 */
import { api, type ApiClient } from '../../api/client';

/** Sleutel van een menu. */
export type MenuKey = 'hoofd' | 'voet';

/** Een item in een menu; `ouderId` is het hoofditem van een submenu-item. */
export interface MenuItem {
  id: number;
  menu: MenuKey;
  ouderId: number | null;
  tekst: string;
  adres: string;
  volgorde: number;
}

/** Een menu met zijn items (submenu-items direct onder hun hoofditem). */
export interface MenuGroup {
  menu: MenuKey;
  naam: string;
  items: MenuItem[];
}

/** Suggestie voor het adres: een vast pad of een gepubliceerde pagina. */
export interface PathSuggestion {
  pad: string;
  titel: string;
}

/** Grenzen van de server. */
export interface MenuLimits {
  tekst: number;
  adres: number;
  items: number;
}

/** Het overzicht. */
export interface MenuOverview {
  menus: MenuGroup[];
  suggesties: PathSuggestion[];
  grenzen: MenuLimits;
}

/** Eén item om te bewerken. */
export interface MenuItemDetails extends MenuItem {
  aantalSubitems: number;
}

/** Wat een scherm opstuurt. */
export interface MenuItemInput {
  menu: string;
  ouderId: number | null;
  tekst: string;
  adres: string;
  volgorde?: number;
}

/**
 * Maakt de functies voor de menu's op een client (tests geven een eigen client mee).
 * @param client Client van de API.
 * @returns Functies per handeling.
 */
export function createMenuApi(client: ApiClient = api) {
  return {
    overview: () => client.get<MenuOverview>('/menus/'),
    item: (id: number) => client.get<MenuItemDetails>(`/menus/${id}/`),
    create: (input: MenuItemInput) => client.post<{ id: number }>('/menus/', input),
    update: (id: number, input: MenuItemInput) => client.put<{ id: number }>(`/menus/${id}/`, input),
    remove: (id: number) => client.delete<void>(`/menus/${id}/`),
  };
}

/** Type van de functies voor de menu's. */
export type MenuApi = ReturnType<typeof createMenuApi>;

/** De functies voor de menu's van de app. */
export const menuApi = createMenuApi();

/** Meldingen op het overzicht na een wissel vanaf het bewerkscherm (`?melding=<sleutel>`), gelijk aan het oude scherm. */
export const NOTICES: Record<string, string> = {
  nieuw: 'Het item staat in het menu.',
  gewijzigd: 'Het item is gewijzigd.',
  weg: 'Het item is verwijderd (met zijn submenu).',
};
