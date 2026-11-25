/**
 * Tests van de bouwstenen voor formulieren: tabbladen, opslaanbalk, veld met label en tekstveld.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TabPanels from './tab-panels.vue';
import SaveBar from './save-bar.vue';
import FormField from './form-field.vue';
import TextField from './text-field.vue';

describe('tab-panels', () => {
  const tabs = [{ key: 'gegevens', label: 'Gegevens' }, { key: 'fotos', label: "Foto's", count: 4, error: true }, { key: 'Fout!', label: 'Ongeldig' }];

  it('toont één paneel, markeert het tabblad en laat ongeldige sleutels weg', () => {
    const wrapper = mount(TabPanels, { props: { tabs }, slots: { 'tab-gegevens': 'Paneel 1', 'tab-fotos': 'Paneel 2' } });
    const links = wrapper.findAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]!.attributes('aria-current')).toBe('true');
    const panels = wrapper.findAll('.crm-tabpanel');
    expect(panels[0]!.attributes('hidden')).toBeUndefined();
    expect(panels[1]!.attributes('hidden')).toBeDefined();
    expect(links[1]!.classes()).toContain('crm-tabs-error');
    expect(links[1]!.text()).toContain('(bevat een fout)');
    expect(links[1]!.find('.crm-tabs-count').text()).toBe('4');
  });

  it('wisselt van paneel via v-model en valt terug op het eerste bij een onbekende sleutel', async () => {
    const wrapper = mount(TabPanels, { props: { tabs, modelValue: 'fotos', label: 'Delen' } });
    expect(wrapper.findAll('a')[1]!.attributes('aria-current')).toBe('true');
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Delen');
    await wrapper.findAll('a')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['gegevens']]);
    await wrapper.setProps({ modelValue: 'bestaat-niet' });
    expect(wrapper.findAll('a')[0]!.attributes('aria-current')).toBe('true');
  });
});

describe('tab-panels bij een ongeldig veld', () => {
  it('opent het verborgen paneel met het eerste ongeldige veld, ook als de browser de events los stuurt', async () => {
    const wrapper = mount(TabPanels, {
      props: { tabs: [{ key: 'een', label: 'Een' }, { key: 'twee', label: 'Twee' }, { key: 'drie', label: 'Drie' }], modelValue: 'een' },
      slots: { 'tab-een': '<input name="a">', 'tab-twee': '<input name="b" required>', 'tab-drie': '<input name="c" required>' },
      attachTo: document.body,
    });
    const inputs = wrapper.findAll('input');
    inputs[0]!.element.dispatchEvent(new Event('invalid'));
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    inputs[1]!.element.dispatchEvent(new Event('invalid'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    inputs[2]!.element.dispatchEvent(new Event('invalid'));
    expect(wrapper.emitted('update:modelValue')).toEqual([['twee']]);
    wrapper.find('.crm-tabbed').element.dispatchEvent(new Event('invalid'));
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
    wrapper.unmount();
  });

  it('opent ook een paneel waarin het ongeldige veld in een fieldset staat', () => {
    const wrapper = mount(TabPanels, {
      props: { tabs: [{ key: 'een', label: 'Een' }, { key: 'twee', label: 'Twee' }], modelValue: 'een' },
      slots: { 'tab-twee': '<fieldset><legend>Groep</legend><input name="b" required></fieldset>' },
      attachTo: document.body,
    });
    wrapper.find('input').element.dispatchEvent(new Event('invalid'));
    expect(wrapper.emitted('update:modelValue')).toEqual([['twee']]);
    wrapper.unmount();
  });

  it('blijft staan als het eerste ongeldige veld op het open paneel staat', async () => {
    const wrapper = mount(TabPanels, {
      props: { tabs: [{ key: 'een', label: 'Een' }, { key: 'twee', label: 'Twee' }], modelValue: 'een' },
      slots: { 'tab-een': '<input name="a" required>', 'tab-twee': '<input name="b" required>' },
      attachTo: document.body,
    });
    const inputs = wrapper.findAll('input');
    inputs[0]!.element.dispatchEvent(new Event('invalid'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    inputs[1]!.element.dispatchEvent(new Event('invalid'));
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('save-bar', () => {
  it('toont de knop en tijdens opslaan een uitgeschakelde knop met melding', async () => {
    const wrapper = mount(SaveBar, { props: { label: 'Opslaan', note: 'Let op' } });
    expect(wrapper.find('button').text()).toBe('Opslaan');
    expect(wrapper.find('button').attributes('type')).toBe('submit');
    expect(wrapper.find('.crm-savebar-note').text()).toBe('Let op');
    await wrapper.setProps({ busy: true, note: undefined });
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('button').text()).toBe('Bezig met opslaan…');
  });

  it('zet een tweede actie links in de balk, in plaats van de toelichting', () => {
    const wrapper = mount(SaveBar, { props: { label: 'Opslaan', note: 'Let op' }, slots: { links: '<button type="button" class="btn btn--outline">Verwijderen</button>' } });
    expect(wrapper.find('.crm-savebar-actions button').text()).toBe('Verwijderen');
    expect(wrapper.find('.crm-savebar-note').exists()).toBe(false);
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Verwijderen', 'Opslaan']);
  });
});

describe('form-field en text-field', () => {
  it('koppelt label, hulp en fout aan het veld', () => {
    const wrapper = mount(TextField, { props: { label: 'Titel', help: 'Zoals op de site.', error: 'Vul een titel in.', required: true, maxlength: 20, modelValue: '' } });
    const input = wrapper.find('input');
    const id = input.attributes('id')!;
    expect(wrapper.find('label').attributes('for')).toBe(id);
    expect(input.attributes('aria-describedby')).toBe(`${id}-hulp ${id}-fout`);
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('maxlength')).toBe('20');
    expect(input.attributes('type')).toBe('text');
    expect(wrapper.find('.required').exists()).toBe(true);
    expect(wrapper.find('.field__error').attributes('id')).toBe(`${id}-fout`);
  });

  it('zonder hulp en fout geen beschrijving en geen ongeldig-markering', () => {
    const wrapper = mount(FormField, { props: { label: 'Naam' }, slots: { default: '<input>' } });
    expect(wrapper.find('.field__help').exists()).toBe(false);
    expect(wrapper.find('.field__error').exists()).toBe(false);
    const field = mount(TextField, { props: { label: 'Naam', type: 'email' } });
    expect(field.find('input').attributes('aria-describedby')).toBeUndefined();
    expect(field.find('input').attributes('aria-invalid')).toBeUndefined();
    expect(field.find('input').attributes('type')).toBe('email');
  });

  it('werkt met v-model, ook als tekstvak', async () => {
    const wrapper = mount(TextField, { props: { label: 'Tekst', multiline: true, modelValue: 'begin', 'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }) } });
    const area = wrapper.find('textarea');
    expect((area.element as HTMLTextAreaElement).value).toBe('begin');
    await area.setValue('nieuw');
    expect(wrapper.props('modelValue')).toBe('nieuw');
  });
});
