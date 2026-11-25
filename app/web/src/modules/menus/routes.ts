/**
 * Schermen van de module Menu's, met paden ten opzichte van `/app/menus/` (gelijk aan de oude schermen).
 */
import type { RouteRecordRaw } from 'vue-router';
import MenuOverviewScreen from './menu-overview-screen.vue';
import MenuItemScreen from './menu-item-screen.vue';

/**
 * Leest het id uit de route als getal.
 * @param value Waarde van de parameter.
 * @returns Het id.
 */
const idProp = (value: string | string[] | undefined) => Number(Array.isArray(value) ? value[0] : value);

export const menuRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'menus-overzicht', component: MenuOverviewScreen },
  { path: '/:id(\\d{1,9})/', name: 'menus-item', component: MenuItemScreen, props: (route) => ({ id: idProp(route.params.id) }) },
];
