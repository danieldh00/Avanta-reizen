/**
 * Tests van de schermen van de module Menu's: overzicht (beide menu's, submenu ingesprongen, item toevoegen met de
 * melding per veld, verwijderen na bevestigen, meldingen) en wijzigen (velden, bovenliggend item alleen in het
 * hoofdmenu, fouten, verwijderen, onbekend id). De API is nagebootst; de echte routes en router in geheugen-modus.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { ApiError, createApiClient } from '../../api/client';
import { createMenuApi, type MenuOverview } from './menu-api';
import { menuInputOf } from './menu-form';
import { menuRoutes } from './routes';

const fake = vi.hoisted(() => ({ overview: vi.fn(), item: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));

vi.mock('./menu-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./menu-api')>()), menuApi: fake }));

/** Hoofdmenu met een submenu, lege voettekst. */
const OVERVIEW: MenuOverview = {
  menus: [
    { menu: 'hoofd', naam: 'Hoofdmenu', items: [
      { id: 1, menu: 'hoofd', ouderId: null, tekst: 'Reizen', adres: '/reis/', volgorde: 10 },
      { id: 2, menu: 'hoofd', ouderId: 1, tekst: 'Kamperen', adres: '/reis-categorie/kamperen/', volgorde: 10 },
      { id: 3, menu: 'hoofd', ouderId: null, tekst: 'Contact', adres: '/contact/', volgorde: 20 },
    ] },
    { menu: 'voet', naam: 'Menu in de voettekst', items: [] },
  ],
  suggesties: [{ pad: '/reis/', titel: '' }, { pad: '/over-ons/', titel: 'Over ons' }],
  grenzen: { tekst: 60, adres: 300, items: 40 },
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
  const router = createRouter({ history: createMemoryHistory('/app/menus/'), routes: menuRoutes, strict: true });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}

/**
 * Klikt de bevestigknop van het open venster.
 * @param wrapper Wrapper.
 */
async function confirm(wrapper: ReturnType<typeof mount>): Promise<void> {
  const buttons = wrapper.findAll('dialog button');
  await buttons[buttons.length - 1]!.trigger('click');
  await flushPromises();
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  for (const mocked of Object.values(fake)) mocked.mockReset();
  fake.overview.mockResolvedValue(structuredClone(OVERVIEW));
  fake.item.mockResolvedValue({ ...structuredClone(OVERVIEW.menus[0]!.items[0]!), aantalSubitems: 1 });
  const heading = document.createElement('h1');
  heading.className = 'crm-title';
  document.body.appendChild(heading);
});

afterEach(() => document.body.replaceChildren());

describe('API en formulier', () => {
  it('roept de juiste paden aan', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      fetch: async (url, init) => { calls.push(`${init?.method} ${String(url)} ${init?.body ?? ''}`); return new Response(init?.method === 'DELETE' ? null : '{}', { status: init?.method === 'DELETE' ? 204 : 200 }); },
      navigate: () => undefined,
    });
    const menus = createMenuApi(client);
    const input = { menu: 'voet', ouderId: null, tekst: 'T', adres: '/t/' };
    await menus.overview();
    await menus.item(4);
    await menus.create(input);
    await menus.update(4, input);
    await menus.remove(4);
    expect(calls).toEqual([
      'GET /app/api/menus/ ', 'GET /app/api/menus/4/ ', 'POST /app/api/menus/ {"menu":"voet","ouderId":null,"tekst":"T","adres":"/t/"}',
      'PUT /app/api/menus/4/ {"menu":"voet","ouderId":null,"tekst":"T","adres":"/t/"}', 'DELETE /app/api/menus/4/ ',
    ]);
  });

  it('een bovenliggend item telt alleen in het hoofdmenu', () => {
    expect(menuInputOf({ menu: 'hoofd', ouderId: '3', tekst: 'T', adres: ' /a/ ', volgorde: '' })).toEqual({ menu: 'hoofd', ouderId: 3, tekst: 'T', adres: '/a/', volgorde: undefined });
    expect(menuInputOf({ menu: 'voet', ouderId: '3', tekst: 'T', adres: '/a/', volgorde: '5' }).ouderId).toBeNull();
  });
});

