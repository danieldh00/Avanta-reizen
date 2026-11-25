/**
 * Tests van de schermen van de module Categorieën en tags: overzicht (per soort de lijst, toevoegen met de melding per
 * veld, meldingen uit het adres) en wijzigen (velden, nieuw adres, fouten, verwijderen na bevestigen, onbekend id). De
 * API is nagebootst; de echte routes en router in geheugen-modus.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { ApiError, createApiClient } from '../../api/client';
import { createTermApi, type TermDetails, type TermOverview } from './term-api';
import { termRoutes } from './routes';

const fake = vi.hoisted(() => ({ overview: vi.fn(), term: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));

vi.mock('./term-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./term-api')>()), termApi: fake }));

/** Overzicht met een categorie en geen tags. */
const OVERVIEW: TermOverview = {
  soorten: [
    { soort: 'categorie', naam: 'Categorie', meervoud: 'Categorieën', voorvoegsel: '/category/', items: [{ id: 1, naam: 'Reisverslagen', adres: 'reisverslagen', berichten: 3, volgorde: 10 }] },
    { soort: 'tag', naam: 'Tag', meervoud: 'Tags', voorvoegsel: '/tag/', items: [] },
  ],
  grenzen: { naam: 100, inleiding: 1000, adres: 80, aantal: 200 },
};

/** Eén categorie om te bewerken. */
const TERM: TermDetails = {
  id: 1, soort: 'categorie', soortNaam: 'Categorie', voorvoegsel: '/category/', naam: 'Reisverslagen', adres: 'reisverslagen',
  inleiding: 'Verhalen', volgorde: 10, gewijzigd: '2026-11-25T08:00:00Z',
};

/**
 * Een fout van de API zoals de client hem geeft.
 * @param status HTTP-status.
 * @param fields Meldingen per veld.
 * @returns De fout.
 */
const apiError = (status: number, fields: Record<string, string> = {}) => new ApiError(status, status === 404 ? 'niet-gevonden' : 'ongeldig', status === 404 ? 'Niet gevonden.' : 'Controleer de gemarkeerde velden.', { fields });

/**
 * Start de module op een pad, met een kop zoals de schil.
 * @param path Pad binnen de module.
 * @returns De wrapper en de router.
 */
async function open(path: string): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  const router = createRouter({ history: createMemoryHistory('/app/blog/categorieen-en-tags/'), routes: termRoutes, strict: true });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  for (const mocked of Object.values(fake)) mocked.mockReset();
  fake.overview.mockResolvedValue(structuredClone(OVERVIEW));
  fake.term.mockResolvedValue(structuredClone(TERM));
  const heading = document.createElement('h1');
  heading.className = 'crm-title';
  document.body.appendChild(heading);
});

afterEach(() => document.body.replaceChildren());

describe('API', () => {
  it('roept de juiste paden aan', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      fetch: async (url, init) => { calls.push(`${init?.method} ${String(url)} ${init?.body ?? ''}`); return new Response(init?.method === 'DELETE' ? null : '{}', { status: init?.method === 'DELETE' ? 204 : 200 }); },
      navigate: () => undefined,
    });
    const terms = createTermApi(client);
    await terms.overview();
    await terms.term(4);
    await terms.create({ soort: 'tag', naam: 'N' });
    await terms.update(4, { naam: 'N' });
    await terms.remove(4);
    expect(calls).toEqual([
      'GET /app/api/blog-indeling/ ', 'GET /app/api/blog-indeling/4/ ', 'POST /app/api/blog-indeling/ {"soort":"tag","naam":"N"}',
      'PUT /app/api/blog-indeling/4/ {"naam":"N"}', 'DELETE /app/api/blog-indeling/4/ ',
    ]);
  });
});

describe('overzicht', () => {
  it('toont per soort de lijst met adres en aantal berichten', async () => {
    const { wrapper } = await open('/');
    expect(document.title).toBe('Categorieën en tags - Avanta CRM');
    expect(wrapper.findAll('section h2').map((heading) => heading.text())).toEqual(['Categorieën', 'Tags']);
    expect(wrapper.find('#categorie tbody').text()).toContain('/category/reisverslagen/');
    expect(wrapper.find('a[href="/app/blog/categorieen-en-tags/1/"]').exists()).toBe(true);
    expect(wrapper.find('#tag').text()).toContain('Nog geen tags.');
    expect(wrapper.find('#tag summary').text()).toBe('Tag toevoegen');
  });

  it('meldt een fout bij het laden', async () => {
    fake.overview.mockRejectedValue(new ApiError(503, 'onderhoud', 'Even geduld.'));
    const { wrapper } = await open('/');
    expect(wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
  });

  it('voegt een tag toe, of toont de melding per veld', async () => {
    fake.create.mockRejectedValueOnce(apiError(400, { adres: 'Dit adres bestaat al.' })).mockResolvedValueOnce({ id: 3 });
    const { wrapper } = await open('/');
    const form = wrapper.find('#tag form');
    const inputs = form.findAll('input');
    await inputs[0]!.setValue('Noorwegen');
    await inputs[1]!.setValue('noorwegen');
    await form.find('textarea').setValue('Alles over Noorwegen');
    await inputs[2]!.setValue('5');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('.field__error').text()).toBe('Dit adres bestaat al.');
    expect(fake.create).toHaveBeenLastCalledWith({ soort: 'tag', naam: 'Noorwegen', adres: 'noorwegen', inleiding: 'Alles over Noorwegen', volgorde: 5 });
    await form.trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toContain('Opgeslagen.');
    expect((wrapper.find('#tag form input').element as HTMLInputElement).value).toBe('');
    expect(fake.overview).toHaveBeenCalledTimes(2);
  });

  it('toont een algemene fout bij toevoegen zonder velden', async () => {
    fake.create.mockRejectedValueOnce(new ApiError(429, 'te-veel', 'Te veel verzoeken.')).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/');
    const form = wrapper.find('#categorie form');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('[role="alert"]').text()).toContain('Te veel verzoeken.');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('[role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('toont de melding uit het adres één keer', async () => {
    const { wrapper, router } = await open('/?melding=verplaatst');
    expect(wrapper.find('[role="status"]').text()).toContain('verwijst automatisch door');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
  });
});

