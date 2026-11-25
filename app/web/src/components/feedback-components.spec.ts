/**
 * Tests van de bouwstenen voor terugkoppeling: bevestigvenster en meldingen.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from './confirm-dialog.vue';
import StatusMessage from './status-message.vue';

beforeAll(() => {
  // jsdom kent het modale venster niet volledig; dit bootst open en dicht na.
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) { this.removeAttribute('open'); });
});

describe('confirm-dialog', () => {
  const props = { open: false, title: 'Verwijderen?', message: 'Dit kan niet terug.', confirmLabel: 'Verwijderen', danger: true };

  it('opent modaal met de focus op Annuleren en zet de focus daarna terug', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mount(ConfirmDialog, { props, attachTo: document.body });
    const dialog = wrapper.find('dialog');
    expect(dialog.attributes('aria-labelledby')).toBe(wrapper.find('h2').attributes('id'));
    await wrapper.setProps({ open: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.attributes('open')).toBeDefined();
    expect(document.activeElement?.textContent?.trim()).toBe('Annuleren');
    expect(wrapper.findAll('button')[1]!.classes()).toContain('btn--danger');
    await wrapper.setProps({ open: false });
    expect(dialog.attributes('open')).toBeUndefined();
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
    opener.remove();
  });

  it('meldt bevestigen, annuleren en Escape', async () => {
    const wrapper = mount(ConfirmDialog, { props: { ...props, danger: false } });
    const [cancel, confirm] = wrapper.findAll('button');
    expect(confirm!.classes()).not.toContain('btn--danger');
    await confirm!.trigger('click');
    await cancel!.trigger('click');
    await wrapper.find('dialog').trigger('cancel');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });

  it('opent meteen als het venster met open: true wordt getekend', async () => {
    const wrapper = mount(ConfirmDialog, { props: { ...props, open: true }, attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.find('dialog').attributes('open')).toBeDefined();
    wrapper.unmount();
  });

  it('dicht zonder vraag van de ouder geldt als annuleren', async () => {
    const wrapper = mount(ConfirmDialog, { props: { ...props, open: true }, attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.find('dialog').trigger('close');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    await wrapper.setProps({ open: false });
    await wrapper.find('dialog').trigger('close');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });

  it('doet niets als de stand niet verandert of het venster er niet is', async () => {
    const wrapper = mount(ConfirmDialog, { props });
    await wrapper.setProps({ open: false, title: 'Anders' });
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalledWith();
    wrapper.unmount();
  });
});

describe('status-message', () => {
  it('fout als alert, de rest als status, leeg = niets', async () => {
    expect(mount(StatusMessage, { props: { kind: 'fout', message: 'Mis' } }).attributes('role')).toBe('alert');
    const info = mount(StatusMessage, { props: { kind: 'info', message: 'Let op' } });
    expect(info.attributes('role')).toBe('status');
    expect(info.classes()).toContain('notice');
    expect(info.find('button').exists()).toBe(false);
    expect(mount(StatusMessage, { props: { kind: 'succes', message: '' } }).find('div').exists()).toBe(false);
  });

  it('kan weggehaald worden', async () => {
    const wrapper = mount(StatusMessage, { props: { kind: 'succes', message: 'Opgeslagen', dismissible: true } });
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });
});
