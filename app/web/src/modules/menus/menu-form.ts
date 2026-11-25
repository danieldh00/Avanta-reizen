/**
 * Omzetten tussen de velden van het formulier van een menu-item (tekst) en de invoer van de API.
 */
import { readOrder } from '../../components/order-tools';
import type { MenuItem, MenuItemInput } from './menu-api';

/** De ingevulde velden van een menu-item (tekst, zoals in het formulier). */
export interface MenuItemForm {
  menu: string;
  ouderId: string;
  tekst: string;
  adres: string;
  volgorde: string;
}

/**
 * Een leeg formulier: een hoofditem in het hoofdmenu.
 * @returns Lege velden.
 */
export const emptyMenuForm = (): MenuItemForm => ({ menu: 'hoofd', ouderId: '', tekst: '', adres: '', volgorde: '' });

/**
 * De velden van een bestaand item.
 * @param item Item van de server.
 * @returns Ingevulde velden.
 */
export const menuFormOf = (item: MenuItem): MenuItemForm => ({
  menu: item.menu, ouderId: item.ouderId === null ? '' : String(item.ouderId), tekst: item.tekst, adres: item.adres, volgorde: String(item.volgorde),
});

/**
 * De invoer voor de API uit de velden; een bovenliggend item telt alleen in het hoofdmenu (zoals de server eist).
 * @param form Ingevulde velden.
 * @returns Invoer.
 */
export const menuInputOf = (form: MenuItemForm): MenuItemInput => ({
  menu: form.menu, ouderId: form.ouderId && form.menu === 'hoofd' ? Number(form.ouderId) : null, tekst: form.tekst, adres: form.adres.trim(),
  volgorde: readOrder(form.volgorde),
});
