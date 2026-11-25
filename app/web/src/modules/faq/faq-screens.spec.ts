/**
 * Tests van de schermen van de module Veelgestelde vragen: overzicht (volgorde, categorie toevoegen, meldingen),
 * vraag toevoegen en wijzigen (velden, fouten per veld, verwijderen) en categorie wijzigen (hernoemen, verwijderen
 * alleen leeg). De API is nagebootst; de echte routes en router in geheugen-modus.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { ApiError, createApiClient } from '../../api/client';
import { createFaqApi, moveId, readOrder, type FaqOverview } from './faq-api';
import { faqRoutes } from './routes';
import { setPageTitle } from '../../shell/page-title';

const fake = vi.hoisted(() => ({
  overview: vi.fn(), question: vi.fn(), createQuestion: vi.fn(), updateQuestion: vi.fn(), removeQuestion: vi.fn(),
  category: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), removeCategory: vi.fn(),
  orderCategories: vi.fn(), orderQuestions: vi.fn(),
}));

vi.mock('./faq-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./faq-api')>()), faqApi: fake }));

/** Overzicht met twee categorieën en een losse vraag. */
const OVERVIEW: FaqOverview = {
  categorieen: [
    { id: 1, naam: 'Reizen', volgorde: 10, vragen: [{ id: 11, vraag: 'Paspoort nodig?', volgorde: 10 }, { id: 12, vraag: 'Wat neem ik mee?', volgorde: 20 }] },
    { id: 2, naam: 'Betalen', volgorde: 20, vragen: [] },
  ],
  los: [{ id: 13, vraag: 'Oude vraag', volgorde: 0 }],
  grenzen: { categorieen: 50, vragen: 500, naam: 120, vraag: 300, antwoord: 20000 },
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
  const router = createRouter({ history: createMemoryHistory('/app/faq/'), routes: faqRoutes, strict: true });
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
  const heading = document.createElement('h1');
  heading.className = 'crm-title';
  document.body.appendChild(heading);
});

afterEach(() => document.body.replaceChildren());

describe('hulpfuncties', () => {
  it('verschuift een id omhoog of omlaag, niet voorbij de rand', () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, -1)).toBeNull();
    expect(moveId([1, 2, 3], 3, 1)).toBeNull();
    expect(moveId([1, 2, 3], 9, 1)).toBeNull();
  });

  it('leest een volgorde: leeg is geen volgorde', () => {
    expect(readOrder(' ')).toBeUndefined();
    expect(readOrder('-5')).toBe(-5);
    expect(readOrder(7)).toBe(7);
  });

  it('zet de titel in het tabblad en de kop', () => {
    setPageTitle('Proef');
    expect(document.title).toBe('Proef - Avanta CRM');
    expect(document.querySelector('h1')!.textContent).toBe('Proef');
  });

  it('roept de juiste paden van de API aan', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      fetch: async (url, init) => { calls.push(`${init?.method} ${String(url)} ${init?.body ?? ''}`); return new Response(init?.method === 'DELETE' ? null : '{}', { status: init?.method === 'DELETE' ? 204 : 200 }); },
      navigate: () => undefined,
    });
    const api = createFaqApi(client);
    await api.overview();
    await api.question(4);
    await api.createQuestion({ vraag: 'V', antwoord: '<p>A</p>', categorieId: 1 });
    await api.updateQuestion(4, { vraag: 'V', antwoord: '<p>A</p>', categorieId: 1 });
    await api.removeQuestion(4);
    await api.category(2);
    await api.createCategory({ naam: 'N' });
    await api.updateCategory(2, { naam: 'N' });
    await api.removeCategory(2);
    await api.orderCategories([2, 1]);
    await api.orderQuestions(2, [5, 4]);
    expect(calls).toEqual([
      'GET /app/api/faq/ ', 'GET /app/api/faq/vragen/4/ ',
      'POST /app/api/faq/vragen/ {"vraag":"V","antwoord":"<p>A</p>","categorieId":1}',
      'PUT /app/api/faq/vragen/4/ {"vraag":"V","antwoord":"<p>A</p>","categorieId":1}', 'DELETE /app/api/faq/vragen/4/ ',
      'GET /app/api/faq/categorieen/2/ ', 'POST /app/api/faq/categorieen/ {"naam":"N"}', 'PUT /app/api/faq/categorieen/2/ {"naam":"N"}',
      'DELETE /app/api/faq/categorieen/2/ ', 'PUT /app/api/faq/volgorde/ {"categorieen":[2,1]}', 'PUT /app/api/faq/categorieen/2/volgorde/ {"vragen":[5,4]}',
    ]);
  });
});

