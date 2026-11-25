/**
 * Tests van de schermen van de module Beheer: het overzicht van de bouwstenen met zijn voorbeelden.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { beheerRoutes } from './routes';
import BouwstenenScreen from './bouwstenen-screen.vue';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) { this.removeAttribute('open'); });
});

afterEach(() => vi.useRealTimers());

describe('module Beheer', () => {
  it('heeft het overzicht van de bouwstenen op /bouwstenen/', () => {
    expect(beheerRoutes.map((route) => route.path)).toEqual(['/bouwstenen/']);
  });

  it('toont elke soort bouwsteen', () => {
    const wrapper = mount(BouwstenenScreen);
    expect(wrapper.findAll('section > h2, dialog h2').map((heading) => heading.text())).toEqual([
      'Lijst met filter, zoeken en bladeren', 'Formulier met tabbladen en opslaanbalk', 'Teksteditor, fotokiezer en uploaden', 'Meldingen en bevestigen', 'Voorbeeld verwijderen?',
    ]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.find('.crm-pager').exists()).toBe(true);
    expect(wrapper.find('.crm-savebar').exists()).toBe(true);
  });

  it('filtert, zoekt en bladert in de voorbeeldlijst', async () => {
    const wrapper = mount(BouwstenenScreen);
    await wrapper.findAll('.crm-tabs a')[2]!.trigger('click', { button: 0 });
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    await wrapper.findAll('.crm-tabs a')[0]!.trigger('click', { button: 0 });
    await wrapper.find('form.crm-search input').setValue('zweden');
    await wrapper.find('form.crm-search').trigger('submit');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    await wrapper.find('form.crm-search input').setValue('bestaat niet');
    await wrapper.find('form.crm-search').trigger('submit');
    expect(wrapper.find('.crm-empty').text()).toBe('Geen reizen gevonden.');
    await wrapper.find('.crm-pager button').trigger('click');
    expect(wrapper.find('.crm-pager-page').text()).toBe('Pagina 2');
  });

  it('slaat het voorbeeld op, of niet met een lege titel', async () => {
    vi.useFakeTimers();
    const wrapper = mount(BouwstenenScreen);
    const form = wrapper.findAll('form')[1]!;
    await wrapper.find('input[maxlength="120"]').setValue('');
    await form.trigger('submit');
    expect(wrapper.find('.field__error').text()).toBe('Vul een titel in.');
    expect(wrapper.find('.crm-tabs--edit a').classes()).toContain('crm-tabs-error');
    await wrapper.find('input[maxlength="120"]').setValue('Nieuwe titel');
    await form.trigger('submit');
    expect(wrapper.find('.crm-savebar button').attributes('disabled')).toBeDefined();
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(wrapper.text()).toContain('Opgeslagen (voorbeeld, er is niets bewaard).');
    await wrapper.find('.crm-message-box button').trigger('click');
    expect(wrapper.text()).not.toContain('Opgeslagen (voorbeeld');
    await wrapper.findAll('.crm-tabs--edit a')[1]!.trigger('click');
    expect(wrapper.find('textarea').isVisible()).toBe(true);
  });

  it('vraagt om bevestiging en meldt het verwijderen', async () => {
    const wrapper = mount(BouwstenenScreen, { attachTo: document.body });
    const open = wrapper.findAll('button').find((button) => button.text() === 'Voorbeeld verwijderen')!;
    await open.trigger('click');
    await flushPromises();
    expect(wrapper.find('dialog').attributes('open')).toBeDefined();
    await wrapper.find('dialog .btn--outline').trigger('click');
    await flushPromises();
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined();
    await open.trigger('click');
    await flushPromises();
    await wrapper.find('dialog .btn--danger').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Verwijderd (voorbeeld, er is niets weggehaald).');
    wrapper.unmount();
  });
});
