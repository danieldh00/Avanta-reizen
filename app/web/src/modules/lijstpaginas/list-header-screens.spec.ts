/**
 * Tests van de schermen van de module Lijstpagina's: overzicht (de koppen met foto en bron, laadfout), bewerken (velden,
 * opslaan met melding, fouten per veld, uitleg bij pagina's zonder inleiding) en de foto (kiezen, weghalen, fout, terug
 * naar de kop met melding). De API is nagebootst; de echte routes en router in geheugen-modus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { ApiError, createApiClient } from '../../api/client';
import { createListHeaderApi, type ListHeader, type ListHeaderOverview } from './list-header-api';
import { listHeaderRoutes } from './routes';

const fake = vi.hoisted(() => ({ overview: vi.fn(), header: vi.fn(), update: vi.fn(), setPhoto: vi.fn(), photos: vi.fn() }));

vi.mock('./list-header-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./list-header-api')>()), listHeaderApi: fake }));

/** De kop van de blogpagina. */
const BLOG: ListHeader = {
  sleutel: 'blog', naam: 'Blog', pad: '/blog/', pretitel: 'Verhalen', titel: 'Blog', inleiding: 'Lees mee.', foto: null,
  bron: 'standaard', bronNaam: 'Standaardtekst',
};

/** Overzicht met twee koppen. */
const OVERVIEW: ListHeaderOverview = {
  koppen: [
    { ...BLOG },
    { sleutel: 'reis', naam: 'Reizen', pad: '/reizen/', pretitel: '', titel: 'Alle reizen', inleiding: '', foto: '/media/kop-1600.webp', bron: 'crm', bronNaam: 'Gewijzigd in het CRM' },
  ],
  grenzen: { pretitel: 120, titel: 120, inleiding: 400 },
};

/**
 * Een fout van de API zoals de client hem geeft.
 * @param status HTTP-status.
 * @param fields Meldingen per veld.
 * @param message Melding.
 * @returns De fout.
 */
const apiError = (status: number, fields: Record<string, string> = {}, message = 'Controleer de gemarkeerde velden.') => new ApiError(status, 'ongeldig', message, { fields });

/**
 * Start de module op een pad, met een kop zoals de schil.
 * @param path Pad binnen de module.
 * @returns De wrapper en de router.
 */
async function open(path: string): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  const router = createRouter({ history: createMemoryHistory('/app/lijstpaginas/'), routes: listHeaderRoutes, strict: true });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  for (const mocked of Object.values(fake)) mocked.mockReset();
  fake.overview.mockResolvedValue(structuredClone(OVERVIEW));
  fake.header.mockImplementation(async (key: string) => structuredClone(OVERVIEW.koppen.find((item) => item.sleutel === key)));
  fake.photos.mockResolvedValue({ photos: [{ id: 7, url: '/media/fjord-400.webp', title: 'Fjord', alt: 'Een fjord', meta: '' }], hasMore: false });
  const heading = document.createElement('h1');
  heading.className = 'crm-title';
  document.body.appendChild(heading);
});

afterEach(() => document.body.replaceChildren());

describe('API', () => {
  it('roept de juiste paden aan', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      fetch: async (url, init) => { calls.push(`${init?.method} ${String(url)} ${init?.body ?? ''}`); return new Response('{}', { status: 200 }); },
      navigate: () => undefined,
    });
    const headers = createListHeaderApi(client);
    await headers.overview();
    await headers.header('faq');
    await headers.update('faq', { pretitel: '', titel: 'Vragen', inleiding: '' });
    await headers.setPhoto('faq', 7);
    await headers.photos('faq', { text: 'a..b', page: 2 });
    await headers.photos('faq', { text: '', page: 1 });
    expect(calls).toEqual([
      'GET /app/api/lijstpaginas/ ', 'GET /app/api/lijstpaginas/faq/ ', 'PUT /app/api/lijstpaginas/faq/ {"pretitel":"","titel":"Vragen","inleiding":""}',
      'PUT /app/api/lijstpaginas/faq/foto/ {"fotoId":7}', 'GET /app/api/lijstpaginas/faq/fotos/?pagina=2&zoek=a%2E%2Eb ', 'GET /app/api/lijstpaginas/faq/fotos/?pagina=1 ',
    ]);
  });
});

describe('overzicht', () => {
  it('toont de koppen met foto en bron, met een link naar het bewerkscherm', async () => {
    const { wrapper } = await open('/');
    expect(document.title).toContain('Lijstpagina\'s');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Nee');
    expect(rows[0]!.text()).toContain('Standaardtekst');
    expect(rows[1]!.text()).toContain('Ja');
    expect(wrapper.find('tbody a').attributes('href')).toBe('/app/lijstpaginas/blog/');
  });

  it('toont een laadfout', async () => {
    fake.overview.mockRejectedValueOnce(apiError(500, {}, 'Er ging iets mis.'));
    const { wrapper } = await open('/');
    expect(wrapper.find('[role="alert"]').text()).toContain('Er ging iets mis.');
    fake.overview.mockRejectedValueOnce(new Error('netwerk'));
    const second = await open('/');
    expect(second.wrapper.find('[role="alert"]').text()).toContain('Het overzicht kon niet worden geladen.');
  });
});

