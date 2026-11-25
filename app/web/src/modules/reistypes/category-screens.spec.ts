/**
 * Tests van de schermen van de module Reistypes en landen: overzicht (tabbladen per soort met aantallen, zoeken in een
 * lange lijst, kolommen per soort, icoon, nieuw aanmaken) en één reistype of land (velden opslaan, nieuw adres,
 * fouten, verwijderen alleen als er niets aan hangt, samenvoegen, foto kiezen of weghalen, foto's van alle landen,
 * onbekend id). De API is nagebootst; de echte routes en router in geheugen-modus.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { ApiError, createApiClient } from '../../api/client';
import { createCategoryApi, type CategoryDetails, type CategoryOverview } from './category-api';
import { categoryInputOf, emptyCategoryForm } from './category-form';
import { categoryRoutes } from './routes';

const fake = vi.hoisted(() => ({
  overview: vi.fn(), category: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), setPhoto: vi.fn(), photos: vi.fn(), merge: vi.fn(),
}));

vi.mock('./category-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./category-api')>()), categoryApi: fake }));

/** Een land in de lijst. */
const country = (id: number, naam: string, code: string | null) => ({
  id, naam, adres: naam.toLowerCase(), soort: 'bestemming' as const, icoon: null, code, volgorde: 0, homepage: false, reizen: 0, komend: 0, fotos: 0,
});

/** Overzicht met een reistype, drie landen en geen overige. */
const OVERVIEW: CategoryOverview = {
  soorten: [{ soort: 'type', naam: 'Reistype', meervoud: 'Reistypes' }, { soort: 'bestemming', naam: 'Land', meervoud: 'Landen' }, { soort: 'overig', naam: 'Overig', meervoud: 'Overige categorieën' }],
  items: [
    { id: 1, naam: 'Kamperen', adres: 'kamperen', soort: 'type', icoon: 'tent', code: null, volgorde: 10, homepage: true, reizen: 4, komend: 2, fotos: 0 },
    country(2, 'Noorwegen', 'NO'), country(3, 'Nederland', 'NL'), { ...country(4, 'Zweden', null), reizen: 1, komend: 1 },
  ],
  iconen: { tent: [{ d: 'M2 20L12 4l10 16z' }, { circle: [12, 12, 2], fill: true }, { rect: [1, 1, 2, 2] }] },
  grenzen: { naam: 120, inleiding: 2000, tekst: 100000 },
};

/** Een land om te bewerken. */
const NORWAY: CategoryDetails = {
  id: 2, naam: 'Noorwegen', adres: 'noorwegen', pad: '/reis-categorie/noorwegen/', soort: 'bestemming', icoon: '', code: 'NO',
  inleiding: 'Fjorden', tekst: '<p>Mooi</p>', volgorde: 0, homepage: false, foto: null, reizen: 0, fotos: 0, gewijzigd: '2026-11-25T08:00:00Z',
  samenvoegenMet: [{ id: 4, naam: 'Zweden', adres: 'zweden' }],
};

/**
 * Een fout van de API zoals de client hem geeft.
 * @param status HTTP-status.
 * @param fields Meldingen per veld.
 * @param message Melding.
 * @returns De fout.
 */
const apiError = (status: number, fields: Record<string, string> = {}, message = status === 404 ? 'Niet gevonden.' : 'Controleer de gemarkeerde velden.') => new ApiError(status, status === 404 ? 'niet-gevonden' : 'ongeldig', message, { fields });

/**
 * Start de module op een pad, met een kop zoals de schil.
 * @param path Pad binnen de module.
 * @returns De wrapper en de router.
 */
