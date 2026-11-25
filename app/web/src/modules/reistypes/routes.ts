/**
 * Schermen van de module Reistypes en landen, met paden ten opzichte van `/app/reistypes-en-landen/` (gelijk aan de
 * oude schermen).
 */
import type { RouteRecordRaw } from 'vue-router';
import CategoryOverviewScreen from './category-overview-screen.vue';
import CategoryItemScreen from './category-item-screen.vue';

/**
 * Leest het id uit de route als getal.
 * @param value Waarde van de parameter.
 * @returns Het id.
 */
const idProp = (value: string | string[] | undefined) => Number(Array.isArray(value) ? value[0] : value);

export const categoryRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'reistypes-overzicht', component: CategoryOverviewScreen },
  { path: '/:id(\\d{1,9})/', name: 'reistypes-item', component: CategoryItemScreen, props: (route) => ({ id: idProp(route.params.id) }) },
];