describe('bewerken', () => {
  it('vult de velden, slaat op en toont de melding', async () => {
    fake.update.mockImplementation(async (_key: string, input: { titel: string }) => ({ ...BLOG, titel: input.titel }));
    const { wrapper } = await open('/blog/');
    expect(document.title).toContain('Lijstpagina: Blog');
    expect(wrapper.find('a[href="/blog/"]').text()).toBe('Bekijk op de site');
    const inputs = wrapper.findAll('#kop input');
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('Verhalen');
    expect(inputs[1]!.attributes('maxlength')).toBe('120');
    expect(wrapper.find('#kop textarea').attributes('maxlength')).toBe('400');
    expect(wrapper.find('#kop').text()).not.toContain('toont geen inleiding');
    await inputs[1]!.setValue('Ons blog');
    await wrapper.find('#kop').trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenCalledWith('blog', { pretitel: 'Verhalen', titel: 'Ons blog', inleiding: 'Lees mee.' });
    expect(wrapper.find('.notice').text()).toContain('Opgeslagen.');
    await wrapper.find('.notice button').trigger('click');
    expect(wrapper.find('.notice').exists()).toBe(false);
    expect(wrapper.find('#foto').text()).toContain('Nog geen foto');
    expect(wrapper.find('#foto a').text()).toBe('Foto kiezen');
  });

  it('toont de meldingen per veld en een algemene fout', async () => {
    fake.update.mockRejectedValueOnce(apiError(400, { titel: 'Vul een titel in.' })).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/blog/');
    await wrapper.find('#kop').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.field__error').text()).toContain('Vul een titel in.');
    await wrapper.find('#kop').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#kop [role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('legt uit dat Reizen geen inleiding toont en toont de foto', async () => {
    const { wrapper } = await open('/reis/');
    expect(wrapper.find('#kop').text()).toContain('Deze pagina toont geen inleiding');
    expect(wrapper.find('#foto img').attributes('src')).toBe('/media/kop-1600.webp');
    expect(wrapper.find('#foto a').text()).toBe('Andere foto kiezen');
  });

  it('toont de melding uit het adres en haalt hem uit het adres', async () => {
    const { wrapper, router } = await open('/blog/?melding=foto');
    expect(wrapper.find('.notice').text()).toContain('De foto is opgeslagen.');
    expect(router.currentRoute.value.query.melding).toBeUndefined();
  });

  it('toont een laadfout', async () => {
    fake.header.mockRejectedValueOnce(apiError(500, {}, 'Er ging iets mis.'));
    const { wrapper } = await open('/blog/');
    expect(wrapper.find('[role="alert"]').text()).toContain('Er ging iets mis.');
    fake.header.mockRejectedValueOnce(new Error('netwerk'));
    const second = await open('/faq/');
    expect(second.wrapper.find('[role="alert"]').text()).toContain('De lijstpagina kon niet worden geladen.');
  });

  it('kent alleen de vaste sleutels', async () => {
    const router = createRouter({ history: createMemoryHistory('/app/lijstpaginas/'), routes: listHeaderRoutes, strict: true });
    expect(router.resolve('/onbekend/').matched).toHaveLength(0);
    expect(router.resolve('/aanmelden/foto/').name).toBe('lijstpaginas-foto');
  });
});

describe('foto', () => {
  it('kiest een foto en gaat terug naar de kop met een melding', async () => {
    fake.setPhoto.mockRejectedValueOnce(apiError(400, {}, 'Deze foto bestaat niet meer. Kies een andere.')).mockResolvedValueOnce({ ...BLOG, foto: '/media/fjord-1600.webp' });
    const { wrapper, router } = await open('/blog/foto/');
    expect(document.title).toContain('Foto: Blog');
    expect(fake.photos).toHaveBeenLastCalledWith('blog', { text: '', page: 1 });
    expect(wrapper.text()).toContain('Terug naar Blog');
    const buttons = wrapper.findAll('#foto .crm-actions button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.attributes('disabled')).toBeDefined();
    await wrapper.find('#foto input[type="radio"]').setValue(true);
    await buttons[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('#foto [role="alert"]').text()).toContain('Deze foto bestaat niet meer.');
    await wrapper.findAll('#foto .crm-actions button')[0]!.trigger('click');
    await flushPromises();
    expect(fake.setPhoto).toHaveBeenLastCalledWith('blog', 7);
    expect(router.currentRoute.value.path).toBe('/blog/');
    expect(wrapper.find('.notice').text()).toContain('De foto is opgeslagen.');
  });

  it('haalt de foto weg; een onbekende fout geeft een nette melding', async () => {
    fake.setPhoto.mockRejectedValueOnce(new Error('netwerk')).mockResolvedValueOnce({ ...OVERVIEW.koppen[1], foto: null });
    const { wrapper, router } = await open('/reis/foto/');
    const none = () => wrapper.findAll('#foto .crm-actions button')[1]!;
    await none().trigger('click');
    await flushPromises();
    expect(wrapper.find('#foto [role="alert"]').text()).toContain('Dat lukte niet.');
    await none().trigger('click');
    await flushPromises();
    expect(fake.setPhoto).toHaveBeenLastCalledWith('reis', null);
    expect(router.currentRoute.value.hash).toBe('#foto');
  });

  it('toont een laadfout', async () => {
    fake.header.mockRejectedValueOnce(apiError(500, {}, 'Er ging iets mis.'));
    const { wrapper } = await open('/blog/foto/');
    expect(wrapper.find('[role="alert"]').text()).toContain('Er ging iets mis.');
    expect(wrapper.text()).toContain('Terug naar de lijstpagina');
    fake.header.mockRejectedValueOnce(new Error('netwerk'));
    const second = await open('/faq/foto/');
    expect(second.wrapper.find('[role="alert"]').text()).toContain('De lijstpagina kon niet worden geladen.');
  });
});