async function open(path: string): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  const router = createRouter({ history: createMemoryHistory('/app/reistypes-en-landen/'), routes: categoryRoutes, strict: true });
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
  const buttons = wrapper.findAll('dialog[open] button');
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
  fake.category.mockResolvedValue(structuredClone(NORWAY));
  fake.photos.mockResolvedValue({ photos: [{ id: 7, url: '/media/fjord-400.webp', title: 'Fjord', alt: 'Een fjord', meta: 'Noorwegen' }], hasMore: false });
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
    const categories = createCategoryApi(client);
    await categories.overview();
    await categories.category(2);
    await categories.create({ naam: 'N', soort: 'type' });
    await categories.update(2, { naam: 'N', soort: 'type' });
    await categories.remove(2);
    await categories.setPhoto(2, 7);
    await categories.photos(2, { text: 'a..b', page: 2, all: true });
    await categories.photos(2, { text: '', page: 1, all: false });
    await categories.merge(2, 4);
    expect(calls).toEqual([
      'GET /app/api/reistypes-en-landen/ ', 'GET /app/api/reistypes-en-landen/2/ ',
      'POST /app/api/reistypes-en-landen/ {"naam":"N","soort":"type"}', 'PUT /app/api/reistypes-en-landen/2/ {"naam":"N","soort":"type"}',
      'DELETE /app/api/reistypes-en-landen/2/ ', 'PUT /app/api/reistypes-en-landen/2/foto/ {"fotoId":7}',
      'GET /app/api/reistypes-en-landen/2/fotos/?pagina=2&zoek=a%2E%2Eb&alle=1 ', 'GET /app/api/reistypes-en-landen/2/fotos/?pagina=1 ',
      'POST /app/api/reistypes-en-landen/2/samenvoegen/ {"doelId":4}',
    ]);
  });

  it('zet de velden om naar de invoer', () => {
    expect(categoryInputOf({ ...emptyCategoryForm(), naam: 'X', adres: ' x ', volgorde: '3', homepage: true })).toEqual({
      naam: 'X', adres: 'x', soort: 'bestemming', icoon: '', inleiding: '', tekst: '', volgorde: 3, homepage: true,
    });
  });
});

describe('overzicht', () => {
  it('toont de reistypes met icoon en de aantallen per soort', async () => {
    const { wrapper } = await open('/');
    expect(document.title).toBe('Reistypes en landen - Avanta CRM');
    expect(wrapper.findAll('.crm-tabs a').map((tab) => tab.text())).toEqual(['Reistypes 1', 'Landen 3', 'Overige categorieën 0']);
    expect(wrapper.find('.crm-tabs a[aria-current="true"]').text()).toContain('Reistypes');
    expect(wrapper.find('thead').text()).toContain('Icoon');
    expect(wrapper.find('thead').text()).not.toContain('Code');
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('Kamperen');
    expect(row.text()).toContain('4 (2)');
    expect(row.text()).toContain('ja');
    expect(row.findAll('svg path, svg circle, svg rect')).toHaveLength(3);
    expect(row.find('circle').classes()).toContain('icon__fill');
  });

  it('wisselt van soort, zoekt op naam of code en zet beide in het adres', async () => {
    const { wrapper, router } = await open('/');
    await wrapper.findAll('.crm-tabs a')[1]!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ soort: 'bestemming' });
    expect(wrapper.find('thead').text()).toContain('Code');
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.findAll('tbody tr')[2]!.text()).toContain('–');
    await wrapper.find('.crm-search input').setValue('nl');
    await wrapper.find('.crm-search').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ soort: 'bestemming', q: 'nl' });
    expect(wrapper.findAll('tbody tr').map((tr) => tr.find('a').text())).toEqual(['Nederland']);
    expect(wrapper.find('p[role="status"]').text()).toBe('1 categorie gevonden voor \'nl\'');
    await wrapper.find('.crm-search input').setValue('xyz');
    await wrapper.find('.crm-search').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Niets gevonden.');
    await wrapper.findAll('.crm-tabs a')[2]!.trigger('click');
    await wrapper.find('.crm-search input').setValue('');
    await wrapper.find('.crm-search').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Nog niets in deze soort.');
    expect(wrapper.find('p[role="status"]').text()).toBe('0 categorieën');
  });

  it('opent met soort en zoekterm uit het adres', async () => {
    const { wrapper } = await open('/?soort=bestemming&q=zwe');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.find('tbody').text()).toContain('1 (1)');
    const other = await open('/?soort=onzin');
    expect(other.wrapper.find('.crm-tabs a[aria-current="true"]').text()).toContain('Reistypes');
  });

  it('meldt een fout bij het laden', async () => {
    fake.overview.mockRejectedValueOnce(new ApiError(503, 'onderhoud', 'Even geduld.')).mockRejectedValueOnce(new Error('weg'));
    let opened = await open('/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
    opened = await open('/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('kon niet worden geladen');
  });

  it('maakt een nieuwe en opent die, of toont de melding per veld', async () => {
    fake.create.mockRejectedValueOnce(apiError(400, { adres: 'Deze slug is al in gebruik.' })).mockRejectedValueOnce(new Error('weg')).mockResolvedValueOnce({ id: 2 });
    const { wrapper, router } = await open('/');
    const details = wrapper.find('details');
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger('toggle');
    const form = details.find('form');
    await form.find('input').setValue('Noorwegen');
    await form.find('input[type="checkbox"]').setValue(true);
    await form.trigger('submit');
    await flushPromises();
    expect(fake.create).toHaveBeenLastCalledWith(expect.objectContaining({ naam: 'Noorwegen', soort: 'bestemming', homepage: true }));
    expect(form.find('.field__error').text()).toBe('Deze slug is al in gebruik.');
    await form.trigger('submit');
    await flushPromises();
    expect(form.find('[role="alert"]').text()).toContain('Dat lukte niet.');
    await form.trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/2/');
    expect(wrapper.find('[role="status"]').text()).toContain('Opgeslagen.');
  });

  it('toont de melding na verwijderen één keer en kan hem sluiten', async () => {
    const { wrapper, router } = await open('/?melding=weg&soort=bestemming');
    expect(wrapper.find('.notice').text()).toContain('Verwijderd.');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ soort: 'bestemming' });
    await wrapper.find('.crm-message-box button').trigger('click');
    expect(wrapper.find('.notice').exists()).toBe(false);
  });
});

