/**
 * Schermen van de module Veelgestelde vragen, met paden ten opzichte van `/app/faq/` (gelijk aan de oude schermen).
 */
import type { RouteRecordRaw } from 'vue-router';
import FaqOverviewScreen from './faq-overview-screen.vue';
import FaqQuestionScreen from './faq-question-screen.vue';
import FaqCategoryScreen from './faq-category-screen.vue';

/**
 * Leest het id uit de route als getal.
 * @param value Waarde van de parameter.
 * @returns Het id.
 */
const idProp = (value: string | string[] | undefined) => Number(Array.isArray(value) ? value[0] : value);

export const faqRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'faq-overzicht', component: FaqOverviewScreen },
  { path: '/nieuw/', name: 'faq-vraag-nieuw', component: FaqQuestionScreen },
  { path: '/:id(\\d{1,9})/', name: 'faq-vraag', component: FaqQuestionScreen, props: (route) => ({ id: idProp(route.params.id) }) },
  { path: '/categorieen/:id(\\d{1,9})/', name: 'faq-categorie', component: FaqCategoryScreen, props: (route) => ({ id: idProp(route.params.id) }) },
];
