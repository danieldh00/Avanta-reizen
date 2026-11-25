/**
 * Schermen van de module Lijstpagina's, met paden ten opzichte van `/app/lijstpaginas/` (gelijk aan de oude schermen).
 */
import type { RouteRecordRaw } from 'vue-router';
import ListHeaderOverviewScreen from './list-header-overview-screen.vue';
import ListHeaderEditScreen from './list-header-edit-screen.vue';
import ListHeaderPhotoScreen from './list-header-photo-screen.vue';

/** De vaste sleutels van de lijstpagina's (gelijk aan `KEY_PATTERN` in `list-header-routes.js`). */
const KEY = ':key(reis|reisleider|blog|faq|aanmelden)';

/**
 * Leest de sleutel uit de route.
 * @param value Waarde van de parameter.
 * @returns De sleutel.
 */
const keyProp = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value);

export const listHeaderRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'lijstpaginas-overzicht', component: ListHeaderOverviewScreen },
  { path: `/${KEY}/`, name: 'lijstpaginas-wijzigen', component: ListHeaderEditScreen, props: (route) => ({ sleutel: keyProp(route.params.key) }) },
  { path: `/${KEY}/foto/`, name: 'lijstpaginas-foto', component: ListHeaderPhotoScreen, props: (route) => ({ sleutel: keyProp(route.params.key) }) },
];