describe('één reistype of land', () => {
  it('toont de velden, het gebruik en slaat op', async () => {
    fake.update.mockResolvedValueOnce({ id: 2, verplaatst: true }).mockResolvedValueOnce({ id: 2, verplaatst: false });
    const { wrapper } = await open('/2/');
    expect(document.title).toBe('Noorwegen - Avanta CRM');
    expect(wrapper.find('a[href="/reis-categorie/noorwegen/"]').exists()).toBe(true);
    expect(wrapper.find('.crm-facts').text()).toContain('Landcode (ISO)');
    expect(wrapper.find('.crm-facts').text()).toContain('Land');
    await wrapper.find('form input').setValue('Noorwegen en Lofoten');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenLastCalledWith(2, expect.objectContaining({ naam: 'Noorwegen en Lofoten', inleiding: 'Fjorden', tekst: '<p>Mooi</p>' }));
    expect(wrapper.find('.notice').text()).toContain('verwijst automatisch door');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.notice').text()).toContain('Opgeslagen.');
    expect(fake.category).toHaveBeenCalledTimes(3);
  });

  it('stuurt alle velden mee en sluit de melding', async () => {
    fake.update.mockResolvedValue({ id: 2, verplaatst: false });
    const { wrapper } = await open('/2/');
    const form = wrapper.find('form');
    const selects = form.findAll('select');
    await selects[0]!.setValue('type');
    await selects[1]!.setValue('tent');
    await form.find('textarea').setValue('Kort');
    await form.find('input[type="number"]').setValue('7');
    const editor = wrapper.findComponent({ name: 'RichTextEditor' });
    editor.vm.$emit('update:modelValue', '<p>Nieuw</p>');
    await form.trigger('submit');
    await flushPromises();
    expect(fake.update).toHaveBeenLastCalledWith(2, expect.objectContaining({ soort: 'type', icoon: 'tent', inleiding: 'Kort', volgorde: 7, tekst: '<p>Nieuw</p>' }));
    await wrapper.find('.crm-message-box button').trigger('click');
    expect(wrapper.find('.notice').exists()).toBe(false);
  });

  it('toont de fouten per veld en boven het formulier', async () => {
    fake.update.mockRejectedValueOnce(apiError(400, { soort: 'Er hangen foto\'s aan dit land.' })).mockRejectedValueOnce(new Error('weg'));
    const { wrapper } = await open('/2/');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.field__error').text()).toContain('Er hangen foto\'s aan dit land.');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('form [role="alert"]').text()).toContain('Dat lukte niet.');
  });

  it('verwijdert na bevestigen als er niets aan hangt', async () => {
    fake.remove.mockRejectedValueOnce(apiError(400, {}, 'Er hangen reizen of foto\'s aan.')).mockResolvedValueOnce(undefined);
    const { wrapper, router } = await open('/2/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    await confirm(wrapper);
    expect(wrapper.find('form [role="alert"]').text()).toContain('Er hangen reizen of foto\'s aan.');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    await confirm(wrapper);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('.notice').text()).toContain('Verwijderd.');
  });

  it('met reizen of foto\'s alleen de uitleg in plaats van Verwijderen; foto\'s van een land als link', async () => {
    fake.category.mockResolvedValue({ ...structuredClone(NORWAY), reizen: 2, fotos: 3 });
    const { wrapper } = await open('/2/');
    expect(wrapper.find('.crm-savebar-actions button').exists()).toBe(false);
    expect(wrapper.find('.crm-savebar-actions').text()).toContain('voeg een dubbeling samen');
    expect(wrapper.find('a[href="/app/fotobibliotheek/?land=2"]').text()).toBe('3');
  });

  it('voegt samen na bevestigen en opent de categorie die blijft', async () => {
    fake.merge.mockRejectedValueOnce(apiError(400, { doelId: 'x' }, 'De gekozen categorie bestaat niet meer.')).mockResolvedValueOnce({ doelId: 4 });
    const { wrapper, router } = await open('/2/');
    const mergeForm = wrapper.findAll('form')[1]!;
    await mergeForm.trigger('submit');
    expect(mergeForm.find('.field__error').text()).toBe('Kies met welke categorie je wilt samenvoegen.');
    await mergeForm.find('select').setValue('4');
    await mergeForm.trigger('submit');
    expect(wrapper.find('dialog[open]').text()).toContain('gaan naar Zweden');
    await confirm(wrapper);
    expect(mergeForm.find('.field__error').text()).toBe('De gekozen categorie bestaat niet meer.');
    fake.category.mockResolvedValue({ ...structuredClone(NORWAY), id: 4, naam: 'Zweden', adres: 'zweden', samenvoegenMet: [] });
    await mergeForm.trigger('submit');
    await confirm(wrapper);
    expect(fake.merge).toHaveBeenLastCalledWith(2, 4);
    expect(router.currentRoute.value.path).toBe('/4/');
    expect(document.title).toBe('Zweden - Avanta CRM');
    expect(wrapper.find('.notice').text()).toContain('Samengevoegd.');
  });

  it('annuleren van samenvoegen en verwijderen doet niets', async () => {
    const { wrapper } = await open('/2/');
    await wrapper.find('.crm-savebar-actions button').trigger('click');
    await wrapper.findAll('dialog[open] button')[0]!.trigger('click');
    const mergeForm = wrapper.findAll('form')[1]!;
    await mergeForm.find('select').setValue('4');
    await mergeForm.trigger('submit');
    await wrapper.findAll('dialog[open] button')[0]!.trigger('click');
    await flushPromises();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.merge).not.toHaveBeenCalled();
  });

  it('kiest een foto, haalt hem weg en toont alle landen', async () => {
    fake.setPhoto.mockResolvedValueOnce({ foto: '/media/fjord-1600.webp' }).mockRejectedValueOnce(apiError(400, {}, 'Deze foto bestaat niet meer. Kies een andere.')).mockResolvedValueOnce({ foto: null });
    const { wrapper } = await open('/2/');
    expect(fake.photos).toHaveBeenLastCalledWith(2, { text: '', page: 1, all: false });
    expect(wrapper.find('#foto').text()).toContain('Nog geen foto gekozen.');
    const use = () => wrapper.findAll('#foto .crm-actions button')[0]!;
    expect(use().attributes('disabled')).toBeDefined();
    await wrapper.find('#foto input[type="radio"]').setValue(true);
    await use().trigger('click');
    await flushPromises();
    expect(fake.setPhoto).toHaveBeenLastCalledWith(2, 7);
    expect(wrapper.find('#foto img.media-preview').attributes('src')).toBe('/media/fjord-1600.webp');
    expect(wrapper.find('.notice').text()).toContain('De foto is opgeslagen.');
    const none = wrapper.findAll('#foto .crm-actions button')[1]!;
    await none.trigger('click');
    await flushPromises();
    expect(wrapper.find('#foto [role="alert"]').text()).toContain('Deze foto bestaat niet meer.');
    await none.trigger('click');
    await flushPromises();
    expect(fake.setPhoto).toHaveBeenLastCalledWith(2, null);
    expect(wrapper.find('#foto').text()).toContain('Nog geen foto gekozen.');
    await wrapper.find('#foto .field--checkbox input').setValue(true);
    await flushPromises();
    expect(fake.photos).toHaveBeenLastCalledWith(2, { text: '', page: 1, all: true });
  });

  it('een reistype heeft geen keuze voor alle landen', async () => {
    fake.category.mockResolvedValue({ ...structuredClone(NORWAY), soort: 'type', code: null, foto: '/media/tent.webp' });
    const { wrapper } = await open('/2/');
    expect(wrapper.find('#foto .field--checkbox').exists()).toBe(false);
    expect(wrapper.find('.crm-facts').text()).not.toContain('Landcode');
    expect(wrapper.find('#foto img.media-preview').exists()).toBe(true);
  });

  it('weg tijdens een actie, onbekend id en een fout bij het laden', async () => {
    fake.update.mockRejectedValue(apiError(404));
    let opened = await open('/2/');
    await opened.wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(opened.wrapper.text()).toContain('bestaat niet (meer)');
    fake.category.mockRejectedValueOnce(apiError(404)).mockRejectedValueOnce(new ApiError(503, 'onderhoud', 'Even geduld.')).mockRejectedValueOnce(new Error('weg'));
    opened = await open('/9/');
    expect(opened.wrapper.text()).toContain('bestaat niet (meer)');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('Even geduld.');
    opened = await open('/9/');
    expect(opened.wrapper.find('[role="alert"]').text()).toContain('kon niet worden geladen');
  });
});
