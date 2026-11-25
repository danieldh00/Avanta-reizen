/**
 * Tests van de bouwstenen voor lijsten: tabel (kaarten op mobiel), status, filter, zoeken en bladeren.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import DataTable from './data-table.vue';
import StatusBadge from './status-badge.vue';
import FilterTabs from './filter-tabs.vue';
import SearchField from './search-field.vue';
import PagerNav from './pager-nav.vue';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('data-table', () => {
  const columns = [{ key: 'naam', label: 'Naam', wrap: true }, { key: 'aantal', label: 'Aantal', numeric: true }];

  it('toont een melding als de lijst leeg is', () => {
    const wrapper = mount(DataTable, { props: { columns, rows: [], empty: 'Niets gevonden.' } });
    expect(wrapper.find('p.crm-empty').text()).toBe('Niets gevonden.');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('tekent rijen met labels per cel, klassen per kolom en escapet de tekst', () => {
    const rows = [{ id: 7, naam: '<b>Noorwegen</b>', aantal: 3 }, { naam: 'Zonder id', aantal: null }];
    const wrapper = mount(DataTable, { props: { columns, rows, empty: '-', caption: 'Reizen' } });
    expect(wrapper.find('caption').text()).toBe('Reizen');
    const cells = wrapper.findAll('td');
    expect(cells[0]!.attributes('data-label')).toBe('Naam');
    expect(cells[0]!.classes()).toContain('crm-wrap');
    expect(cells[1]!.classes()).toContain('crm-num');
    expect(cells[0]!.html()).toContain('&lt;b&gt;Noorwegen&lt;/b&gt;');
    expect(cells[3]!.text()).toBe('');
    expect(wrapper.findAll('th').map((th) => th.attributes('scope'))).toEqual(['col', 'col']);
  });

  it('gebruikt een eigen weergave per cel via de slot', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows: [{ id: 1, naam: 'Reis', aantal: 1 }], empty: '-', rowKey: 'id' },
      slots: { 'cel-naam': ({ row }: { row: Record<string, unknown> }) => h('a', { href: '/x/' }, String(row.naam)) },
    });
    expect(wrapper.find('td a').text()).toBe('Reis');
  });
});

describe('status-badge', () => {
  it('zet een bekende soort in de klasse en een onbekende als onbekend', () => {
    expect(mount(StatusBadge, { props: { kind: 'betaald', label: 'Betaald' } }).classes()).toEqual(['crm-status', 'crm-status--betaald']);
    expect(mount(StatusBadge, { props: { kind: 'x" onclick="y', label: 'X' } }).classes()).toContain('crm-status--onbekend');
  });
});

describe('filter-tabs', () => {
  const options = [{ value: '', label: 'Alle', count: 3 }, { value: 'open', label: 'Open', count: 0 }, { value: 'dicht', label: 'Dicht' }];

  it('maakt links met de filter in het adres en markeert de keuze', () => {
    window.history.replaceState(null, '', '/app/berichten/?q=test&pagina=3');
    const wrapper = mount(FilterTabs, { props: { options, modelValue: 'open', name: 'status' } });
    const links = wrapper.findAll('a');
    expect(links.map((link) => link.attributes('href'))).toEqual(['?q=test', '?q=test&status=open', '?q=test&status=dicht']);
    expect(links[1]!.attributes('aria-current')).toBe('true');
    expect(links[0]!.attributes('aria-current')).toBeUndefined();
    expect(wrapper.findAll('.crm-tabs-count').map((count) => count.text())).toEqual(['3', '0']);
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Filter');
  });

  it('geeft zonder andere parameters het kale pad', () => {
    window.history.replaceState(null, '', '/app/berichten/?status=open');
    const wrapper = mount(FilterTabs, { props: { options, modelValue: '', name: 'status', label: 'Status' } });
    expect(wrapper.find('a').attributes('href')).toBe('/app/berichten/');
  });

  it('wisselt bij een gewone klik zonder te herladen, maar laat Ctrl+klik aan de browser', async () => {
    const wrapper = mount(FilterTabs, { props: { options, modelValue: '', name: 'status' } });
    await wrapper.findAll('a')[2]!.trigger('click', { button: 0 });
    expect(wrapper.emitted('update:modelValue')).toEqual([['dicht']]);
    await wrapper.findAll('a')[1]!.trigger('click', { button: 0, ctrlKey: true });
    await wrapper.findAll('a')[1]!.trigger('click', { button: 1 });
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });
});

describe('search-field', () => {
  it('geeft de ingekorte zoekterm door bij versturen en volgt een nieuwe waarde', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: 'oud', label: 'Zoek' } });
    const input = wrapper.find('input');
    expect(wrapper.find('label').attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('maxlength')).toBe('100');
    await input.setValue(`  ${'x'.repeat(120)}  `);
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('update:modelValue')![0]![0]).toHaveLength(100);
    await wrapper.setProps({ modelValue: 'nieuw' });
    expect((input.element as HTMLInputElement).value).toBe('nieuw');
    expect(wrapper.find('button').text()).toBe('Zoeken');
  });
});

describe('pager-nav', () => {
  it('toont niets bij één pagina', () => {
    expect(mount(PagerNav, { props: { page: 1, hasNext: false } }).find('nav').exists()).toBe(false);
  });

  it('bladert vooruit en terug', async () => {
    const wrapper = mount(PagerNav, { props: { page: 2, hasNext: true } });
    expect(wrapper.find('.crm-pager-page').text()).toBe('Pagina 2');
    const [previous, next] = wrapper.findAll('button');
    await previous!.trigger('click');
    await next!.trigger('click');
    expect(wrapper.emitted('update:page')).toEqual([[1], [3]]);
  });

  it('toont Vorige en Volgende uitgeschakeld aan de randen', () => {
    expect(mount(PagerNav, { props: { page: 1, hasNext: true } }).find('.crm-pager-off').text()).toBe('Vorige');
    expect(mount(PagerNav, { props: { page: 4, hasNext: false } }).find('.crm-pager-off').text()).toBe('Volgende');
  });
});