describe('overzicht', () => {
  it('toont de categorieën met hun vragen en de losse vragen', async () => {
    const { wrapper } = await open('/');
    expect(document.title).toBe('Veelgestelde vragen - Avanta CRM');
    expect(wrapper.findAll('section h2').map((heading) => heading.text())).toEqual(['Reizen', 'Betalen', 'Zonder categorie']);
    expect(wrapper.find('#categorie-1 tbody').text()).toContain('Paspoort nodig?');
    expect(wrapper.find('#categorie-2').text()).toContain('Nog geen vragen.');
    expect(wrapper.find('a[href="/app/faq/11/"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/app/faq/nieuw/?categorie=2"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/app/faq/categorieen/1/"]').exists()).toBe(true);
  });

  it('zonder categorieën: eerst een categorie maken', async () => {
    fake.overview.mockResolvedValue({ ...OVERVIEW, categorieen: [], los: [] });
    const { wrapper } = await open('/');
    expect(wrapper.text()).toContain('Maak eerst een categorie');
  });

  it('meldt een fout bij het laden', async () => {
    fake.overview.mockRejectedValue(new ApiError(503, 'onderhoud', 'Even geduld.'));
    const { wrapper } = await open('/');
    expect(wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
  });

  it('zet categorieën en vragen een plaats verder', async () => {
    fake.orderCategories.mockResolvedValue({ ok: true });
    fake.orderQuestions.mockResolvedValue({ ok: true });
    const { wrapper } = await open('/');
    const categoryButtons = wrapper.findAll('#categorie-1 > p.crm-actions button');
    expect(categoryButtons[0]!.attributes('disabled')).toBeDefined();
    await categoryButtons[1]!.trigger('click');
    await flushPromises();
    expect(fake.orderCategories).toHaveBeenCalledWith([2, 1]);
    expect(wrapper.find('[role="status"]').text()).toContain('De volgorde is opgeslagen.');
    await wrapper.find('button[aria-label="Wat neem ik mee?: omhoog"]').trigger('click');
    await flushPromises();
    expect(fake.orderQuestions).toHaveBeenCalledWith(1, [12, 11]);
    expect(fake.overview).toHaveBeenCalledTimes(3);
  });

  it('meldt een fout bij het verschuiven', async () => {
    fake.orderQuestions.mockRejectedValue(new ApiError(400, 'ongeldig', 'De lijst klopt niet meer. Laad de pagina opnieuw.'));
    const { wrapper } = await open('/');
    await wrapper.find('button[aria-label="Paspoort nodig?: omlaag"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('De lijst klopt niet meer.');
  });

  it('voegt een categorie toe, of toont de melding per veld', async () => {
    fake.createCategory.mockRejectedValueOnce(apiError(400, { naam: 'Deze categorie bestaat al.' })).mockResolvedValueOnce({ id: 3 });
    const { wrapper } = await open('/');
    const form = wrapper.find('details form');
    await form.find('input').setValue('Reizen');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('.field__error').text()).toBe('Deze categorie bestaat al.');
    await form.find('input').setValue('Kamperen');
    await form.findAll('input')[1]!.setValue('5');
    await form.trigger('submit');
    await flushPromises();
    expect(fake.createCategory).toHaveBeenLastCalledWith({ naam: 'Kamperen', volgorde: 5 });
    expect(wrapper.find('[role="status"]').text()).toContain('De categorie is toegevoegd.');
  });

  it('toont de melding uit het adres één keer', async () => {
    const { wrapper, router } = await open('/?melding=hernoemd');
    expect(wrapper.find('[role="status"]').text()).toContain('nieuwe naam');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
    await wrapper.find('.crm-message-box button').trigger('click');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});

describe('vraag', () => {
  it('voegt een vraag toe met de categorie uit het adres', async () => {
    fake.createQuestion.mockResolvedValue({ id: 20 });
    const { wrapper, router } = await open('/nieuw/?categorie=2');
    expect(document.title).toBe('Vraag toevoegen - Avanta CRM');
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('2');
    expect(wrapper.find('.crm-actions').exists()).toBe(false);
    await wrapper.find('input').setValue('Mag mijn hond mee?');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.createQuestion).toHaveBeenCalledWith({ vraag: 'Mag mijn hond mee?', antwoord: '', categorieId: 2, volgorde: 0 });
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('Opgeslagen.');
  });

  it('negeert een onbekende categorie uit het adres en toont de fouten per veld', async () => {
    fake.createQuestion.mockRejectedValue(apiError(400, { vraag: 'Vul een vraag in.', categorieId: 'Kies een categorie.' }));
    const { wrapper } = await open('/nieuw/?categorie=99');
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.createQuestion.mock.calls[0]![0].categorieId).toBe(0);
    expect(wrapper.findAll('.field__error').map((error) => error.text()).filter(Boolean)).toEqual(['Vul een vraag in.', 'Kies een categorie.']);
    expect(wrapper.find('select').attributes('aria-invalid')).toBe('true');
  });

  it('wijzigt een bestaande vraag', async () => {
    fake.question.mockResolvedValue({ id: 11, vraag: 'Paspoort nodig?', antwoord: '<p>Ja</p>', categorieId: 1, volgorde: 10, gewijzigd: '2026-11-25T08:00:00Z' });
    fake.updateQuestion.mockResolvedValue({ id: 11 });
    const { wrapper, router } = await open('/11/');
    expect(document.title).toBe('Vraag wijzigen - Avanta CRM');
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('Paspoort nodig?');
    await wrapper.findAll('input[type="number"]')[0]!.setValue('');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.updateQuestion).toHaveBeenCalledWith(11, { vraag: 'Paspoort nodig?', antwoord: '<p>Ja</p>', categorieId: 1, volgorde: undefined });
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('vraag zonder categorie (uit de import)', async () => {
    fake.question.mockResolvedValue({ id: 13, vraag: 'Oude vraag', antwoord: '<p>x</p>', categorieId: null, volgorde: 0, gewijzigd: '' });
    const { wrapper } = await open('/13/');
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('');
  });

  it('verwijdert na bevestigen', async () => {
    fake.question.mockResolvedValue({ id: 11, vraag: 'Paspoort nodig?', antwoord: '<p>Ja</p>', categorieId: 1, volgorde: 10, gewijzigd: '' });
    fake.removeQuestion.mockResolvedValue(undefined);
    const { wrapper, router } = await open('/11/');
    await wrapper.find('.crm-actions button').trigger('click');
    await flushPromises();
    expect(wrapper.find('dialog').attributes('open')).toBeDefined();
    await wrapper.find('dialog .btn--danger, dialog button:last-of-type').trigger('click');
    await flushPromises();
    expect(fake.removeQuestion).toHaveBeenCalledWith(11);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('De vraag is verwijderd.');
  });

  it('een vraag die niet (meer) bestaat', async () => {
    fake.question.mockRejectedValue(apiError(404));
    const { wrapper } = await open('/99/');
    expect(wrapper.text()).toContain('Deze vraag bestaat niet (meer).');
  });

  it('een vraag die tijdens het bewerken verdwijnt, en een fout bij het laden', async () => {
    fake.question.mockResolvedValue({ id: 11, vraag: 'V', antwoord: '<p>A</p>', categorieId: 1, volgorde: 0, gewijzigd: '' });
    fake.updateQuestion.mockRejectedValue(apiError(404));
    const { wrapper } = await open('/11/');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Deze vraag bestaat niet (meer).');
    fake.overview.mockRejectedValue(new ApiError(503, 'onderhoud', 'Even geduld.'));
    const second = await open('/nieuw/');
    expect(second.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
  });

  it('een onverwachte fout bij verwijderen', async () => {
    fake.question.mockResolvedValue({ id: 11, vraag: 'V', antwoord: '<p>A</p>', categorieId: 1, volgorde: 0, gewijzigd: '' });
    fake.removeQuestion.mockRejectedValue(new Error('kapot'));
    const { wrapper } = await open('/11/');
    await wrapper.find('.crm-actions button').trigger('click');
    await wrapper.find('dialog button:last-of-type').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Opslaan lukte niet.');
  });
});

describe('categorie', () => {
  it('hernoemt een categorie', async () => {
    fake.category.mockResolvedValue({ id: 1, naam: 'Reizen', volgorde: 10, aantalVragen: 2 });
    fake.updateCategory.mockResolvedValue({ id: 1, hernoemd: true });
    const { wrapper, router } = await open('/categorieen/1/');
    expect(document.title).toBe('Categorie: Reizen - Avanta CRM');
    expect(wrapper.text()).toContain('Deze categorie heeft 2 vragen.');
    await wrapper.find('input').setValue('Op reis');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.updateCategory).toHaveBeenCalledWith(1, { naam: 'Op reis', volgorde: 10 });
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('De categorie heeft een nieuwe naam.');
  });

  it('zelfde naam: gewoon opgeslagen; fout per veld', async () => {
    fake.category.mockResolvedValue({ id: 2, naam: 'Betalen', volgorde: 20, aantalVragen: 1 });
    fake.updateCategory.mockRejectedValueOnce(apiError(400, { naam: 'Deze categorie bestaat al.' })).mockResolvedValueOnce({ id: 2, hernoemd: false });
    const { wrapper, router } = await open('/categorieen/2/');
    expect(wrapper.text()).toContain('Deze categorie heeft 1 vraag.');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.field__error').text()).toBe('Deze categorie bestaat al.');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toContain('Opgeslagen.');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('verwijdert een lege categorie na bevestigen', async () => {
    fake.category.mockResolvedValue({ id: 2, naam: 'Betalen', volgorde: 20, aantalVragen: 0 });
    fake.removeCategory.mockResolvedValue(undefined);
    const { wrapper, router } = await open('/categorieen/2/');
    await wrapper.find('.crm-actions button').trigger('click');
    await wrapper.find('dialog button:last-of-type').trigger('click');
    await flushPromises();
    expect(fake.removeCategory).toHaveBeenCalledWith(2);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('De categorie is verwijderd.');
  });

  it('een fout bij verwijderen, een onbekende categorie en een fout bij laden', async () => {
    fake.category.mockResolvedValueOnce({ id: 2, naam: 'Betalen', volgorde: 20, aantalVragen: 0 });
    fake.removeCategory.mockRejectedValue(new ApiError(400, 'ongeldig', 'Er staan nog vragen in deze categorie.'));
    const { wrapper } = await open('/categorieen/2/');
    await wrapper.find('.crm-actions button').trigger('click');
    await wrapper.find('dialog button:last-of-type').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Er staan nog vragen');
    fake.category.mockRejectedValueOnce(apiError(404));
    expect((await open('/categorieen/9/')).wrapper.text()).toContain('Deze categorie bestaat niet (meer).');
    fake.category.mockRejectedValueOnce(new Error('kapot'));
    expect((await open('/categorieen/9/')).wrapper.find('[role="alert"]').text()).toContain('De categorie kon niet worden geladen.');
  });
});
