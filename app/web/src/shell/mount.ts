/**
 * Start van een module in de bestaande schil van het CRM. De server levert de pagina met zijbalk en kopbalk
 * (`app/src/crm/layout.js`) en zet in het midden één koppelpunt:
 *
 *   <div id="crm-app" data-module="faq" data-base="/app/faq/"></div>
 *
 * `mountModule` zoekt dat koppelpunt, maakt de app van Vue met een router in history-modus onder `data-base` (de
 * adressen blijven gelijk aan de oude schermen) en koppelt hem. Wisselen tussen modules blijft een gewone paginalading;
 * binnen een module wisselt de router zonder te herladen. Staat het eerste scherm er, dan krijgt het koppelpunt
 * `data-klaar="ja"` (de design-controle wacht daarop).
 */
import { createApp, type App, type Component } from 'vue';
import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router';
import ModuleRoot from './module-root.vue';
import NotFoundScreen from './not-found-screen.vue';

/** Id van het koppelpunt dat de server in de pagina zet. */
export const MOUNT_ID = 'crm-app';

/** Wat een module meegeeft bij het starten. */
export interface ModuleOptions {
  /** Naam van de module, gelijk aan `data-module` van het koppelpunt (bijvoorbeeld `faq`). */
  name: string;
  /** Schermen van de module, met paden ten opzichte van `data-base` (bijvoorbeeld `/` en `/:id/`). */
  routes: RouteRecordRaw[];
  /** Buitenste component; standaard alleen het scherm van de huidige route (`module-root.vue`). */
  root?: Component;
  /** Document om in te zoeken (tests); standaard het echte document. */
  document?: Document;
}

/** Resultaat van `mountModule`: de app en de router, voor tests en voor een module die er iets aan toevoegt. */
export interface MountedModule {
  app: App;
  router: Router;
}

/**
 * Leest het basispad van het koppelpunt en controleert het: alleen een pad onder `/app/` dat op `/` eindigt.
 * @param element Het koppelpunt.
 * @returns Het basispad, bijvoorbeeld `/app/faq/`.
 * @throws Error bij een ontbrekend of ongeldig basispad.
 */
export function readBase(element: HTMLElement): string {
  const base = element.dataset.base || '';
  if (!/^\/app\/[a-z0-9/-]*\/$/.test(base) || base.includes('//')) throw new Error(`Ongeldig basispad voor de module: '${base}'`);
  return base;
}

/**
 * Maakt de router van een module: history-modus onder het basispad, met een eigen scherm voor een onbekend pad binnen
 * de module, en na elke navigatie de focus op de hoofdinhoud (voor schermlezers en het toetsenbord).
 * @param base Basispad van de module.
 * @param routes Schermen van de module.
 * @returns De router.
 */
export function createModuleRouter(base: string, routes: RouteRecordRaw[]): Router {
  const router = createRouter({
    history: createWebHistory(base),
    routes: [...routes, { path: '/:pad(.*)*', name: 'niet-gevonden', component: NotFoundScreen }],
    // Gewone links naar een pad met een slash aan het eind, zoals de server ze geeft.
    strict: true,
  });
  router.afterEach((to, from) => {
    // Bij de eerste weergave niet: de pagina is net geladen en de browser zet de focus zelf.
    if (from.matched.length === 0) return;
    const main = document.getElementById('inhoud');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus();
    }
  });
  return router;
}

/**
 * Start een module op het koppelpunt van de pagina.
 * @param options Naam, schermen en eventueel een eigen buitenste component.
 * @returns De app en de router, of `null` als de pagina geen koppelpunt voor deze module heeft.
 */
export function mountModule(options: ModuleOptions): MountedModule | null {
  const doc = options.document || document;
  const element = doc.getElementById(MOUNT_ID);
  if (!element || element.dataset.module !== options.name) return null;
  const router = createModuleRouter(readBase(element), options.routes);
  const app = createApp(options.root || ModuleRoot);
  app.use(router);
  app.mount(element);
  // Voor de design-controle en tests: het eerste scherm staat er (of het laden is mislukt).
  router.isReady().then(
    () => { element.dataset.klaar = 'ja'; },
    () => { element.dataset.klaar = 'fout'; },
  );
  return { app, router };
}
