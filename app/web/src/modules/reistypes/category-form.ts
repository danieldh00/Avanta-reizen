/**
 * De velden van het formulier van een reistype of land (tekst, zoals in het formulier) en het omzetten van en naar de
 * invoer van de API.
 */
import { readOrder } from '../../components/order-tools';
import type { CategoryDetails, CategoryInput } from './category-api';

/** De ingevulde velden. */
export interface CategoryForm {
  naam: string;
  adres: string;
  soort: string;
  icoon: string;
  inleiding: string;
  tekst: string;
  volgorde: string;
  homepage: boolean;
}

/**
 * Een leeg formulier: standaard een land, zoals het oude scherm.
 * @returns Lege velden.
 */
export const emptyCategoryForm = (): CategoryForm => ({ naam: '', adres: '', soort: 'bestemming', icoon: '', inleiding: '', tekst: '', volgorde: '', homepage: false });

/**
 * De velden van een bestaand reistype of land.
 * @param category Categorie van de server.
 * @returns Ingevulde velden.
 */
export const categoryFormOf = (category: CategoryDetails): CategoryForm => ({
  naam: category.naam, adres: category.adres, soort: category.soort, icoon: category.icoon, inleiding: category.inleiding,
  tekst: category.tekst, volgorde: String(category.volgorde), homepage: category.homepage,
});

/**
 * De invoer voor de API uit de velden.
 * @param form Ingevulde velden.
 * @returns Invoer.
 */
export const categoryInputOf = (form: CategoryForm): CategoryInput => ({
  naam: form.naam, adres: form.adres.trim(), soort: form.soort, icoon: form.icoon, inleiding: form.inleiding, tekst: form.tekst,
  volgorde: readOrder(form.volgorde), homepage: form.homepage,
});