describe('overzicht', () => {
  it('toont beide menu\'s, het submenu ingesprongen', async () => {
    const { wrapper } = await open('/');
    expect(document.title).toBe('Menu\'s - Avanta CRM');
    expect(wrapper.findAll('section h2').map((heading) => heading.text())).toEqual(['Hoofdmenu', 'Menu in de voettekst', 'Item toevoegen']);
    const rows = wrapper.findAll('#menu-hoofd tbody tr');
    expect(rows[1]!.text()).toContain('↳');
    expect(rows[0]!.text()).not.toContain('↳');
    expect(wrapper.find('a[href="/app/menus/2/"]').exists()).toBe(true);
    expect(wrapper.find('#menu-voet').text()).toContain('Dit menu is leeg');
    const parentOptions = wrapper.findAll('#nieuw select')[1]!.findAll('option').map((option) => option.text());
    expect(parentOptions).toEqual(['Geen (hoofditem)', 'Reizen', 'Contact']);
    expect(wrapper.findAll('#nieuw datalist option').map((option) => option.attributes('value'))).toEqual(['/reis/', '/over-ons/']);
  });

  it('meldt een fout bij het laden', async () => {
    fake.overview.mockRejectedValueOnce(new ApiError(503, 'onderhoud', 'Even geduld.')).mockRejectedValueOnce(new Error('weg'));
    let opened = await open('/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
    opened = await open('/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('konden niet worden geladen');
  });

  it('voegt een item toe, of toont de melding per veld', async () => {
    fake.create.mockRejectedValueOnce(apiError(400, { adres: 'Gebruik een adres op deze site (begint met /) of https://.' })).mockRejectedValueOnce(new Error('weg')).mockResolvedValueOnce({ id: 9 });
    const { wrapper } = await open('/');
    const form = wrapper.find('#nieuw form');
    const selects = form.findAll('select');
    await selects[1]!.setValue('1');
    const inputs = form.findAll('input');
    await inputs[0]!.setValue('Verre reizen');
    await inputs[1]!.setValue('javascript:alert(1)');
    await inputs[2]!.setValue('30');
    await form.trigger('submit');
    await flushPromises();
    expect(fake.create).toHaveBeenLastCalledWith({ menu: 'hoofd', ouderId: 1, tekst: 'Verre reizen', adres: 'javascript:alert(1)', volgorde: 30 });
    expect(form.find('.field__error').text()).toContain('Gebruik een adres op deze site');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('[role="alert"]').text()).toContain('Dat lukte niet.');
    await form.trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toContain('Het item staat in het menu.');
    expect((wrapper.find('#nieuw input').element as HTMLInputElement).value).toBe('');
  });

  it('verwijdert een item na bevestigen, of meldt de fout', async () => {
    fake.remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(404, 'niet-gevonden', 'Niet gevonden.')).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/');
    await wrapper.find('button[aria-label="Reizen: verwijderen"]').trigger('click');
    expect(wrapper.find('dialog').text()).toContain('\'Reizen\' verdwijnt uit het menu');
    await confirm(wrapper);
    expect(fake.remove).toHaveBeenCalledWith(1);
    expect(wrapper.find('[role="status"]').text()).toContain('verwijderd (met zijn submenu)');
    await wrapper.find('button[aria-label="Contact: verwijderen"]').trigger('click');
    await confirm(wrapper);
    expect(wrapper.find('[role="alert"]').text()).toContain('Niet gevonden.');
    await wrapper.find('button[aria-label="Contact: verwijderen"]').trigger('click');
    await confirm(wrapper);
    expect(wrapper.find('[role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('annuleren verwijdert niets', async () => {
    const { wrapper } = await open('/');
    await wrapper.find('button[aria-label="Reizen: verwijderen"]').trigger('click');
    await wrapper.findAll('dialog button')[0]!.trigger('click');
    await flushPromises();
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('sluit de melding; annuleren op het bewerkscherm verwijdert niets', async () => {
    const overview = await open('/?melding=nieuw');
    await overview.wrapper.find('.crm-message-box button').trigger('click');
    expect(overview.wrapper.find('[role="status"]').exists()).toBe(false);
    overview.wrapper.unmount();
    document.body.replaceChildren();
    const edit = await open('/1/');
    await edit.wrapper.find('.crm-savebar-actions button').trigger('click');
    await edit.wrapper.findAll('dialog button')[0]!.trigger('click');
    await flushPromises();
    expect(edit.wrapper.find('dialog').attributes('open')).toBeUndefined();
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('toont de melding uit het adres één keer', async () => {
    const { wrapper, router } = await open('/?melding=gewijzigd');
    expect(wrapper.find('[role="status"]').text()).toContain('Het item is gewijzigd.');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
  });
});

describe('wijzigen', () => {
  it('toont de velden; het item zelf staat niet bij de bovenliggende items', async () => {
    fake.update.mockResolvedValue({ id: 1 });
    const { wrapper, router } = await open('/1/');
    expect(document.title).toBe('Menu-item: Reizen - Avanta CRM');
    expect(wrapper.findAll('select')[1]!.findAll('option').map((option) => option.text())).toEqual(['Geen (hoofditem)', 'Contact']);
    await wrapper.findAll('input')[0]!.setValue('Alle reizen');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenCalledWith(1, { menu: 'hoofd', ouderId: null, tekst: 'Alle reizen', adres: '/reis/', volgorde: 10 });
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('Het item is gewijzigd.');
  });

  it('toont de fouten per veld en boven het formulier', async () => {
    fake.update.mockRejectedValueOnce(apiError(400, { menu: 'Dit item heeft een submenu en blijft in het hoofdmenu.' })).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/1/');
    await wrapper.findAll('select')[0]!.setValue('voet');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ menu: 'voet', ouderId: null }));
    expect(wrapper.find('.field__error').text()).toContain('blijft in het hoofdmenu');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('verwijdert na bevestigen, met het submenu in de vraag', async () => {
    fake.remove.mockResolvedValue(undefined);
    const { wrapper, router } = await open('/1/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    expect(wrapper.find('dialog').text()).toContain('met de 1 items van zijn submenu');
    await confirm(wrapper);
    expect(fake.remove).toHaveBeenCalledWith(1);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[role="status"]').text()).toContain('verwijderd');
  });

  it('zonder submenu een korte vraag; weg tijdens verwijderen', async () => {
    fake.item.mockResolvedValue({ ...OVERVIEW.menus[0]!.items[2]!, aantalSubitems: 0 });
    fake.remove.mockRejectedValue(apiError(404));
    const { wrapper } = await open('/3/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    expect(wrapper.find('dialog').text()).toContain('Het item verdwijnt uit het menu.');
    await confirm(wrapper);
    expect(wrapper.text()).toContain('bestaat niet (meer)');
  });

  it('onbekend id en een fout bij het laden', async () => {
    fake.item.mockRejectedValueOnce(apiError(404)).mockRejectedValueOnce(new ApiError(503, 'onderhoud', 'Even geduld.')).mockRejectedValueOnce(new Error('weg'));
    let opened = await open('/9/');
    expect(opened.wrapper.text()).toContain('bestaat niet (meer)');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('kon niet worden geladen');
  });
});
