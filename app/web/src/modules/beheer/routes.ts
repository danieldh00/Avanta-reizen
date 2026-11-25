/**
 * Schermen van de module Beheer, met paden ten opzichte van `/app/beheer/`.
 */
import type { RouteRecordRaw } from 'vue-router';
import BouwstenenScreen from './bouwstenen-screen.vue';

export const beheerRoutes: RouteRecordRaw[] = [
  { path: '/bouwstenen/', name: 'bouwstenen', component: BouwstenenScreen, meta: { title: 'Bouwstenen' } },
];
