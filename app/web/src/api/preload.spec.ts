/**
 * Tests van de voorgeladen antwoorden (`preload.ts`): lezen uit het koppelpunt, één keer gebruiken, kapotte inhoud,
 * vervallen na de eerste wissel binnen een module, en de client die bij een GET eerst het voorgeladen antwoord neemt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { clearPreloaded, loadPreloaded, takePreloaded } from './preload';
import { createApiClient } from './client';
import { mountModule, MOUNT_ID } from '../shell/mount';

/**
 * Een koppelpunt met voorgeladen antwoorden.
 * @param value Inhoud van `data-voorgeladen`.
 * @returns Het koppelpunt.
 */
function mountPoint(value?: string): HTMLElement {
  const element = document.createElement('div');
  element.id = MOUNT_ID;
  element.dataset.module = 'proef';
  element.dataset.base = '/app/proef/';
  if (value !== undefined) element.dataset.voorgeladen = value;
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  clearPreloaded();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('preload', () => {
  it('leest de antwoorden, haalt het attribuut weg en geeft elk antwoord één keer', () => {
    const element = mountPoint(JSON.stringify({ '/faq/': { los: [] }, '/faq/vragen/3/': null }));
    loadPreloaded(element);
    expect(element.dataset.voorgeladen).toBeUndefined();
    expect(takePreloaded('/faq/')).toEqual({ value: { los: [] } });
    expect(takePreloaded('/faq/')).toBeUndefined();
    expect(takePreloaded('/faq/vragen/3/')).toEqual({ value: null });
    expect(takePreloaded('/menus/')).toBeUndefined();
  });

  it.each([undefined, '', 'geen json', '[1, 2]', 'null', '"tekst"'])('negeert %j', (value) => {
    loadPreloaded(mountPoint(value));
    expect(takePreloaded('/faq/')).toBeUndefined();
  });

  it('vervalt met clearPreloaded', () => {
    loadPreloaded(mountPoint(JSON.stringify({ '/faq/': 1 })));
    clearPreloaded();
    expect(takePreloaded('/faq/')).toBeUndefined();
  });
});

describe('client', () => {
  it('neemt bij een GET eerst het voorgeladen antwoord, daarna de server; schrijven gaat altijd naar de server', async () => {
    const fetch = vi.fn(async () => new Response('{"vers":true}', { status: 200 }));
    const preloaded = vi.fn((path: string) => (path === '/faq/' ? { value: { voorgeladen: true } } : undefined));
    const client = createApiClient({ fetch, navigate: () => undefined, preloaded });
    expect(await client.get('/faq/')).toEqual({ voorgeladen: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(await client.get('/menus/')).toEqual({ vers: true });
    await client.put('/faq/', {});
    expect(preloaded).toHaveBeenCalledTimes(2);
    await expect(client.get('/../geheim/')).rejects.toThrow('Ongeldig pad');
  });

  it('zonder functie voor voorgeladen antwoorden altijd naar de server', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await createApiClient({ fetch, navigate: () => undefined }).get('/faq/');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('mountModule', () => {
  it('leest de antwoorden bij het starten en laat ze vervallen na de eerste wissel', async () => {
    window.history.replaceState(null, '', '/app/proef/');
    mountPoint(JSON.stringify({ '/een/': 1, '/twee/': 2 }));
    const screen = defineComponent({ render: () => h('p', 'scherm') });
    const mounted = mountModule({ name: 'proef', routes: [{ path: '/', component: screen }, { path: '/:id/', component: screen }] });
    await mounted!.router.isReady();
    expect(takePreloaded('/een/')).toEqual({ value: 1 });
    await mounted!.router.push('/5/');
    expect(takePreloaded('/twee/')).toBeUndefined();
    mounted!.app.unmount();
  });
});