describe('bediening', () => {
  it('sluit de melding, opent het formulier en annuleert verwijderen', async () => {
    const overview = await open('/?melding=opgeslagen');
    await overview.wrapper.find('.crm-message-box button').trigger('click');
    expect(overview.wrapper.find('[role="status"]').exists()).toBe(false);
    const details = overview.wrapper.find('#tag details');
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger('toggle');
    expect((details.element as HTMLDetailsElement).open).toBe(true);
    overview.wrapper.unmount();
    document.body.replaceChildren();
    const edit = await open('/1/');
    const inputs = edit.wrapper.findAll('input');
    await inputs[0]!.setValue('Verslagen');
    await edit.wrapper.find('textarea').setValue('Nieuw');
    await inputs[2]!.setValue('');
    await edit.wrapper.find('.crm-savebar-actions button').trigger('click');
    await edit.wrapper.findAll('dialog button')[0]!.trigger('click');
    await flushPromises();
    expect(edit.wrapper.find('dialog').attributes('open')).toBeUndefined();
    fake.update.mockResolvedValue({ id: 1, verplaatst: false });
    await edit.wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.update).toHaveBeenCalledWith(1, { naam: 'Verslagen', adres: 'reisverslagen', inleiding: 'Nieuw', volgorde: undefined });
  });
});

describe('wijzigen', () => {
  it('toont de velden en slaat op met een nieuw adres', async () => {
    fake.update.mockResolvedValue({ id: 1, verplaatst: true });
    const { wrapper, router } = await open('/1/');
    expect(document.title).toBe('Categorie: Reisverslagen - Avanta CRM');
    expect(wrapper.find('a[href="/category/reisverslagen/"]').exists()).toBe(true);
    const inputs = wrapper.findAll('input');
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('Reisverslagen');
    await inputs[1]!.setValue('verslagen');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenCalledWith(1, { naam: 'Reisverslagen', adres: 'verslagen', inleiding: 'Verhalen', volgorde: 10 });
    expect(router.currentRoute.value.fullPath).toBe('/#categorie');
    expect(wrapper.find('[role="status"]').text()).toContain('verwijst automatisch door');
  });

  it('slaat op zonder nieuw adres', async () => {
    fake.update.mockResolvedValue({ id: 1, verplaatst: false });
    const { wrapper, router } = await open('/1/');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('Opgeslagen.');
  });

  it('toont de fouten per veld en boven het formulier', async () => {
    fake.update.mockRejectedValueOnce(apiError(400, { adres: 'Dit adres bestaat al.' })).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/1/');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.field__error').text()).toBe('Dit adres bestaat al.');
    expect(wrapper.find('[role="alert"]').text()).toContain('Controleer de gemarkeerde velden.');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('verwijdert na bevestigen', async () => {
    fake.remove.mockResolvedValue(undefined);
    const { wrapper, router } = await open('/1/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    expect(wrapper.find('dialog').attributes('open')).toBeDefined();
    const buttons = wrapper.findAll('dialog button');
    await buttons[buttons.length - 1]!.trigger('click');
    await flushPromises();
    expect(fake.remove).toHaveBeenCalledWith(1);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('Verwijderd.');
  });

  it('toont dat iets weg is als het al verwijderd is', async () => {
    fake.remove.mockRejectedValue(apiError(404));
    const { wrapper } = await open('/1/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    const buttons = wrapper.findAll('dialog button');
    await buttons[buttons.length - 1]!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('bestaat niet (meer)');
  });

  it('onbekend id en een fout bij het laden', async () => {
    fake.term.mockRejectedValueOnce(apiError(404)).mockRejectedValueOnce(new ApiError(503, 'onderhoud', 'Even geduld.')).mockRejectedValueOnce(new Error('weg'));
    let opened = await open('/9/');
    expect(opened.wrapper.text()).toContain('bestaat niet (meer)');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('kon niet worden geladen');
  });
});
