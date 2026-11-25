/**
 * Tests van het starten van een module op het koppelpunt (`mount.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { createModuleRouter, mountModule, readBase, MOUNT_ID } from './mount';

const ListScreen = defineComponent({ name: 'ListScreen', render: () => h('h2', 'Lijst') });
const DetailScreen = defineComponent({ name: 'DetailScreen', render: () => h('h2', 'Detail') });

/**
 * Zet een koppelpunt in het document, met een hoofdinhoud eromheen zoals in de schil.
 * @param attributes Waarden voor `data-module` en `data-base`.
 * @returns Het koppelpunt.
 */
function addMountPoint(attributes: { module: string; base: string }): HTMLElement {
  const main = document.createElement('main');
  main.id = 'inhoud';
  const element = document.createElement('div');
  element.id = MOUNT_ID;
  element.dataset.module = attributes.module;
  element.dataset.base = attributes.base;
  main.appendChild(element);
  document.body.appendChild(main);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('readBase', () => {
  it('accepteert een pad onder /app/ met een slash aan het eind', () => {
    const element = document.createElement('div');
    element.dataset.base = '/app/reistypes-en-landen/';
    expect(readBase(element)).toBe('/app/reistypes-en-landen/');
  });

  it.each(['', '/app/faq', '/faq/', '//evil.example/', '/app//faq/', 'https://evil.example/app/', '/app/FAQ/'])('weigert %j', (base) => {
    const element = document.createElement('div');
    element.dataset.base = base;
    expect(() => readBase(element)).toThrow('Ongeldig basispad');
  });
});

describe('mountModule', () => {
  it('doet niets zonder koppelpunt of bij een andere module', () => {
    expect(mountModule({ name: 'faq', routes: [] })).toBeNull();
    addMountPoint({ module: 'reizen', base: '/app/reizen/' });
    expect(mountModule({ name: 'faq', routes: [] })).toBeNull();
  });

  it('toont het scherm van het huidige adres en wisselt zonder te herladen', async () => {
    window.history.replaceState(null, '', '/app/faq/');
    const element = addMountPoint({ module: 'faq', base: '/app/faq/' });
    const mounted = mountModule({ name: 'faq', routes: [{ path: '/', component: ListScreen }, { path: '/:id/', component: DetailScreen }] });
    expect(mounted).not.toBeNull();
    await mounted!.router.isReady();
    expect(element.textContent).toBe('Lijst');
    await mounted!.router.push('/12/');
    expect(element.textContent).toBe('Detail');
    expect(window.location.pathname).toBe('/app/faq/12/');
    // Na het wisselen staat de focus op de hoofdinhoud.
    expect(document.activeElement?.id).toBe('inhoud');
    mounted!.app.unmount();
  });

  it('toont een eigen scherm bij een onbekend pad binnen de module', async () => {
    window.history.replaceState(null, '', '/app/faq/bestaat-niet/');
    const element = addMountPoint({ module: 'faq', base: '/app/faq/' });
    const mounted = mountModule({ name: 'faq', routes: [{ path: '/', component: ListScreen }] });
    await mounted!.router.isReady();
    expect(element.querySelector('h1')?.textContent).toBe('Niet gevonden');
    mounted!.app.unmount();
  });
});

describe('createModuleRouter', () => {
  it('zet de focus niet bij de eerste weergave', async () => {
    window.history.replaceState(null, '', '/app/faq/');
    addMountPoint({ module: 'faq', base: '/app/faq/' });
    const router = createModuleRouter('/app/faq/', [{ path: '/', component: ListScreen }]);
    await router.push('/');
    expect(document.activeElement).toBe(document.body);
  });

  it('werkt ook als de pagina geen hoofdinhoud heeft', async () => {
    window.history.replaceState(null, '', '/app/faq/');
    const router = createModuleRouter('/app/faq/', [{ path: '/', component: ListScreen }, { path: '/:id/', component: DetailScreen }]);
    await router.push('/');
    await router.push('/3/');
    expect(router.currentRoute.value.params.id).toBe('3');
  });
});
