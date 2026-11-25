/**
 * Schermen van de module Categorieën en tags, met paden ten opzichte van `/app/blog/categorieen-en-tags/` (gelijk aan
 * de oude schermen).
 */
import type { RouteRecordRaw } from 'vue-router';
import TermOverviewScreen from './term-overview-screen.vue';
import TermEditScreen from './term-edit-screen.vue';

/**
 * Leest het id uit de route als getal.
 * @param value Waarde van de parameter.
 * @returns Het id.
 */
const idProp = (value: string | string[] | undefined) => Number(Array.isArray(value) ? value[0] : value);

export const termRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'blog-indeling-overzicht', component: TermOverviewScreen },
  { path: '/:id(\\d{1,9})/', name: 'blog-indeling-wijzigen', component: TermEditScreen, props: (route) => ({ id: idProp(route.params.id) }) },
];
